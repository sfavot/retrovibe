/**
 * Ressources du jeu en cours (`Resources`) : état mutable, liste des hotspots actifs, recherches par numéro, activation et désactivation
 * des hotspots, portes, inventaire, actions des hotspots, personnage qui parle.
 *
 * Source (ScummVM, GPL v3+) : `res.cpp` (`Resources::reset`, `activateHotspot`, `addHotspot`, `deactivateHotspot`, `getExitJoin`,
 * `checkHotspotExtent`, `numInventoryItems`, `getHotspotAction`, `setTalkingCharacter`, `setTalkData`).
 *
 * Écarts volontaires : les recherches sont indexées (ScummVM parcourt ses listes) sans changer l'ordre des parcours qui comptent (liste
 * des hotspots actifs, hotspots de `0x3F07`) ; l'avertissement « load offset inconnu » passe par le journal.
 */

import { RATPOUCH_ID } from "../data/ids";
import type { HotspotAnimRecord, HotspotOverride, RoomExit, RoomExitHotspot, TalkHeader, TalkRecord } from "../data/lure-dat";
import type { LureContext } from "./context";
import { Hotspot } from "./hotspot";
import { CurrentAction, Field, HotspotId, SpecialAnim, VOICE_HOTSPOT_ID } from "./ids";
import { type ExitJoinState, type HotspotState, type LureState, type RoomState, createState } from "./state";

/** `TalkState` de `res.h` (vague T). */
export const TalkState = { NONE: 0, START: 1, SELECT: 2, RESPOND: 3, RESPONSE_WAIT: 4, RESPOND_2: 5, RESPOND_3: 6 } as const;

export class World {
  state!: LureState;
  /** Hotspots actifs dans l'ordre d'activation (`_activeHotspots`) : c'est l'ordre des ticks. */
  activeHotspots: Hotspot[] = [];
  /** Dialogue actif (`_activeTalkData`, vague T) : numéro d'enregistrement de `0x3F12`. */
  activeTalkData: TalkRecord | null = null;
  talkState: number = TalkState.NONE;
  talkStartEntry = 0;
  talkSelection = 0;
  /** Verbe en cours du joueur (`Resources::setCurrentAction`). */
  currentAction = 0;

  private hotspotById = new Map<number, HotspotState>();
  private roomByNumber = new Map<number, RoomState>();
  private readonly overrides = new Map<number, HotspotOverride>();
  private readonly anims = new Map<number, HotspotAnimRecord>();
  private readonly talkHeaders = new Map<number, TalkHeader>();
  private readonly actionLists = new Map<number, Map<number, number>>();
  private readonly roomExitHotspots = new Map<number, RoomExitHotspot[]>();

  constructor(private readonly ctx: LureContext) {
    const data = ctx.data;
    for (const o of data.hotspotOverrides) if (!this.overrides.has(o.hotspotId)) this.overrides.set(o.hotspotId, o);
    for (const a of data.anims) if (!this.anims.has(a.animRecordId)) this.anims.set(a.animRecordId, a);
    for (const h of data.talkHeaders.headers) if (!this.talkHeaders.has(h.hotspotId)) this.talkHeaders.set(h.hotspotId, h);
    for (const list of data.actionLists.lists) {
      if (this.actionLists.has(list.recordId)) continue;
      const map = new Map<number, number>();
      for (const action of list.actions) if (!map.has(action.action)) map.set(action.action, action.sequenceOffset);
      this.actionLists.set(list.recordId, map);
    }
    for (const [room, exits] of data.roomExitHotspots) this.roomExitHotspots.set(room, exits);
    this.reset();
  }

  /** `Resources::reset` : état initial, aucun hotspot actif, aucun dialogue. */
  reset(): void {
    this.state = createState(this.ctx.data);
    this.activeHotspots = [];
    this.activeTalkData = null;
    this.talkState = TalkState.NONE;
    this.talkStartEntry = 0;
    this.talkSelection = 0;
    this.currentAction = 0;
    this.hotspotById = new Map();
    for (const h of this.state.hotspots) if (!this.hotspotById.has(h.hotspotId)) this.hotspotById.set(h.hotspotId, h);
    this.roomByNumber = new Map();
    for (const r of this.state.rooms) if (!this.roomByNumber.has(r.roomNumber)) this.roomByNumber.set(r.roomNumber, r);
  }

  get fields() {
    return this.state.fields;
  }

  /** `getHotspot`. */
  hotspot(id: number): HotspotState | undefined {
    return this.hotspotById.get(id);
  }

  /** `getHotspot` quand ScummVM fait `assert(hotspot)`. */
  requireHotspot(id: number): HotspotState {
    const h = this.hotspotById.get(id);
    if (!h) throw new Error(`hotspot ${id.toString(16)} inconnu`);
    return h;
  }

  getActiveHotspot(id: number): Hotspot | null {
    for (const h of this.activeHotspots) if (h.hotspotId === id) return h;
    return null;
  }

  requireActiveHotspot(id: number): Hotspot {
    const h = this.getActiveHotspot(id);
    if (!h) throw new Error(`hotspot ${id.toString(16)} inactif`);
    return h;
  }

  getRoom(roomNumber: number): RoomState | undefined {
    return this.roomByNumber.get(roomNumber);
  }

  requireRoom(roomNumber: number): RoomState {
    const room = this.roomByNumber.get(roomNumber);
    if (!room) throw new Error(`pièce ${roomNumber} inexistante`);
    return room;
  }

  roomExits(roomNumber: number): readonly RoomExit[] {
    return this.getRoom(roomNumber)?.data.exits ?? [];
  }

  /** Sorties-hotspots de la pièce (`RoomData::exitHotspots`). */
  exitHotspots(roomNumber: number): readonly RoomExitHotspot[] {
    return this.getRoom(roomNumber) ? (this.roomExitHotspots.get(roomNumber) ?? []) : [];
  }

  getHotspotOverride(id: number): HotspotOverride | undefined {
    return this.overrides.get(id);
  }

  getAnimation(animRecordId: number): HotspotAnimRecord | undefined {
    return this.anims.get(animRecordId);
  }

  /** `getAnimationIndex` : rang de l'enregistrement dans `0x3F0B`, -1 s'il n'y est pas. */
  getAnimationIndex(record: HotspotAnimRecord | null): number {
    return record ? this.ctx.data.anims.indexOf(record) : -1;
  }

  getTalkHeader(id: number): TalkHeader | undefined {
    return this.talkHeaders.get(id);
  }

  /** `getHotspotAction(actionsOffset, action)` : séquence (ou message `>= 0x8000`) de l'action, 0 si aucune. */
  getHotspotAction(actionsOffset: number, action: number): number {
    return this.actionLists.get(actionsOffset)?.get(action) ?? 0;
  }

  /** `getHotspotScript(index)` : décalage dans `0x3F0D`. */
  getHotspotScript(index: number): number {
    const offset = this.ctx.data.hotspotScriptOffsets[index];
    if (offset === undefined) throw new RangeError(`script de hotspot ${index} invalide`);
    return offset;
  }

  getCharOffset(index: number): number {
    return this.ctx.schedules.charOffset(index);
  }

  getGiveTalkId(index: number): number {
    const id = this.ctx.data.talk.giveTalkIds[index];
    if (id === undefined) throw new RangeError(`dialogue « Donne » ${index} invalide`);
    return id;
  }

  /** `getExitJoin(hotspotId)` : porte dont l'un des deux côtés est ce hotspot. */
  getExitJoin(hotspotId: number): ExitJoinState | undefined {
    return this.state.exitJoins.find((j) => j.hotspots[0].hotspotId === hotspotId || j.hotspots[1].hotspotId === hotspotId);
  }

  /** `checkHotspotExtent` : le hotspot est dans la zone visible de sa pièce. */
  checkHotspotExtent(hotspot: HotspotState): boolean {
    const room = this.requireRoom(hotspot.roomNumber);
    return hotspot.startX >= room.data.clippingXStart && (room.data.clippingXEnd === 0 || hotspot.startX + 32 < room.data.clippingXEnd);
  }

  numInventoryItems(): number {
    let count = 0;
    for (const h of this.state.hotspots) if (h.roomNumber === HotspotId.PLAYER) count++;
    return count;
  }

  /** `setTalkData(offset)` : 0 efface le dialogue actif. */
  setTalkData(recordId: number): void {
    if (recordId === 0) {
      this.activeTalkData = null;
      return;
    }
    const record = this.ctx.data.talk.records.find((r) => r.recordId === recordId);
    if (!record) throw new Error(`dialogue ${recordId.toString(16)} inconnu`);
    this.activeTalkData = record;
  }

  /** `setTalkingCharacter` : retire la bulle du personnage précédent, ajoute celle du nouveau. */
  setTalkingCharacter(id: number): void {
    const state = this.state;
    if (state.talkingCharacter !== 0) {
      this.deactivateHotspot(state.talkingCharacter, true);
      const previous = this.requireHotspot(state.talkingCharacter);
      previous.talkDestCharacterId = 0;
      if (state.talkingCharacter !== id) previous.talkCountdown = 0;
    }
    state.talkingCharacter = id;
    if (id !== 0) {
      const character = this.requireActiveHotspot(id);
      this.addHotspotObject(Hotspot.special(this.ctx, character, SpecialAnim.VOICE));
    }
  }

  /**
   * `activateHotspot` : active un hotspot (ou le rend s'il l'est déjà). Un hotspot à `scriptLoadFlag` exécute son script de chargement
   * au lieu d'être ajouté ; sinon `loadOffset` choisit le chargement (1 protection de copie, 2 pas encore, 3 persistant, 5 avis de la
   * pièce 20, 6 torche de la cellule).
   */
  activateHotspot(id: number): Hotspot | null {
    const res = this.hotspot(id);
    if (!res) return null;
    res.roomNumber &= 0x7fff;

    const existing = this.getActiveHotspot(id);
    if (existing) return existing;

    if (res.npcScheduleId !== 0 && res.npcSchedule.isEmpty()) {
      const entry = this.ctx.schedules.resolve(res.npcScheduleId);
      res.npcSchedule.addFront(CurrentAction.DISPATCH_ACTION, res.roomNumber, entry === null ? null : { kind: "schedule", id: entry });
    }

    if (res.scriptLoadFlag) {
      this.ctx.script.execute(res.loadOffset);
      return null;
    }

    let loadFlag = true;
    switch (res.loadOffset) {
      case 1:
      case 2:
        loadFlag = false;
        break;
      case 3:
      case 4:
        break;
      case 5: {
        const talkIndex = this.fields.get(Field.TALK_INDEX);
        if (talkIndex < 8 || talkIndex >= 14) loadFlag = false;
        else res.startY = 85;
        break;
      }
      case 6:
        loadFlag = this.fields.get(Field.TORCH_HIDE) === 0;
        break;
      default:
        this.ctx.journal.log(`hotspot ${res.hotspotId} : chargement ${res.loadOffset} inconnu`);
    }
    if (!loadFlag) return null;

    const hotspot = this.addHotspot(id);
    if (res.loadOffset === 3) hotspot.persistent = true;
    if (res.loadOffset === 5) hotspot.handleTalkDialog();
    if (id === HotspotId.CASTLE_SKORL) {
      res.npcSchedule.clear();
      const entry = this.ctx.schedules.resolve(res.npcScheduleId);
      res.npcSchedule.addFront(CurrentAction.DISPATCH_ACTION, res.roomNumber, entry === null ? null : { kind: "schedule", id: entry });
    }
    if (id === HotspotId.GOEWIN && hotspot.roomNumber === 39) {
      // WORKAROUND de ScummVM : Goewin retrouvée dans les grottes oublie son ancien emploi du temps.
      hotspot.currentActions.clear();
      hotspot.startRoomNumber = 0;
    }
    return hotspot;
  }

  /** `addHotspot(id)` : crée le hotspot actif et l'ajoute en fin de liste. */
  addHotspot(id: number): Hotspot {
    const data = this.requireHotspot(id);
    const hotspot = new Hotspot(this.ctx, data);
    this.activeHotspots.push(hotspot);
    if (id < HotspotId.FIRST_NONCHARACTER) {
      hotspot.setDirection(0);
      hotspot.charRectY = 0;
      if (!data.npcSchedule.isEmpty() && data.npcSchedule.top().action === CurrentAction.PROCESSING_PATH) {
        data.npcSchedule.top().action = CurrentAction.DISPATCH_ACTION;
      }
    }
    return hotspot;
  }

  addHotspotObject(hotspot: Hotspot): void {
    this.activeHotspots.push(hotspot);
  }

  /**
   * `deactivateHotspot(id, isDestId)` : retire le premier hotspot actif de ce numéro ; avec `isDestId`, la bulle de parole (numéro
   * `0xFFFF`) attachée au personnage `id`.
   */
  deactivateHotspot(id: number, isDestId = false): void {
    const index = this.activeHotspots.findIndex((h) =>
      isDestId ? h.destHotspotId === id && h.hotspotId === VOICE_HOTSPOT_ID : h.hotspotId === id,
    );
    if (index >= 0) this.activeHotspots.splice(index, 1);
  }

  deactivateHotspotObject(hotspot: Hotspot): void {
    const index = this.activeHotspots.indexOf(hotspot);
    if (index >= 0) this.activeHotspots.splice(index, 1);
  }

  /** Personnages dont le numéro est entre Ratpouch et le premier objet (`resetPathfinder`). */
  *characters(): Generator<Hotspot> {
    for (let id = RATPOUCH_ID; id < HotspotId.FIRST_NONCHARACTER; id++) {
      const h = this.getActiveHotspot(id);
      if (h) yield h;
    }
  }
}
