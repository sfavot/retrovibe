/**
 * Hotspot actif (`Hotspot`) : position, taille, animation, gestionnaire de tick, script d'animation, et le comportement commun des
 * personnages qui n'est pas la marche (pile d'actions, orientation, case occupée, paroles, messages, vérifications avant une action).
 * Les verbes (`doAction` et les `do*`) sont dans `verbs.ts`.
 *
 * Source (ScummVM, GPL v3+) : `hotspots.cpp` (`Hotspot::Hotspot`, `setAnimation`, `setPosition`, `setSize`, `executeScript`, `tick`,
 * `setTickProc`, `walkTo`, `stopWalking`, `endAction`, `setDirection`, `faceHotspot`, `setRandomDest`, `setOccupied`, `updateMovement`,
 * `resetPosition`, `converse`, `showMessage`, `handleTalkDialog`, `startTalkDialog`, `isRoomExit`, `actionPrecheck`,
 * `characterWalkingCheck`, `doorCloseCheck`, `resetDirection`) et `hotspots.h` (accesseurs).
 *
 * Écarts volontaires :
 * - le moteur ne garde pas les images : `setAnimation` ne retient que l'enregistrement d'animation et le nombre d'images (le rendu les
 *   décode, vague R) ; les tailles imposées par animation (`sizeOverrides`) sont gardées ;
 * - le gestionnaire de tick est retenu par son numéro et cherché dans `ctx.handlers` à chaque tick (ScummVM garde un pointeur) ;
 * - l'état de la recherche de chemin (`_pathFinder`) est un objet simple (`pathfinder.ts`) ; la marche est dans le service `Movement`
 *   (`movement.ts`) ; le compteur d'attente des suiveurs (`HotspotTickHandlers::countdownCtr`, membre de chaque hotspot dans ScummVM)
 *   est `followerCountdown`.
 */

import { Direction } from "../data/ids";
import { type HotspotAnimRecord, type HotspotOverride, ROOM_PATHS_WIDTH } from "../data/lure-dat";
import type { LureContext } from "./context";
import { executeHotspotScript } from "./hotspot-script";
import { type PathFinderState, createPathFinder } from "./pathfinder";
import {
  AnimIndex,
  CONVERSE_COUNTDOWN_SIZE,
  CharacterMode,
  Covered,
  CurrentAction,
  Cursor,
  CursorState,
  Field,
  GENERAL_MAGIC_ID,
  HotspotId,
  Precheck,
  type PrecheckResult,
  PUZZLED_HOTSPOT_ID,
  SpecialAnim,
  TickProc,
  VOICE_HOTSPOT_ID,
} from "./ids";
import { type ActionStack, type HotspotState, clearPathOccupied, pathOccupiedWidth, setPathOccupied } from "./state";
import { doAction, doActionTop } from "./verbs";

/** Sorties-hotspots reconnues par « Ouvre » et « Ferme » (`validRoomExitHotspots`). */
const VALID_ROOM_EXIT_HOTSPOTS = new Set([
  0x2711, 0x2712, 0x2714, 0x2715, 0x2716, 0x2717, 0x2718, 0x2719, 0x271a, 0x271e, 0x271f, 0x2720, 0x2721, 0x2722, 0x2725, 0x2726, 0x2729,
  0x272a, 0x272b, 0x272c, 0x272d, 0x272e, 0x272f,
]);

/** Tailles imposées avant décodage (`sizeOverrides`) : rang d'animation, largeur, hauteur. */
const SIZE_OVERRIDES: ReadonlyArray<readonly [number, number, number]> = [
  [AnimIndex.BLACKSMITH_DEFAULT, 32, 48],
  [AnimIndex.BLACKSMITH_HAMMERING, 48, 47],
];

export class Hotspot {
  /** Données du hotspot (`resource()`), `null` pour une bulle ou un point d'interrogation. */
  readonly data: HotspotState | null;
  hotspotId: number;
  readonly originalId: number;
  private _roomNumber: number;
  x: number;
  y: number;
  destX: number;
  destY: number;
  /** 0 : marche vers un point ; `0xFFFF` : sentinelle ; sinon sortie-hotspot visée. */
  destHotspotId: number;
  walkToHotspotId = 0;
  frameWidth: number;
  width: number;
  height: number;
  widthCopy: number;
  heightCopy: number;
  yCorrection: number;
  talkX: number;
  talkY: number;
  private _layer: number;
  private _hotspotScriptOffset: number;
  frameCtr: number;
  readonly tempDest = { counter: 0, x: 0, y: 0 };
  colorOffset: number;
  readonly override: HotspotOverride | undefined;
  anim: HotspotAnimRecord | null = null;
  /**
   * Taille, décalage de couleur et hotspot au moment du dernier `setAnimation` : ScummVM construit la planche d'images à cet instant (le rendu
   * la reconstruit à partir de ce relevé, `render/sprites.ts`). Un nouvel objet à chaque `setAnimation`, `null` sans animation.
   */
  animBuild: { hotspotId: number; width: number; height: number; colorOffset: number } | null = null;
  animId = 0;
  numFrames = 0;
  frameNumber = 0;
  tickProcId: number;
  direction: number = Direction.NONE;
  persistent = false;
  skipFlag = false;
  charRectY = 0;
  voiceCtr = 0;
  blockedOffset = 0;
  exitCtr = 0;
  walkFlag = false;
  startRoomNumber = 0;
  supportValue = 0;
  /** Recherche de chemin et tronçons à parcourir (`_pathFinder`). */
  pathFinder: PathFinderState = createPathFinder();
  /** Attente avant l'action aléatoire suivante d'un suiveur (`_tickHandlers.countdownCtr`). */
  followerCountdown = 0;

  constructor(
    private readonly ctx: LureContext,
    data: HotspotState | null,
    special?: { character: Hotspot; objType: number },
  ) {
    this.data = data;
    if (data) {
      this.hotspotId = data.hotspotId;
      this.originalId = data.hotspotId;
      this._roomNumber = data.roomNumber;
      this.x = data.startX;
      this.y = data.startY;
      this.destX = data.startX;
      this.destY = data.startY;
      this.destHotspotId = 0;
      this.frameWidth = data.width;
      this.width = data.width;
      this.height = data.height;
      this.heightCopy = data.heightCopy;
      this.widthCopy = data.widthCopy;
      this.yCorrection = data.yCorrection;
      this.talkX = data.talkX;
      this.talkY = data.talkY;
      this._layer = data.layer;
      this._hotspotScriptOffset = data.hotspotScriptOffset;
      this.frameCtr = data.tickTimeout;
      this.colorOffset = data.colorOffset;
      this.override = ctx.world.getHotspotOverride(data.hotspotId);
      this.setAnimation(data.animRecordId);
      this.tickProcId = data.tickProcId;
      ctx.handlers.check(this.tickProcId);
      return;
    }

    // Constructeur spécial (bulle de parole, perplexité, exclamation).
    if (!special) throw new Error("hotspot sans données ni personnage");
    const { character, objType } = special;
    this.originalId = objType;
    this.hotspotId = VOICE_HOTSPOT_ID;
    this.override = undefined;
    this.colorOffset = 0;
    this.destHotspotId = character.hotspotId;
    this._roomNumber = character.roomNumber;
    this._hotspotScriptOffset = 0;
    this.talkX = 0;
    this.talkY = 0;
    if (objType === SpecialAnim.VOICE) {
      this.x = character.x + character.talkX + 12;
      this.y = character.y + character.talkY - 18;
      this._layer = 1;
      this.height = 18;
      this.width = 32;
      this.heightCopy = character.height + 14;
      this.widthCopy = 24;
      this.yCorrection = 1;
      this.frameCtr = 0;
      this.voiceCtr = 40;
      this.tickProcId = TickProc.VOICE;
      this.frameWidth = this.width;
      this.setAnimationIndex(AnimIndex.VOICE);
    } else {
      this.hotspotId = PUZZLED_HOTSPOT_ID;
      this.x = character.x + character.talkX + 12;
      this.y = character.y + character.talkY - 20;
      this.width = 32;
      this.height = 18;
      this.widthCopy = 19;
      this.heightCopy = 18 + character.heightCopy;
      this._layer = 1;
      this.yCorrection = 1;
      this.voiceCtr = CONVERSE_COUNTDOWN_SIZE;
      this.frameCtr = 0;
      this.tickProcId = TickProc.PUZZLED;
      this.frameWidth = this.width;
      this.setAnimationIndex(AnimIndex.VOICE);
      this.setFrameNumber(objType === SpecialAnim.PUZZLED ? 1 : 2);
      character.frameCtr = this.voiceCtr;
    }
    this.destX = this.x;
    this.destY = this.y;
    this.frameWidth = this.width;
  }

  /** `new Hotspot(character, objType)`. */
  static special(ctx: LureContext, character: Hotspot, objType: number): Hotspot {
    return new Hotspot(ctx, null, { character, objType });
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Accesseurs (hotspots.h)
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** `resource()` quand ScummVM fait `assert(_data)`. */
  get res(): HotspotState {
    if (!this.data) throw new Error(`hotspot ${this.hotspotId.toString(16)} sans données`);
    return this.data;
  }

  get roomNumber(): number {
    return this._roomNumber;
  }

  set roomNumber(value: number) {
    this._roomNumber = value;
    if (this.data) this.data.roomNumber = value;
  }

  get layer(): number {
    return this._layer;
  }

  set layer(value: number) {
    this._layer = value;
    this.res.layer = value;
  }

  get hotspotScript(): number {
    return this._hotspotScriptOffset;
  }

  setHotspotScript(offset: number): void {
    this._hotspotScriptOffset = offset;
    this.res.hotspotScriptOffset = offset;
  }

  get currentActions(): ActionStack {
    return this.res.npcSchedule;
  }

  get characterMode(): number {
    return this.res.characterMode;
  }

  set characterMode(value: number) {
    this.res.characterMode = value;
  }

  get delayCtr(): number {
    return this.res.delayCtr;
  }

  set delayCtr(value: number) {
    this.res.delayCtr = value & 0xffff;
  }

  get actionCtr(): number {
    return this.res.actionCtr;
  }

  set actionCtr(value: number) {
    this.res.actionCtr = value & 0xff;
  }

  get pauseCtr(): number {
    return this.res.pauseCtr;
  }

  set pauseCtr(value: number) {
    this.res.pauseCtr = value;
  }

  get blockedState(): number {
    return this.res.blockedState;
  }

  set blockedState(value: number) {
    this.res.blockedState = value;
  }

  get blockedFlag(): boolean {
    return this.res.blockedFlag;
  }

  set blockedFlag(value: boolean) {
    this.res.blockedFlag = value;
  }

  get coveredFlag(): number {
    return this.res.coveredFlag;
  }

  set coveredFlag(value: number) {
    this.res.coveredFlag = value;
  }

  setActions(actions: number): void {
    this.res.actions = actions >>> 0;
  }

  nameId(): number {
    return this.data?.nameId ?? 0;
  }

  /** `getName()` : nom du hotspot en codes du jeu. */
  getName(): string {
    const id = this.nameId();
    return id === 0 ? "" : this.ctx.text(id);
  }

  isActiveAnimation(): boolean {
    return this.numFrames !== 0 && this._layer !== 0;
  }

  setPosition(x: number, y: number): void {
    this.x = (x << 16) >> 16;
    this.y = (y << 16) >> 16;
    if (this.data) {
      this.data.startX = this.x;
      this.data.startY = this.y;
    }
  }

  setDestPosition(x: number, y: number): void {
    this.destX = x;
    this.destY = y;
  }

  setSize(width: number, height: number): void {
    this.width = width & 0xffff;
    this.frameWidth = this.width;
    this.height = height & 0xffff;
  }

  setFrameNumber(frame: number): void {
    // Comme ScummVM (`_frameNumber = frameNum`, sans contrôle) : Goewin captive (5 images) qui se tourne prend l'image 22 de l'animation
    // ordinaire ; le rendu ne dessine rien pour une image hors de la planche (`drawHotspot`).
    this.frameNumber = frame;
  }

  incFrameNumber(): void {
    this.frameNumber++;
    if (this.frameNumber >= this.numFrames) this.frameNumber = 0;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Animation
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** `setAnimation(animRecordId)` : 0 = aucune animation ; un enregistrement absent est une erreur. */
  setAnimation(animRecordId: number): void {
    this.animId = animRecordId;
    if (this.data) this.data.animRecordId = animRecordId;
    let record: HotspotAnimRecord | null = null;
    if (animRecordId !== 0) {
      record = this.ctx.world.getAnimation(animRecordId) ?? null;
      if (!record) throw new Error(`hotspot ${this.hotspotId.toString(16)} : animation ${animRecordId.toString(16)} inexistante`);
    }
    this.setAnimationRecord(record);
  }

  /** `setAnimationIndex(index)` : animation par rang dans `0x3F0B`. */
  setAnimationIndex(index: number): void {
    const record = this.ctx.data.anims[index];
    if (!record) throw new Error(`animation de rang ${index} inexistante`);
    this.animId = record.animRecordId;
    if (this.data) this.data.animRecordId = record.animRecordId;
    this.setAnimationRecord(record);
  }

  private setAnimationRecord(record: HotspotAnimRecord | null): void {
    this.anim = null;
    this.animBuild = null;
    this.numFrames = 0;
    this.frameNumber = 0;
    if (!record) return;
    const resources = this.ctx.data.resources;
    if (!resources.has(record.animId)) return;
    const animIndex = this.ctx.world.getAnimationIndex(record);
    const size = SIZE_OVERRIDES.find(([index]) => index === animIndex);
    if (size) this.setSize(size[1], size[2]);
    this.anim = record;
    this.animBuild = { hotspotId: this.hotspotId, width: this.width, height: this.height, colorOffset: this.colorOffset };
    const bytes = resources.get(record.animId);
    this.numFrames = bytes[0]! | (bytes[1]! << 8);
    this.frameNumber = 0;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Tick, scripts
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** `executeScript()` : vrai si le script d'animation est fini (`S2_OPCODE_UNLOAD`). */
  executeScript(): boolean {
    if (this.res.hotspotScriptOffset === 0xffff) return false;
    return executeHotspotScript(this.ctx, this);
  }

  tick(): void {
    this.ctx.handlers.run(this.tickProcId, this);
  }

  decrFrameCtr(): void {
    if (this.frameCtr > 0) this.frameCtr--;
  }

  setTickProc(id: number): void {
    if (this.data) this.data.tickProcId = id;
    this.ctx.handlers.check(id);
    this.tickProcId = id;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Pile d'actions
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** `walkTo` : empile la marche vers `(x, y)` (pied du personnage). */
  walkTo(x: number, y: number, destHotspot = 0): void {
    // Sablier pendant une recherche découpée (jamais avec le budget 0 de ScummVM).
    if (this.hotspotId === HotspotId.PLAYER && this.ctx.movement.pathfindCountdown !== 0) this.ctx.room.cursor = Cursor.TIME_START;
    this.destX = x;
    this.destY = y;
    this.destHotspotId = destHotspot;
    this.walkToHotspotId = 0;
    this.currentActions.addFront(CurrentAction.START_WALKING, this._roomNumber);
  }

  stopWalking(): void {
    this.voiceCtr = 0;
    this.actionCtr = 0;
    this.currentActions.clear();
    this.ctx.room.cursorState = CursorState.NONE;
  }

  /** `endAction()` : action finie ; la donnée d'emploi du temps passe à l'entrée suivante. */
  endAction(): void {
    this.voiceCtr = 0;
    this.actionCtr = 0;
    if (this.hotspotId === HotspotId.PLAYER) this.ctx.room.cursorState &= 2;
    const top = this.currentActions.top();
    if (top.support) top.support = this.ctx.schedules.nextSupport(top.support);
  }

  /** `doAction()` : action de la donnée en tête de pile. */
  doAction(): void;
  /** `doAction(action, hotspot)`. */
  doAction(action: number, hotspot: HotspotState | null): void;
  doAction(action?: number, hotspot?: HotspotState | null): void {
    if (action === undefined) doActionTop(this.ctx, this);
    else doAction(this.ctx, this, action, hotspot ?? null);
  }

  /** `doNothing` : action finie sans effet ; l'action suivante de la pile est relancée. */
  doNothing(): void {
    const actions = this.currentActions;
    if (!actions.isEmpty()) {
      actions.pop();
      if (!actions.isEmpty()) {
        this.blockedFlag = false;
        actions.top().action = CurrentAction.DISPATCH_ACTION;
        return;
      }
    }
    if (this.hotspotId === HotspotId.PLAYER) this.ctx.room.cursorState = CursorState.NONE;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Orientation, position
  // ---------------------------------------------------------------------------------------------------------------------------------

  setDirection(dir: number): void {
    if (this.numFrames === 0 || this.direction === dir) return;
    const anim = this.anim!;
    let frame: number;
    switch (dir) {
      case Direction.UP:
        frame = anim.upFrame;
        this.charRectY = 4;
        break;
      case Direction.DOWN:
        frame = anim.downFrame;
        this.charRectY = 4;
        break;
      case Direction.LEFT:
        frame = anim.leftFrame;
        this.charRectY = 0;
        break;
      case Direction.RIGHT:
        frame = anim.rightFrame;
        this.charRectY = 0;
        break;
      default:
        return;
    }
    this.setFrameNumber(frame);
    this.direction = dir;
  }

  faceHotspot(hotspot: HotspotState): void {
    if (hotspot.hotspotId >= HotspotId.START_NONVISUAL) {
      this.setDirection(hotspot.scriptLoadFlag);
      return;
    }
    const override = this.ctx.world.getHotspotOverride(hotspot.hotspotId);
    const xp = override ? this.x - override.xs : this.x - hotspot.startX;
    const yp = override
      ? this.y + this.heightCopy - (override.ys + hotspot.heightCopy)
      : this.y + this.heightCopy - (hotspot.startY + hotspot.heightCopy);
    if (Math.abs(yp) >= Math.abs(xp)) this.setDirection(yp < 0 ? Direction.DOWN : Direction.UP);
    else this.setDirection(xp < 0 ? Direction.RIGHT : Direction.LEFT);
  }

  faceHotspotId(id: number): void {
    this.faceHotspot(this.ctx.world.requireHotspot(id));
  }

  /** `resetDirection` : image de repos de l'orientation actuelle. */
  resetDirection(): void {
    const anim = this.anim;
    if (!anim) return;
    switch (this.direction) {
      case Direction.UP:
        this.setFrameNumber(anim.upFrame);
        break;
      case Direction.DOWN:
        this.setFrameNumber(anim.downFrame);
        break;
      case Direction.LEFT:
        this.setFrameNumber(anim.leftFrame);
        break;
      case Direction.RIGHT:
        this.setFrameNumber(anim.rightFrame);
        break;
      default:
        break;
    }
  }

  resetPosition(): void {
    this.setPosition((this.x & 0xf8) | 5, this.y);
    this.setDirection(this.direction);
  }

  /** `setRandomDest` : marche vers un point libre tiré dans la zone de marche de la pièce (20 essais). */
  setRandomDest(): void {
    const room = this.ctx.world.requireRoom(this.roomNumber);
    const rect = room.data.walkBounds;
    const actions = this.currentActions;
    if (actions.isEmpty()) actions.addFront(CurrentAction.START_WALKING, this.roomNumber);
    else actions.top().action = CurrentAction.START_WALKING;
    this.walkFlag = true;
    this.walkToHotspotId = 0;
    for (let tryCtr = 0; tryCtr < 20; tryCtr++) {
      const xp = rect.left + this.ctx.rng.number(rect.right - rect.left);
      const yp = rect.top + this.ctx.rng.number(rect.bottom - rect.top);
      this.setDestPosition(xp, yp);
      this.destHotspotId = 0;
      if (!pathOccupiedWidth(room.paths, xp, yp, 3)) break;
    }
  }

  /** `setOccupied` : marque (ou libère) les blocs de la grille de cheminement sous les pieds du personnage. */
  setOccupied(occupied: boolean): void {
    if (this.coveredFlag !== Covered.INITIAL && occupied === (this.coveredFlag === Covered.TRUE)) return;
    this.coveredFlag = occupied ? Covered.TRUE : Covered.FALSE;
    let xp = this.x >> 3;
    const yp = (this.y - 8 + this.heightCopy - 4) >> 3;
    let widthVal = Math.max(this.widthCopy >> 3, 1);
    if (xp < 0) {
      xp = -xp;
      widthVal -= xp;
      if (widthVal <= 0) return;
      xp = 0;
    }
    const x2 = xp + widthVal - ROOM_PATHS_WIDTH - 1;
    if (x2 >= 0) {
      widthVal -= x2 + 1;
      if (widthVal <= 0) return;
    }
    const paths = this.ctx.world.requireRoom(this._roomNumber).paths;
    if (occupied) setPathOccupied(paths, xp, yp, widthVal);
    else clearPathOccupied(paths, xp, yp, widthVal);
  }

  /** `updateMovement` : pendant un script de hotspot, la case reste couverte ; l'image de repos est remise. */
  updateMovement(): void {
    if (this.currentActions.action() === CurrentAction.EXEC_HOTSPOT_SCRIPT) {
      if (this.res.coveredFlag) {
        this.resetPosition();
      } else {
        this.res.coveredFlag = Covered.TRUE;
        this.setOccupied(true);
      }
    }
    this.resetDirection();
  }

  updateMovement2(mode: number): void {
    this.characterMode = mode;
    this.updateMovement();
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Paroles et messages
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** `converse` : prépare une bulle (texte `messageId`) adressée à `destCharacterId` ; le compte à rebours la montre (`handleTalkDialog`). */
  converse(destCharacterId: number, messageId: number, srcStandStill = false, destStandStill = false): void {
    const data = this.res;
    data.talkDestCharacterId = destCharacterId;
    data.talkMessageId = messageId;
    data.talkCountdown = CONVERSE_COUNTDOWN_SIZE;
    if (destCharacterId !== 0 && destCharacterId !== HotspotId.NOONE) {
      const dest = this.ctx.world.requireHotspot(destCharacterId);
      data.talkCountdown += dest.talkCountdown;
      if (destStandStill) {
        dest.talkerId = this.hotspotId;
        dest.talkGate = 0;
      }
    }
    if (srcStandStill) {
      this.delayCtr = data.talkCountdown;
      data.characterMode = CharacterMode.CONVERSING;
    }
  }

  /**
   * `showMessage` : réponse du personnage au message `messageId` (table `0x3F0F`) : bulle, boîte de texte, point d'interrogation ou
   * d'exclamation. Un personnage sans table montre le point d'interrogation.
   */
  showMessage(messageId: number, destCharacterId: number = HotspotId.NOONE): void {
    const world = this.ctx.world;
    const id = messageId & 0x7fff;
    const set = this.ctx.data.messages.find((m) => m.characterId === this.hotspotId);
    if (!set) {
      world.addHotspotObject(Hotspot.special(this.ctx, this, SpecialAnim.PUZZLED));
      return;
    }
    let idVal = set.entries.find((e) => e.id === id)?.value ?? 0xffff;
    if (idVal === 0xffff) idVal = 0x8c4;

    if (idVal === 0x76) {
      world.addHotspotObject(Hotspot.special(this.ctx, this, SpecialAnim.PUZZLED));
    } else if (idVal === 0x120) {
      world.addHotspotObject(Hotspot.special(this.ctx, this, SpecialAnim.EXCLAMATION));
    } else if (idVal >= 0x8000) {
      const active = world.hotspot(world.fields.get(Field.ACTIVE_HOTSPOT_ID));
      const itemName = active ? this.ctx.text(active.nameId) : undefined;
      this.ctx.showDialog(idVal & 0x7fff, itemName, this.getName());
    } else if (idVal !== 0) {
      this.converse(destCharacterId, idVal, true, false);
    }
  }

  /** `handleTalkDialog` : compte à rebours de la bulle du personnage (ouverture, attente d'une autre bulle, fermeture). */
  handleTalkDialog(): void {
    const data = this.res;
    const world = this.ctx.world;
    const room = this.ctx.room;
    if (data.talkCountdown === 0) return;

    if (data.talkCountdown === CONVERSE_COUNTDOWN_SIZE) {
      if (room.isDialogShowing() && world.state.talkingCharacter !== this.hotspotId) {
        data.talkCountdown++;
        if (this.delayCtr > 0) this.delayCtr += 2;
        if (data.talkDestCharacterId !== 0 && data.talkDestCharacterId !== HotspotId.NOONE) {
          const dest = world.getActiveHotspot(data.talkDestCharacterId);
          if (dest && dest.res.talkCountdown > CONVERSE_COUNTDOWN_SIZE) {
            dest.res.talkCountdown += 2;
            if (dest.delayCtr > 0) dest.delayCtr += 2;
          }
        }
        return;
      }

      data.talkCountdown--;
      this.startTalkDialog();
      if (data.talkDestCharacterId !== HotspotId.NOONE && data.talkDestCharacterId !== 0 && this.hotspotId < HotspotId.FIRST_NONCHARACTER) {
        world.fields.set(Field.ACTIVE_HOTSPOT_ID, data.talkDestCharacterId);
        const dest = world.requireHotspot(data.talkDestCharacterId);
        this.faceHotspot(dest);
        if (data.talkDestCharacterId < HotspotId.FIRST_NONCHARACTER) {
          world.getActiveHotspot(data.talkDestCharacterId)?.faceHotspot(data);
        }
      }
    } else if (room.talkDialog?.building) {
      return;
    } else if (data.talkCountdown > 0) {
      data.talkCountdown--;
      if (data.talkCountdown === 0) room.setTalkDialog(0, 0, 0, 0);
    }
  }

  startTalkDialog(): void {
    const data = this.res;
    if (this.ctx.room.roomNumber !== this.roomNumber) return;
    this.ctx.room.setTalkDialog(this.hotspotId, data.talkDestCharacterId, data.useHotspotId, data.talkMessageId);
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Avant une action
  // ---------------------------------------------------------------------------------------------------------------------------------

  isRoomExit(id: number): boolean {
    return VALID_ROOM_EXIT_HOTSPOTS.has(id);
  }

  /**
   * `actionPrecheck` : le hotspot visé est-il là, faut-il marcher jusqu'à lui (attente), un personnage visé doit-il d'abord s'arrêter ?
   * Les clients du bar passent par le service `Bar` (vague L3).
   */
  actionPrecheck(hotspot: HotspotState): PrecheckResult {
    const fields = this.ctx.world.fields;
    if (hotspot.hotspotId === HotspotId.SID || hotspot.hotspotId === HotspotId.EWAN || hotspot.hotspotId === HotspotId.NELLIE) {
      if (this.ctx.bar.getBarPlace(this) === "keepTrying") return Precheck.WAIT;
    } else if (hotspot.roomNumber !== this.roomNumber) {
      if (this.actionCtr === 0) this.showMessage(0, hotspot.hotspotId);
      this.actionCtr = 0;
      return Precheck.NOT_IN_ROOM;
    } else if (this.actionCtr !== 0) {
      this.actionCtr = this.actionCtr + 1;
      if (this.actionCtr >= 6) {
        this.ctx.journal.log("actionCtr dépassé");
        this.actionCtr = 0;
        this.showMessage(13, HotspotId.NOONE);
        return Precheck.EXCESS;
      }
      if (
        hotspot.hotspotId >= HotspotId.FIRST_NONCHARACTER ||
        hotspot.characterMode === CharacterMode.INTERACTING ||
        hotspot.characterMode === CharacterMode.WAIT_FOR_PLAYER ||
        hotspot.characterMode === CharacterMode.WAIT_FOR_INTERACT
      ) {
        if (this.characterWalkingCheck(hotspot.hotspotId)) return Precheck.WAIT;
      } else {
        this.actionCtr = 0;
        this.showMessage(14, HotspotId.NOONE);
        return Precheck.FAILED;
      }
    } else {
      this.actionCtr = 1;
      if (
        hotspot.hotspotId >= HotspotId.FIRST_NONCHARACTER ||
        (hotspot.actionHotspotId !== this.hotspotId && hotspot.characterMode === CharacterMode.WAIT_FOR_PLAYER)
      ) {
        if (this.characterWalkingCheck(hotspot.hotspotId)) return Precheck.WAIT;
      } else if (hotspot.actionHotspotId !== this.hotspotId) {
        if (fields.get(Field.AREA_FLAG) !== 2) {
          this.showMessage(5, hotspot.hotspotId);
          this.delayCtr = 4;
        }
        hotspot.talkGate = GENERAL_MAGIC_ID;
        hotspot.talkerId = this.hotspotId;
        return Precheck.WAIT;
      }
    }

    this.actionCtr = 0;
    if (hotspot.hotspotId < HotspotId.FIRST_NONCHARACTER) {
      hotspot.characterMode = CharacterMode.INTERACTING;
      hotspot.delayCtr = 30;
      hotspot.actionHotspotId = this.hotspotId;
    }
    if (this.hotspotId === HotspotId.PLAYER && this.ctx.world.state.talkingCharacter === HotspotId.PLAYER) {
      this.ctx.room.setTalkDialog(0, 0, 0, 0);
    }
    return Precheck.EXECUTE;
  }

  /**
   * `characterWalkingCheck` : vrai (et marche empilée) si le personnage doit d'abord marcher jusqu'au hotspot `id` ; 997, 998 et 999
   * sont des points fixes du jeu.
   */
  characterWalkingCheck(id: number): boolean {
    let xp: number;
    let yp: number;
    let altFlag = false;
    let walkToHotspotId = 0;
    this.walkFlag = true;
    switch (id) {
      case 997:
        xp = 169;
        yp = 146;
        altFlag = true;
        break;
      case 998:
        xp = 124;
        yp = 169;
        break;
      case 999:
        xp = 78;
        yp = 162;
        break;
      default: {
        const hotspot = this.ctx.world.hotspot(id);
        if (!hotspot) {
          this.ctx.journal.log(`characterWalkingCheck sur un hotspot inconnu ${id.toString(16)}`);
          xp = 78;
          yp = 162;
        } else if (hotspot.walkX === 0 && hotspot.walkY === 0) {
          xp = hotspot.startX;
          yp = hotspot.startY + hotspot.heightCopy - 4;
          this.walkFlag = false;
        } else {
          xp = hotspot.walkX;
          yp = hotspot.walkY & 0x7fff;
          altFlag = (hotspot.walkY & 0x8000) !== 0;
        }
        walkToHotspotId = id;
      }
    }

    if (altFlag) {
      if (this.x >> 3 !== xp >> 3 || ((this.y + this.heightCopy) >> 3) - 1 !== yp >> 3) {
        this.walkTo(xp, yp);
        this.walkToHotspotId = walkToHotspotId;
        return true;
      }
      return false;
    }
    if (Math.abs(this.x - xp) >= 8 || Math.abs(this.y + this.heightCopy - yp - 1) >= 19) {
      this.walkTo(xp, yp);
      this.walkToHotspotId = walkToHotspotId;
      return true;
    }
    return false;
  }

  /** `doorCloseCheck` : vrai si aucun personnage ne se tient dans l'embrasure de la porte `doorId`. */
  doorCloseCheck(doorId: number): boolean {
    const world = this.ctx.world;
    const door = world.getActiveHotspot(doorId);
    if (!door) {
      this.ctx.journal.log(`porte ${doorId.toString(16)} inactive`);
      return true;
    }
    const left = door.x;
    const top = door.y + door.heightCopy - door.yCorrection - door.charRectY;
    const right = door.x + door.widthCopy;
    const bottom = door.y + door.heightCopy + door.charRectY;
    for (const h of world.activeHotspots) {
      if (h.hotspotId === this.hotspotId || h.hotspotId === door.hotspotId) continue;
      if (
        h.layer === 0 ||
        h.roomNumber !== door.roomNumber ||
        h.hotspotId < HotspotId.PLAYER ||
        (h.hotspotId >= 0x408 && h.hotspotId < 0x2710)
      )
        continue;
      if (h.hotspotId === PUZZLED_HOTSPOT_ID || h.hotspotId === VOICE_HOTSPOT_ID) continue;
      const tempY = h.y + h.heightCopy;
      if (h.x >= right || h.x + h.widthCopy <= left || tempY + h.charRectY < top || tempY - h.yCorrection - h.charRectY > bottom) continue;
      return false;
    }
    return true;
  }
}
