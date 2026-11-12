/**
 * Les combats : le cochon de la grotte (pièce 6) et le Skorl (pièce 49). Deux combattants (le joueur et l'adversaire), chacun un
 * `FighterRecord` ; leurs coups sont des séquences d'octets de la ressource `0x3F16` lues par `fightHandler` à chaque image.
 *
 * Source (ScummVM, GPL v3+) : engines/lure/fights.cpp et fights.h (`FightsManager`, `FighterRecord`, tables initiales), lu puis réécrit ;
 * touches de `lure.h` (`kActionFight*`) et de `metaengine.cpp`.
 *
 * Écarts :
 * - `fightLoop` n'est **pas** une boucle bloquante : c'est une image (les événements reçus, un tick des hotspots, un tick de la liste des
 *   séquences différées), appelée à chaque image de logique tant que `isFighting` ; `game.ts` ne fait rien d'autre pendant ce temps
 *   (comme `Game::nextFrame`, bloquée dans `fightLoop`). Dans ScummVM `isFighting()` (`fwhits == 0` du joueur) n'est vrai qu'au
 *   démarrage : la boucle tourne ensuite jusqu'à `fwhits == GENERAL_MAGIC_ID` ; ici `isFighting` est vrai pendant tout le combat ;
 * - les événements d'une image (jusqu'à 8 lectures de `checkEvents` par image de 80 ms dans ScummVM, qui sonde toutes les 10 ms) sont
 *   tous traités avant le tick ;
 * - les six touches du pavé (7 4 1 9 6 3) ont chacune leur action ; la carte de ScummVM les associe toutes, par une faute de copie
 *   (`metaengine.cpp`), à `kActionFightCursorLeftTop` ;
 * - Échap pendant un combat n'arrête pas le moteur d'un coup (`quitGame`) : `game.ts` demande la confirmation habituelle ;
 * - `Dialog::show(0xc9f)` (le cochon est mort) est une boîte demandée à `ctx.block`, comme partout ailleurs (`engine.md` § 9) ;
 * - un combat que la pièce quitte (impossible dans ScummVM, dont la boucle bloque : seuls les tests changent de pièce en plein combat) est
 *   abandonné : le joueur reprend son apparence, `isFighting` devient faux ;
 * - `colorOffset` : comme ScummVM, seul l'enregistrement de données (`resource()->colorOffset`) est modifié, pas celui du hotspot en
 *   cours (qui n'est lu qu'à la reconstruction du hotspot).
 */

import { Direction } from "../../data/ids";
import type { LureContext } from "../context";
import type { Hotspot } from "../hotspot";
import { GENERAL_MAGIC_ID, GameState, HotspotFlag, HotspotId, TickProc, AnimIndex, Cursor } from "../ids";
import type { MenuEvent } from "../menu";
import type { Fights } from "../services";
import { FIGHT_ACTION_MOVES, FIGHT_DISTANCE, FightData, FightHotspot, FightMove, FightSound, FighterIndex, PIG_KILLED_TEXT, PIG_ROOM } from "./ids";

/** `FighterRecord` : tous les champs sont des entiers 16 bits (`fwtrue_x` et `fwtrue_y` signés). */
export interface FighterRecord {
  fwheader_list: number;
  fwweapon: number;
  fwdie_seq: number;
  fwhit_value: number;
  fwhit_rate: number;
  fwtrue_x: number;
  fwtrue_y: number;
  fwblocking: number;
  fwattack_table: number;
  fwdef_len: number;
  fwdefend_table: number;
  fwnot_near: number;
  fwdefend_adds: number;
  fwseq_no: number;
  fwdist: number;
  fwwalk_roll: number;
  fwmove_number: number;
  fwhits: number;
  fwseq_ad: number;
  fwenemy_ad: number;
}

/** Les trois enregistrements de départ : joueur, cochon, Skorl (`initialFighterList`). */
function initialFighterList(): FighterRecord[] {
  const adversary = (weapon: number): FighterRecord => ({
    fwheader_list: 0,
    fwweapon: weapon,
    fwdie_seq: 0x1092,
    fwhit_value: 0,
    fwhit_rate: 3,
    fwtrue_x: 0,
    fwtrue_y: 0,
    fwblocking: 0,
    fwattack_table: 0xb94,
    fwdef_len: 8,
    fwdefend_table: 0xa34,
    fwnot_near: 0x8d4,
    fwdefend_adds: 0xd06,
    fwseq_no: 0,
    fwdist: 0,
    fwwalk_roll: 0,
    fwmove_number: 0,
    fwhits: 0,
    fwseq_ad: 0xddc,
    fwenemy_ad: HotspotId.PLAYER,
  });
  return [
    {
      fwheader_list: 0x23c,
      fwweapon: FightHotspot.PLAYER_WEAPON,
      fwdie_seq: 0,
      fwhit_value: 0,
      fwhit_rate: 0,
      fwtrue_x: 0,
      fwtrue_y: 0,
      fwblocking: 0,
      fwattack_table: 0,
      fwdef_len: 0,
      fwdefend_table: 0,
      fwnot_near: 0,
      fwdefend_adds: 0,
      fwseq_no: 0,
      fwdist: 0,
      fwwalk_roll: 0,
      fwmove_number: 0,
      fwhits: 1,
      fwseq_ad: 0,
      fwenemy_ad: 0,
    },
    adversary(FightHotspot.PIG_WEAPON),
    adversary(FightHotspot.SKORL_WEAPON),
  ];
}

/** Champs sauvegardés (`FightsManager::saveToStream`), dans l'ordre de ScummVM. */
const SAVED_FIELDS = ["fwseq_no", "fwseq_ad", "fwdist", "fwwalk_roll", "fwmove_number", "fwhits"] as const;
export type SavedFighter = Record<(typeof SAVED_FIELDS)[number], number>;
export interface FightsSave {
  fighters: SavedFighter[];
}

const u16 = (v: number): number => v & 0xffff;
const i16 = (v: number): number => (v << 16) >> 16;
/** Au plus 8 lectures par image (80 ms / 10 ms) quand beaucoup d'événements arrivent. */
const MAX_EVENT_PASSES = 8;
/** Garde contre une séquence de données qui ne rendrait jamais la main (ScummVM boucle sans fin). */
const MAX_STEPS = 10_000;

/** Curseurs de la souris selon l'index (`moveList`). */
const MOVE_LIST = [Cursor.LEFT_ARROW, Cursor.FIGHT_UPPER, Cursor.FIGHT_MIDDLE, Cursor.FIGHT_LOWER, Cursor.RIGHT_ARROW];

enum KeyStatus {
  UP,
  KEYDOWN_1,
  KEYDOWN_2,
}

export class FightsManager implements Fights {
  private fighters = initialFighterList();
  private mouseFlags = 0;
  private keyDown = KeyStatus.UP;
  private fighting = false;
  /** Pièce du combat en cours ou du dernier combat (0 : aucun). */
  private fightRoom = 0;

  /**
   * `takeEvents` rend les événements reçus depuis l'image précédente (souris, touches de combat) et les retire. Les événements d'un
   * combat ne sont lus que par lui (`game.ts` ne traite pas les clics pendant un combat).
   */
  constructor(
    private readonly ctx: LureContext,
    private readonly takeEvents: () => readonly MenuEvent[] = () => [],
  ) {}

  /** Un combat est en cours (démarré par `setupPigFight` ou `setupSkorlFight`, fini quand l'adversaire est tué ou le joueur mort). */
  get isFighting(): boolean {
    return this.fighting;
  }

  /** Les enregistrements, pour les tests. */
  record(hotspotId: number): FighterRecord {
    return this.getDetails(hotspotId);
  }

  private getDetails(hotspotId: number): FighterRecord {
    if (hotspotId === HotspotId.PLAYER) return this.fighters[FighterIndex.PLAYER]!;
    if (hotspotId === HotspotId.PIG) return this.fighters[FighterIndex.PIG]!;
    if (hotspotId === HotspotId.SKORL_FIGHTER) return this.fighters[FighterIndex.SKORL]!;
    throw new Error(`personnage inconnu ${hotspotId.toString(16)} : il ne se bat pas`);
  }

  private word(offset: number): number {
    return this.ctx.data.fights.u16(offset);
  }

  private byte(offset: number): number {
    return this.ctx.data.fights.u8(offset);
  }

  reset(): void {
    this.fighters = initialFighterList();
    this.mouseFlags = 0;
    this.keyDown = KeyStatus.UP;
    this.fighting = false;
    this.fightRoom = 0;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Sauvegarde
  // ---------------------------------------------------------------------------------------------------------------------------------

  saveState(): FightsSave {
    return { fighters: this.fighters.map((f) => Object.fromEntries(SAVED_FIELDS.map((k) => [k, f[k]])) as SavedFighter) };
  }

  /** `loadFromStream` : remet à zéro, puis reprend les six champs de chaque combattant. Un état abîmé est ignoré. */
  restoreState(state: unknown): void {
    this.reset();
    if (typeof state !== "object" || state === null) return;
    const list = (state as { fighters?: unknown }).fighters;
    if (!Array.isArray(list) || list.length !== this.fighters.length) return;
    const valid = list.every((f) => typeof f === "object" && f !== null && SAVED_FIELDS.every((k) => Number.isInteger((f as Record<string, unknown>)[k])));
    if (!valid) return;
    list.forEach((saved, i) => {
      for (const k of SAVED_FIELDS) this.fighters[i]![k] = u16((saved as SavedFighter)[k]);
    });
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Mise en place
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** `setupPigFight` (méthode 15). */
  setupPigFight(): void {
    const player = this.ctx.world.requireActiveHotspot(HotspotId.PLAYER);
    player.skipFlag = false;
    player.res.colorOffset = 16;
    player.setTickProc(TickProc.PLAYER_FIGHT);
    player.setSize(48, 53);
    player.setAnimationIndex(AnimIndex.PLAYER_FIGHT);
    player.res.width = 48;
    player.res.height = 53;

    player.setOccupied(false);
    player.setPosition(262, 94);
    const rec = this.getDetails(HotspotId.PLAYER);
    rec.fwhits = 0;
    rec.fwtrue_x = 262;
    rec.fwtrue_y = 53;
    rec.fwseq_ad = FightData.PLAYER_INIT;
    rec.fwenemy_ad = HotspotId.PIG;
    this.fighting = true;
    this.fightRoom = this.ctx.room.roomNumber;
  }

  /** `setupSkorlFight` (méthode 17) : comme le cochon, plus l'arme, la place et la couleur propres au Skorl. */
  setupSkorlFight(): void {
    const player = this.ctx.world.requireActiveHotspot(HotspotId.PLAYER);
    const rec = this.getDetails(HotspotId.PLAYER);

    this.setupPigFight();

    rec.fwenemy_ad = HotspotId.SKORL_FIGHTER;
    rec.fwweapon = FightHotspot.SKORL_FIGHT_PLAYER_WEAPON;
    rec.fwtrue_x = 282;
    rec.fwtrue_y = 136;
    player.setPosition(282, 136);
    player.res.colorOffset = 96;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Image
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** Une image de la boucle de combat (`FightsManager::fightLoop`) : événements, tick des hotspots, séquences différées. */
  fightLoop(): void {
    if (!this.fighting) return;
    const queue = [...this.takeEvents()];
    let passes = 0;
    do {
      this.checkEvents(queue);
    } while (queue.length > 0 && ++passes < MAX_EVENT_PASSES * 8);

    this.ctx.tickHotspots();
    this.ctx.delays.tick();

    if (this.getDetails(HotspotId.PLAYER).fwhits === GENERAL_MAGIC_ID) this.fighting = false;
  }

  /**
   * `checkEvents` : touches de combat (un coup précis), déplacements de la souris (curseur selon la position par rapport au combattant)
   * et boutons ; puis le coup du joueur, choisi par le curseur et le bouton (ou par la touche tant qu'elle est enfoncée).
   * Consomme les événements de `queue` jusqu'à une touche de coup (les suivants sont repris à la lecture suivante).
   */
  private checkEvents(queue: MenuEvent[]): void {
    const room = this.ctx.room;
    const rec = this.getDetails(HotspotId.PLAYER);
    const player = this.ctx.world.requireActiveHotspot(HotspotId.PLAYER);
    let moveNumber = 0;

    while (moveNumber === 0 && queue.length > 0) {
      const e = queue.shift()!;
      if (e.type === "action") {
        const move = FIGHT_ACTION_MOVES[e.action];
        if (move !== undefined) {
          moveNumber = move;
          this.keyDown = KeyStatus.KEYDOWN_1;
        }
      } else if (e.type === "actionEnd") {
        this.keyDown = KeyStatus.UP;
      } else if (e.type === "move") {
        if (e.x < rec.fwtrue_x - 12) room.cursor = Cursor.LEFT_ARROW;
        else if (e.x > rec.fwtrue_x + player.width) room.cursor = Cursor.RIGHT_ARROW;
        else if (e.y < player.y + 4) room.cursor = Cursor.FIGHT_UPPER;
        else if (e.y < player.y + 38) room.cursor = Cursor.FIGHT_MIDDLE;
        else room.cursor = Cursor.FIGHT_LOWER;
      } else if (e.type === "lbuttondown" || e.type === "rbuttondown" || e.type === "lbuttonup" || e.type === "rbuttonup") {
        this.mouseFlags = 0;
        if (e.type === "lbuttondown") this.mouseFlags++;
        if (e.type === "rbuttondown") this.mouseFlags += 2;
      }
    }

    if (this.keyDown === KeyStatus.KEYDOWN_2) return;

    // Numéro de base du coup selon le curseur : 0 à 4, puis +5 (bouton droit) ou +10 (bouton gauche).
    while (moveNumber < 5 && MOVE_LIST[moveNumber] !== room.cursor) ++moveNumber;
    if (moveNumber < 5) {
      if (this.mouseFlags === 1) moveNumber += 10;
      else if (this.mouseFlags === 2) moveNumber += 5;
    }

    rec.fwmove_number = moveNumber;
    if (this.keyDown === KeyStatus.KEYDOWN_1) this.keyDown = KeyStatus.KEYDOWN_2;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Gestionnaires de tick
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** `fighterAnimHandler` (gestionnaire 38) : l'adversaire choisit son coup (hasard : `getFighterMove`), puis le joue. */
  fighterAnimHandler(h: Hotspot): void {
    if (this.abandoned()) return;
    const fighter = this.getDetails(h.hotspotId);
    const opponent = this.getDetails(fighter.fwenemy_ad);
    const player = this.getDetails(HotspotId.PLAYER);

    this.fetchFighterDistance(fighter, opponent);

    if (fighter.fwseq_ad !== 0) {
      this.fightHandler(h, fighter.fwseq_ad);
      return;
    }

    let seqNum = 0;
    if (fighter.fwdist !== FIGHT_DISTANCE) {
      seqNum = this.getFighterMove(fighter, fighter.fwnot_near);
    } else {
      let offset = u16(fighter.fwhits * fighter.fwdef_len + fighter.fwdefend_adds + 4);

      // Cherche, parmi les réponses prévues contre le coup du joueur, la séquence qui correspond.
      let v = this.word(offset);
      while (v !== 0 && v !== player.fwseq_no) {
        offset = u16(offset + 4);
        v = this.word(offset);
      }

      if (v === 0) {
        seqNum = this.getFighterMove(fighter, fighter.fwattack_table);
      } else {
        v = this.word(offset + 2);
        seqNum = this.getFighterMove(fighter, fighter.fwdefend_table);

        if (seqNum === 0) seqNum = this.getFighterMove(fighter, fighter.fwattack_table);
        else if (seqNum === 0xff) seqNum = v;
      }
    }

    fighter.fwseq_no = seqNum;
    fighter.fwseq_ad = this.word(FightData.TABLE_1 + (seqNum << 1));
  }

  /** `playerAnimHandler` (gestionnaire 39, `playerFightAnimHandler`) : le joueur joue le coup en cours. */
  playerAnimHandler(h: Hotspot): void {
    if (this.abandoned()) return;
    const fighter = this.getDetails(h.hotspotId);
    this.fightHandler(h, fighter.fwseq_ad);
  }

  /** Un tick d'une séquence de combat : image, déplacement, ou commande (`0xFFxx`) jusqu'à ce qu'une image soit posée. */
  private fightHandler(h: Hotspot, startOffset: number): void {
    const ctx = this.ctx;
    const fighter = this.getDetails(h.hotspotId);
    const opponent = this.getDetails(fighter.fwenemy_ad);
    let moveOffset = startOffset;
    let breakFlag = false;
    let steps = 0;

    while (!breakFlag) {
      if (++steps > MAX_STEPS) throw new Error(`combat : la séquence ${startOffset.toString(16)} ne rend jamais la main`);
      if (moveOffset === 0) {
        // Le personnage ne fait rien : le numéro de coup choisit la séquence suivante.
        moveOffset = this.word(FightData.PLAYER_MOVE_TABLE + (fighter.fwmove_number << 1));
        if (moveOffset === 0) return;
        fighter.fwseq_no = fighter.fwmove_number;
        fighter.fwseq_ad = moveOffset;
      }

      const moveValue = this.word(moveOffset);
      moveOffset = u16(moveOffset + 2);

      if ((moveValue & 0x8000) === 0) {
        // Image : numéro, nouvelle position (bornée à 32..240), puis l'arme.
        h.setFrameNumber(moveValue);
        let newX = h.x + i16(this.word(moveOffset));
        if (newX < 32) newX = 32;
        if (newX > 240) newX = 240;
        const newY = h.y + i16(this.word(moveOffset + 2));
        h.setPosition(newX, newY);

        if (fighter.fwweapon !== 0) {
          const weapon = ctx.world.requireActiveHotspot(fighter.fwweapon);
          const newFrameNumber = this.word(moveOffset + 4);
          const xChange = i16(this.word(moveOffset + 6));
          const yChange = i16(this.word(moveOffset + 8));
          weapon.setFrameNumber(newFrameNumber);
          weapon.setPosition(h.x + xChange, h.y + yChange);
        }

        moveOffset = u16(moveOffset + 10);
        fighter.fwseq_ad = moveOffset;
        return;
      }

      switch (moveValue) {
        case 0xfffa: // marche à gauche
          if (fighter.fwmove_number === FightMove.RIGHT_BUTTON_WALK_LEFT || fighter.fwmove_number === FightMove.WALK_LEFT) {
            if (h.x < 32) {
              breakFlag = true;
            } else {
              h.setPosition(h.x - 4, h.y);
              fighter.fwtrue_x = h.x;
              if (this.fetchFighterDistance(fighter, opponent) < FIGHT_DISTANCE) {
                h.setPosition(h.x + 4, h.y);
                fighter.fwtrue_x = i16(fighter.fwtrue_x + 4);
                breakFlag = true;
              } else {
                this.removeWeapon(fighter.fwweapon);
                fighter.fwtrue_x = h.x;
                fighter.fwtrue_y = h.y;
                const frame = fighter.fwwalk_roll === 7 ? 0 : fighter.fwwalk_roll + 1;
                fighter.fwwalk_roll = frame;
                fighter.fwseq_ad = moveOffset;
                h.setFrameNumber(frame);
                return;
              }
            }
          } else {
            moveOffset = 0; // nouvelle action
          }
          break;

        case 0xfff9: // marche à droite
          if (fighter.fwmove_number === FightMove.RIGHT_BUTTON_WALK_RIGHT || fighter.fwmove_number === FightMove.WALK_RIGHT) {
            if (h.x >= 240) {
              breakFlag = true;
            } else {
              this.removeWeapon(fighter.fwweapon);
              h.setPosition(h.x + 4, h.y);
              fighter.fwtrue_x = h.x;
              fighter.fwtrue_y = h.y;
              fighter.fwwalk_roll = fighter.fwwalk_roll === 0 ? 7 : fighter.fwwalk_roll - 1;
              fighter.fwseq_ad = moveOffset;
              h.setFrameNumber(fighter.fwwalk_roll);
              return;
            }
          } else {
            moveOffset = 0;
          }
          break;

        case 0xffeb: // l'adversaire avance
          this.removeWeapon(fighter.fwweapon);
          h.setPosition(h.x + 4, h.y);
          fighter.fwtrue_x = h.x;
          if (this.fetchFighterDistance(fighter, opponent) < FIGHT_DISTANCE) {
            h.setPosition(h.x - 4, h.y);
            fighter.fwtrue_x = i16(fighter.fwtrue_x - 4);
            fighter.fwseq_ad = 0;
            h.setFrameNumber(8);
          } else {
            h.setFrameNumber(this.word(moveOffset));
            moveOffset = u16(moveOffset + 2);
            fighter.fwseq_ad = moveOffset;
          }
          return;

        case 0xfffb: // fin de séquence
          breakFlag = true;
          break;

        case 0xfff8: // saute à une adresse
          moveOffset = this.word(moveOffset);
          break;

        case 0xffff: // animation (enregistrement)
          h.setAnimation(this.word(moveOffset));
          h.setFrameNumber(0);
          moveOffset = u16(moveOffset + 2);
          break;

        case 0xfffe: // animation (de la liste d'en-têtes du combattant)
          h.setAnimation(this.word(fighter.fwheader_list + (this.word(moveOffset) << 1)));
          h.setFrameNumber(0);
          moveOffset = u16(moveOffset + 2);
          break;

        case 0xfff7: // si ce coup est tenu
          if (this.word(moveOffset) === fighter.fwmove_number) moveOffset = this.word(moveOffset + 2);
          else moveOffset = u16(moveOffset + 4);
          break;

        case 0xfff6: // si ce coup n'est pas tenu
          if (this.word(moveOffset) === fighter.fwmove_number) moveOffset = u16(moveOffset + 4);
          else moveOffset = this.word(moveOffset + 2);
          break;

        case 0xfff4: // fin de coup
          fighter.fwseq_no = 0;
          break;

        case 0xfff2: // pose la parade
          fighter.fwblocking = this.word(moveOffset);
          moveOffset = u16(moveOffset + 2);
          break;

        case 0xfff1: {
          // si la parade de l'adversaire est celle-ci : bruit, saute
          const v1 = this.word(moveOffset);
          const v2 = this.word(moveOffset + 2);
          moveOffset = u16(moveOffset + 4);
          if (v1 === opponent.fwblocking) {
            ctx.sound.addSound(FightSound.BLOCK);
            moveOffset = v2;
          }
          break;
        }

        case 0xfff0: {
          // le coup porte-t-il ?
          const v1 = this.word(moveOffset);
          moveOffset = u16(moveOffset + 2);
          if (fighter.fwdist <= FIGHT_DISTANCE) {
            if (h.hotspotId === HotspotId.PLAYER) {
              // le joueur touche l'adversaire
              ctx.sound.addSound(FightSound.PLAYER_HITS);
              if (opponent.fwhits !== 5) {
                opponent.fwseq_ad = v1;
                opponent.fwhit_value = u16(opponent.fwhit_value + 1);
                if (opponent.fwhit_value !== opponent.fwhit_rate) {
                  opponent.fwhit_value = 0;
                  opponent.fwhits = u16(opponent.fwhits + 1);
                  if (opponent.fwhits === 5) opponent.fwseq_ad = opponent.fwdie_seq;
                }
              }
            } else {
              // l'adversaire touche le joueur
              ctx.sound.addSound(FightSound.ENEMY_HITS);
              opponent.fwseq_ad = v1;
              opponent.fwhits = u16(opponent.fwhits + 1);
              if (opponent.fwhits === 10) {
                // le joueur est mort
                fighter.fwhits = 10;
                opponent.fwseq_ad = FightData.PLAYER_DIES;
                ctx.sound.addSound(FightSound.PLAYER_DIES);
              }
            }
          }
          break;
        }

        case 0xffef: // retient les coordonnées
          fighter.fwtrue_x = h.x;
          fighter.fwtrue_y = h.y;
          break;

        case 0xffee: // rétablit les coordonnées
          h.setPosition(fighter.fwtrue_x, fighter.fwtrue_y);
          break;

        case 0xffed: // fin de la partie (le joueur est mort)
          this.getDetails(HotspotId.PLAYER).fwhits = GENERAL_MAGIC_ID;
          ctx.gameState = GameState.RESTORE_RESTART;
          return;

        case 0xffec: // l'adversaire est tué
          this.enemyKilled();
          break;

        case 0xffea: // bruit du combat
          ctx.sound.addSound(this.word(moveOffset) & 0xff);
          moveOffset = u16(moveOffset + 2);
          break;

        default:
          throw new Error(`commande de combat inconnue ${moveValue.toString(16)}`);
      }
    }

    fighter.fwseq_no = 0;
    fighter.fwseq_ad = 0;
    if (h.hotspotId === HotspotId.PLAYER) this.mouseFlags = 0;
  }

  /** La pièce du combat est quittée : le combat est abandonné (le joueur reprend son apparence), rend vrai. */
  private abandoned(): boolean {
    if (this.fightRoom === 0 || this.ctx.room.roomNumber === this.fightRoom) return false;
    const rec = this.getDetails(HotspotId.PLAYER);
    if (rec.fwhits !== GENERAL_MAGIC_ID) {
      rec.fwhits = GENERAL_MAGIC_ID;
      this.restorePlayer();
    }
    this.fighting = false;
    return true;
  }

  /** `fetchFighterDistance` : distance horizontale entre deux combattants, arrondie à un multiple de 8. */
  private fetchFighterDistance(f1: FighterRecord, f2: FighterRecord): number {
    f1.fwdist = Math.abs(f1.fwtrue_x - f2.fwtrue_x) & 0xfff8;
    return f1.fwdist;
  }

  /** `enemyKilled` : le joueur reprend son apparence et son gestionnaire ; le cochon laisse la hache (pièce 6). */
  private enemyKilled(): void {
    const ctx = this.ctx;
    const player = ctx.world.requireActiveHotspot(HotspotId.PLAYER);
    this.getDetails(HotspotId.PLAYER).fwhits = GENERAL_MAGIC_ID;
    this.restorePlayer();

    if (player.roomNumber === PIG_ROOM) {
      ctx.showDialog(PIG_KILLED_TEXT);
      const axe = ctx.world.requireHotspot(FightHotspot.AXE);
      axe.roomNumber = HotspotId.PLAYER;
      axe.flags |= HotspotFlag.FOUND;
      // L'animation de l'arme ne doit plus être dessinée.
      ctx.world.requireHotspot(FightHotspot.PLAYER_WEAPON).layer = 0;
    }
  }

  /** Le joueur reprend son gestionnaire, sa taille, sa couleur et son animation d'avant le combat. */
  private restorePlayer(): void {
    const player = this.ctx.world.requireActiveHotspot(HotspotId.PLAYER);
    player.setTickProc(TickProc.PLAYER);
    player.res.colorOffset = 128;
    player.setSize(32, 48);
    player.res.width = 32;
    player.res.height = 48;
    player.setAnimationIndex(AnimIndex.PLAYER);
    player.setPosition(player.x, player.y + 5);
    player.setDirection(Direction.LEFT);
  }

  /** `removeWeapon` : l'arme est hors de l'écran. */
  private removeWeapon(weaponId: number): void {
    this.ctx.world.requireActiveHotspot(weaponId).setPosition(-32, -32);
  }

  /** `getFighterMove` : un des 32 coups de la table `baseOffset` pour le nombre de touches reçues (tirage du hasard partagé). */
  private getFighterMove(rec: FighterRecord, baseOffset: number): number {
    const actionIndex = this.ctx.rng.number(31);
    return this.byte(u16(baseOffset + (rec.fwhits << 5) + actionIndex));
  }
}
