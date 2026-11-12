/**
 * Pièce affichée (`Room`) : numéro, calques à dessiner, hotspot et sortie sous le pointeur, curseur, ligne d'état, bulle de parole,
 * changement de pièce (activation des hotspots, séquence d'entrée, avance rapide des ticks au retour).
 *
 * Source (ScummVM, GPL v3+) : `Room::setRoomNumber`, `leaveRoom`, `loadRoomHotspots`, `checkRoomHotspots`, `checkRoomExits`,
 * `checkCursor`, `setTalkDialog`, `checkInTalkDialog`, `reset` (engines/lure/room.cpp).
 *
 * Écarts volontaires : pas de dessin (`update`, calques, fondus : vague R) ; le moteur retient ce que le rendu doit montrer (calques,
 * calque de recouvrement, curseur, ligne d'état, bulle, palette à composer). La bulle (`TalkDialog`) n'est qu'un enregistrement ici :
 * son texte progressif est la vague T (`building` reste faux).
 */

import type { LureContext } from "./context";
import { Cursor, CursorState, CurrentAction, Field, HotspotFlag, HotspotId, MENUBAR_Y_SIZE, TALK_DIALOG_WIDTH, TALK_DIALOG_Y, FULL_SCREEN_WIDTH } from "./ids";
import { countdownPaused } from "./paused-list";
import type { HotspotState, RoomState } from "./state";

/** Bulle de parole affichée (`TalkDialog`). */
export interface TalkDialogState {
  srcCharacterId: number;
  destCharacterId: number;
  usedId: number;
  stringId: number;
  x: number;
  y: number;
  /** Le texte s'écrit encore (vague T). */
  building: boolean;
}

/** Plages de numéros parcourues dans l'ordre par `checkRoomHotspots` : objets, personnages, zones, sorties. */
const HOTSPOT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x408, 0x270f],
  [0x3e8, 0x407],
  [0x7530, 0xffff],
  [0x2710, 0x752f],
];

/** Numéro de pièce factice qui force le fondu au prochain `setRoomNumber` (`Room::reset`, chargement). */
const NO_ROOM = 999;

/**
 * Avance rapide d'une pièce où l'on revient (`Room::setRoomNumber`) : une image de `Game::tick` (ticks des personnages, plus le décompte
 * de `pausedList` : écart, voir `setRoomNumber`) par seconde écoulée depuis `exitTime`, au plus 300 ; aucune si `exitTime` vaut 0 ou `0xFFFF`. `exitTime` est
 * posé par `Game::changeRoom` sur la pièce où le joueur **entre** : le retour d'une vue à distance (qui ne passe pas par `changeRoom`)
 * rattrape donc tout le temps écoulé depuis que le joueur est entré dans sa pièce.
 *
 * Soustraction sur 32 bits non signés, comme ScummVM (`uint32`) : les pièces 6, 7, 41 à 46 et 49 ont une heure de sortie initiale
 * `0xFFFFF` (pas `0xFFFF`) ; avant 1 048 575 ms de jeu la différence boucle, d'où 300 secondes d'avance rapide à la première entrée
 * (vérifié au banc : en entrant dans la pièce 7, les villageois sont déjà loin de leur pièce de départ).
 */
export function catchUpTicks(exitTime: number, nowMs: number): number {
  if (exitTime === 0xffff || exitTime === 0) return 0;
  return Math.min(300, Math.trunc(((nowMs - exitTime) >>> 0) / 1000));
}

export class Room {
  roomNumber = 0;
  roomData: RoomState | null = null;
  descId = 0;
  /** Calques à dessiner (écrans), calque de recouvrement compris si demandé. */
  layers: number[] = [];
  /** Hotspot sous le pointeur (0 : aucun), et son nom en codes du jeu. */
  hotspotId = 0;
  /** Données du hotspot sous le pointeur (`_hotspot`). */
  hotspot: HotspotState | null = null;
  hotspotNameId = 0;
  hotspotName = "";
  isExit = false;
  /** Pièce de la sortie sous le pointeur (0 : aucune). */
  destRoomNumber = 0;
  cursorState: number = CursorState.NONE;
  /** Ligne d'état en codes du jeu (vide : le nom du hotspot sous le pointeur est montré). */
  statusLine = "";
  talkDialog: TalkDialogState | null = null;
  /** Curseur demandé (`Mouse::setCursorNum`). */
  cursor: number = Cursor.ARROW;
  /** Nombre de changements de pièce (fondus) : le rendu sait qu'il doit recomposer la palette. */
  changes = 0;

  constructor(private readonly ctx: LureContext) {}

  /** Pointeur (`Mouse::x`, `y`), mis à jour par la boucle. */
  mouseX = 0;
  mouseY = 0;

  /** `Room::reset`. */
  reset(): void {
    this.roomNumber = NO_ROOM;
    this.setTalkDialog(0, 0, 0, 0);
    this.hotspotId = 0;
    this.hotspotName = "";
    this.statusLine = "";
  }

  isDialogShowing(): boolean {
    // Comme ScummVM (`room.h`) : la bulle compte seulement si celui qui parle est encore actif et dans la pièce affichée. Un personnage
    // retiré en pleine bulle (non persistant, quand le joueur change de pièce) la laissait sinon « affichée » pour toujours : la
    // conversation suivante (`talkAnimHandler`, état NONE) attendait sans fin.
    if (!this.isDialogActive()) return false;
    const talker = this.ctx.world.getActiveHotspot(this.ctx.world.state.talkingCharacter);
    return talker !== null && talker.roomNumber === this.roomNumber;
  }

  /** `isDialogActive` : une bulle existe (le barman l'utilise). */
  isDialogActive(): boolean {
    return this.talkDialog !== null;
  }

  /** `leaveRoom` : retire les hotspots actifs non persistants. */
  leaveRoom(): void {
    const world = this.ctx.world;
    world.activeHotspots = world.activeHotspots.filter((h) => h.persistent);
  }

  /** `loadRoomHotspots` : active les hotspots visibles de la pièce (`layer != 0`). */
  loadRoomHotspots(): void {
    const world = this.ctx.world;
    for (const rec of world.state.hotspots) {
      if (rec.hotspotId < 0x7530 && rec.roomNumber === this.roomNumber && rec.layer !== 0) world.activateHotspot(rec.hotspotId);
    }
  }

  /**
   * `setRoomNumber(newRoom, showOverlay)` : quitte la pièce (fondu, hotspots non persistants retirés, sons de la pièce), prépare les
   * calques, exécute la séquence d'entrée, active les hotspots, rattrape les secondes passées dehors (300 au plus) et fait un tick.
   */
  setRoomNumber(newRoomNumber: number, showOverlay = false): void {
    const ctx = this.ctx;
    const world = ctx.world;
    const roomData = world.getRoom(newRoomNumber);
    if (!roomData) throw new Error(`pièce ${newRoomNumber} inexistante`);
    this.roomData = roomData;

    const fadeFlag = newRoomNumber !== this.roomNumber && this.roomNumber !== 0;
    const leaveFlag = this.roomNumber !== NO_ROOM;
    this.roomNumber = roomData.roomNumber;
    this.descId = roomData.data.descId;

    if (fadeFlag) {
      this.changes++;
      if (leaveFlag) {
        this.leaveRoom();
        ctx.sound.removeSounds();
      }
    }

    const numLayers = roomData.data.numLayers + (showOverlay ? 1 : 0);
    this.layers = roomData.data.layers.slice(0, numLayers);

    world.fields.set(Field.ROOM_NUMBER, newRoomNumber);
    if (roomData.data.sequenceOffset !== 0xffff) ctx.script.execute(roomData.data.sequenceOffset);
    this.loadRoomHotspots();

    if (leaveFlag) {
      let numSeconds = catchUpTicks(roomData.exitTime, this.clockMs());
      ctx.preloadFlag = true;
      // Écart (voulu) : ScummVM n'appelle que `Game::tick` ici ; `pausedList().countdown()` n'est appelé que par `Game::nextFrame`. Un
      // personnage heurté pendant le rattrapage restait donc figé (`pauseCtr` = 15) jusqu'au bout, et un suiveur oisif empilait une action
      // aléatoire à chaque fin d'attente jusqu'à l'arrêt « too many actions » (vérifié au banc, `docs/lure/group-3.md`). Ici chaque tick de
      // rattrapage décompte la liste comme une image normale (même ordre que `nextFrame` : décompte, puis ticks).
      while (numSeconds-- > 0) {
        countdownPaused(ctx);
        ctx.tickHotspots();
      }
      ctx.preloadFlag = false;
    }
    ctx.tickHotspots();
  }

  /** Horloge du jeu en ms (`g_system->getMillis`), fournie par la boucle. */
  clockMs: () => number = () => 0;

  /** `checkRoomHotspots` : hotspot sous le pointeur, par plages de numéros, dans l'ordre de `0x3F07`. */
  checkRoomHotspots(): void {
    const world = this.ctx.world;
    const x = this.mouseX;
    const y = this.mouseY;
    this.destRoomNumber = 0;
    let found: HotspotState | null = null;
    for (const [start, end] of HOTSPOT_RANGES) {
      for (const entry of world.state.hotspots) {
        if (entry.hotspotId < start || entry.hotspotId > end) continue;
        let skip = entry.roomNumber !== this.roomNumber;
        if (!skip) {
          skip =
            ((entry.flags & HotspotFlag.FOUND) === 0 && (entry.flags & HotspotFlag.SKIP) !== 0) ||
            (entry.flags & HotspotFlag.MENU_EXCLUSION) !== 0;
        }
        if (!skip && entry.hotspotId < 0x409) skip = !world.checkHotspotExtent(entry);
        if (!skip && entry.hotspotId >= 0x2710 && entry.hotspotId <= 0x27ff) {
          const join = world.getExitJoin(entry.hotspotId);
          if (join && !join.blocked) skip = true;
        }
        if (skip) continue;
        const o = world.getHotspotOverride(entry.hotspotId);
        const inside = o
          ? x >= o.xs && x <= o.xe && y >= o.ys && y <= o.ye
          : x >= entry.startX && y >= entry.startY && x < entry.startX + entry.widthCopy && y < entry.startY + entry.height;
        if (inside) {
          found = entry;
          break;
        }
      }
      if (found) break;
    }
    if (!found) {
      this.hotspotId = 0;
      this.hotspotNameId = 0;
      this.hotspot = null;
      return;
    }
    this.hotspot = found;
    this.hotspotNameId = found.nameId;
    this.hotspotId = found.hotspotId;
    this.isExit = false;
    found.flags |= HotspotFlag.FOUND;
  }

  /** Verbes du hotspot sous le pointeur (`hotspotActions`). */
  hotspotActions(): number {
    return ((this.hotspot?.actions ?? 0) & 0x10ffffff) >>> 0;
  }

  /** `checkRoomExits` : curseur de la sortie sous le pointeur (+7 pour une sortie-hotspot), flèche sinon. */
  checkRoomExits(): number {
    const world = this.ctx.world;
    this.destRoomNumber = 0;
    for (const rec of world.exitHotspots(this.roomNumber)) {
      if (rec.hotspotId !== 0) {
        const join = world.getExitJoin(rec.hotspotId);
        if (join && join.blocked !== 0) continue;
      }
      if (this.mouseX >= rec.xs && this.mouseX <= rec.xe && this.mouseY >= rec.ys && this.mouseY <= rec.ye) {
        let cursor = rec.cursorNum;
        this.destRoomNumber = rec.destRoomNumber;
        if (rec.hotspotId !== 0) {
          this.hotspotId = rec.hotspotId;
          const hotspot = world.requireHotspot(rec.hotspotId);
          this.hotspot = hotspot;
          this.hotspotNameId = hotspot.nameId;
          this.isExit = true;
          cursor += 7;
        }
        return cursor;
      }
    }
    return Cursor.ARROW;
  }

  /** `checkCursor` : curseur et hotspot sous le pointeur, une fois par image. */
  checkCursor(): void {
    const ctx = this.ctx;
    const world = ctx.world;
    const oldHotspotId = this.hotspotId;
    const current = this.cursor;
    let cursor = current;
    const playerAction = world.getActiveHotspot(HotspotId.PLAYER)?.currentActions.action() ?? CurrentAction.NO_ACTION;
    const oldRoomNumber = world.fields.get(Field.OLD_ROOM_NUMBER);

    if (
      current >= Cursor.TIME_START &&
      current <= Cursor.TIME_END &&
      (playerAction === CurrentAction.START_WALKING || playerAction === CurrentAction.PROCESSING_PATH)
    ) {
      cursor = current + 1;
      if (cursor === Cursor.CROSS) cursor = Cursor.TIME_START;
    } else if (this.checkInTalkDialog() && oldRoomNumber === 0) {
      cursor = Cursor.TALK;
    } else if (world.activeTalkData) {
      cursor = Cursor.ARROW;
    } else if (this.cursorState === CursorState.BUMPED) {
      cursor = Cursor.CAMERA;
    } else if (this.cursorState === CursorState.TALKING) {
      cursor = Cursor.ARROW;
    } else if (this.mouseY < MENUBAR_Y_SIZE) {
      if (oldRoomNumber !== 0) return;
      cursor = Cursor.MENUBAR;
    } else if (this.cursorState !== CursorState.NONE) {
      this.checkRoomHotspots();
      cursor = Cursor.CAMERA;
    } else {
      this.checkRoomHotspots();
      cursor = this.hotspotId !== 0 ? Cursor.CROSS : this.checkRoomExits();
      if (oldHotspotId !== this.hotspotId) this.hotspotName = this.hotspotNameId === 0 ? "" : ctx.text(this.hotspotNameId);
    }
    this.cursor = cursor;
  }

  /** `setTalkDialog` : ferme la bulle en cours, ouvre celle de `srcCharacterId` (0 : aucune) s'il est dans la pièce. */
  setTalkDialog(srcCharacterId: number, destCharacterId: number, usedId: number, stringId: number): void {
    const world = this.ctx.world;
    this.talkDialog = null;
    world.setTalkingCharacter(srcCharacterId);
    if (srcCharacterId === 0) return;
    const character = world.requireHotspot(srcCharacterId);
    if (character.roomNumber !== this.roomNumber) return;
    let x = character.startX + (character.width >> 1) - (TALK_DIALOG_WIDTH >> 1);
    if (x < 0) x = 0;
    if (x + TALK_DIALOG_WIDTH >= FULL_SCREEN_WIDTH - 10) x = FULL_SCREEN_WIDTH - 10 - TALK_DIALOG_WIDTH;
    this.talkDialog = { srcCharacterId, destCharacterId, usedId, stringId, x, y: TALK_DIALOG_Y, building: false };
  }

  /**
   * `checkInTalkDialog` : une bulle du joueur, ou adressée au joueur, est affichée et le pointeur est dessus. La taille de la bulle est
   * connue du rendu (vague T) : d'ici là, la bulle a la largeur `TALK_DIALOG_WIDTH` et une hauteur donnée par `talkDialogHeight`.
   */
  checkInTalkDialog(): boolean {
    const dialog = this.talkDialog;
    if (!dialog || dialog.building) return false;
    const world = this.ctx.world;
    const talkerId = world.state.talkingCharacter;
    if (talkerId === HotspotId.NOONE || talkerId === 0) return false;
    if (talkerId !== HotspotId.PLAYER && world.requireHotspot(talkerId).talkDestCharacterId !== HotspotId.PLAYER) return false;
    return (
      this.mouseX >= dialog.x &&
      this.mouseY >= dialog.y &&
      this.mouseX < dialog.x + TALK_DIALOG_WIDTH &&
      this.mouseY < dialog.y + this.talkDialogHeight
    );
  }

  /** Hauteur de la bulle affichée (`TalkDialog::surface().height()`), fournie par la vague T. */
  talkDialogHeight = 0;
}
