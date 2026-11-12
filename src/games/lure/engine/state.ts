/**
 * État mutable du jeu : table des valeurs (champs du script, groats), hotspots, pièces, portes (jonctions de sorties), actions aléatoires,
 * piles d'actions des personnages et données d'emplois du temps qu'elles désignent.
 *
 * Source (ScummVM, GPL v3+) : `res_struct.h` / `res_struct.cpp` (`ValueTableData`, `HotspotData`, `RoomData`, `RoomPathsData`,
 * `RoomExitJoinData`, `RandomActionSet`, `CharacterScheduleEntry`, `CharacterScheduleList::getEntry`, `CurrentActionEntry`,
 * `CurrentActionStack`) et `Resources::reloadData` (res.cpp) pour la création depuis `lure.dat`.
 *
 * Écarts volontaires (`docs/lure/engine.md`, § 9) :
 * - **aucun pointeur** : une entrée d'emploi du temps est désignée par son identifiant (`(rang de l'ensemble) << 10 | rang`, celui de
 *   `CharacterScheduleSet::getId`), une donnée « dynamique » (ordre « Dis à », action d'un clic) par une copie de ses paramètres ; les
 *   hotspots, pièces et portes sont des enregistrements simples, retrouvés par leur numéro. Tout l'état est donc sérialisable en JSON
 *   (sauvegardes, vague S) ;
 * - les grilles de cheminement sont **copiées** par pièce (ScummVM les modifie : `setOccupied`), les données d'origine restent intactes
 *   (`new Uint8Array`, et non `slice` : les fichiers lus par Node sont des `Buffer`, dont `slice` partage la mémoire).
 */

import type { LureData } from "../data/lure-data";
import type { HotspotRecord, NpcSchedules, RoomData, RoomExitJoin } from "../data/lure-dat";
import { ROOM_PATHS_HEIGHT, ROOM_PATHS_WIDTH } from "../data/lure-dat";
import { SCHEDULE_ACTION_PARAMS } from "../data/ids";
import { BlockedState, Covered, CurrentAction, MAX_PENDING_ACTIONS, NUM_VALUE_FIELDS } from "./ids";
import type { PausedCharacter } from "./paused-list";

// ---------------------------------------------------------------------------------------------------------------------------------
// Table des valeurs
// ---------------------------------------------------------------------------------------------------------------------------------

/** `ValueTableData` : 90 champs de 16 bits lus et écrits par les scripts, et quelques variables du jeu. */
export class ValueTable {
  readonly fields = new Uint16Array(NUM_VALUE_FIELDS);
  numGroats = 0;
  /** Nouvelle position du joueur demandée par un changement de pièce (traitée par la boucle : `Game::playerChangeRoom`). */
  playerNewPos = { x: 0, y: 0, roomNumber: 0 };
  textCtr1 = 0;
  textCtr2 = 0;
  /** Masque des groupes de pièces et de hotspots proposés par « Dis à » (`setHotspotFlagMask`). */
  hdrFlagMask = 1;

  reset(): void {
    this.fields.fill(0);
    this.numGroats = 0;
    this.playerNewPos = { x: 0, y: 0, roomNumber: 0 };
    this.textCtr1 = 0;
    this.textCtr2 = 0;
    this.hdrFlagMask = 1;
  }

  get(index: number): number {
    if (index < 0 || index >= NUM_VALUE_FIELDS) throw new RangeError(`champ ${index} invalide`);
    return this.fields[index]!;
  }

  set(index: number, value: number): void {
    if (index < 0 || index >= NUM_VALUE_FIELDS) throw new RangeError(`champ ${index} invalide`);
    this.fields[index] = value & 0xffff;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Emplois du temps et piles d'actions
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Donnée d'une action de pile (`CharacterScheduleEntry`) : une entrée d'emploi du temps désignée par son identifiant, ou une entrée
 * « dynamique » sans ensemble parent (action d'un clic du joueur, ordre « Dis à »), modifiable (`setDetails2`).
 */
export type Support = { kind: "schedule"; id: number } | { kind: "dynamic"; action: number; params: number[] };

export interface ActionEntry {
  action: number;
  support: Support | null;
  roomNumber: number;
}

/** Entrée d'emploi du temps résolue : ensemble (à partir de 1), rang, action et paramètres. */
export interface ScheduleEntryView {
  setId: number;
  index: number;
  action: number;
  params: readonly number[];
}

/** Lecture des emplois du temps de `0x3F06` par identifiant (`CharacterScheduleList::getEntry`, `next`, `getId`). */
export class ScheduleBook {
  constructor(private readonly schedules: NpcSchedules) {}

  /** Identifiant d'emploi du temps de l'index `index` (`Resources::getCharOffset`). */
  charOffset(index: number): number {
    const value = this.schedules.charOffsets[index];
    if (value === undefined) throw new RangeError(`index d'emploi du temps ${index} invalide`);
    return value;
  }

  /**
   * `getEntry(id, currentSet)` : `0xFFFF` = aucune entrée ; un identifiant sans ensemble (`id >> 10 == 0`) est un saut dans l'ensemble
   * courant. Rend l'identifiant global de l'entrée.
   */
  resolve(id: number, currentSetId?: number): number | null {
    if (id === 0xffff) return null;
    let setId = id >> 10;
    if (setId === 0) {
      if (currentSetId === undefined) throw new Error("saut local d'emploi du temps hors d'un emploi du temps");
      setId = currentSetId;
    }
    const set = this.schedules.schedules[setId - 1];
    if (!set) throw new Error(`ensemble d'emploi du temps ${setId} invalide`);
    const index = id & 0x3ff;
    if (index >= set.entries.length) throw new Error(`entrée ${index} invalide dans l'ensemble ${setId}`);
    return (setId << 10) | index;
  }

  entry(id: number): ScheduleEntryView {
    const setId = id >> 10;
    const index = id & 0x3ff;
    const set = this.schedules.schedules[setId - 1];
    const entry = set?.entries[index];
    if (!entry) throw new Error(`entrée d'emploi du temps ${id.toString(16)} invalide`);
    return { setId, index, action: entry.action, params: entry.params };
  }

  /** Entrée suivante dans le même ensemble, ou `null` en fin d'ensemble (`CharacterScheduleEntry::next`). */
  next(id: number): number | null {
    const setId = id >> 10;
    const index = id & 0x3ff;
    const set = this.schedules.schedules[setId - 1];
    if (!set || index + 1 >= set.entries.length) return null;
    return id + 1;
  }

  /** Action d'une donnée de pile. */
  action(support: Support): number {
    return support.kind === "dynamic" ? support.action : this.entry(support.id).action;
  }

  params(support: Support): readonly number[] {
    return support.kind === "dynamic" ? support.params : this.entry(support.id).params;
  }

  /** `param(index)` avec la vérification de ScummVM. */
  param(support: Support, index: number): number {
    const params = this.params(support);
    if (index < 0 || index >= params.length) throw new Error(`paramètre ${index} invalide pour l'action ${this.action(support)}`);
    return params[index]!;
  }

  /** Ensemble parent (`parent()`), `undefined` pour une donnée dynamique. */
  parentSet(support: Support): number | undefined {
    return support.kind === "schedule" ? support.id >> 10 : undefined;
  }

  /** `next()` d'une donnée : `null` pour une donnée dynamique (pas de parent). */
  nextSupport(support: Support): Support | null {
    if (support.kind === "dynamic") return null;
    const next = this.next(support.id);
    return next === null ? null : { kind: "schedule", id: next };
  }
}

/** Donnée dynamique d'une action à deux paramètres (`CurrentActionEntry(Action, roomNum, param1, param2)`). */
export function dynamicSupport(action: number, params: number[]): Support {
  return { kind: "dynamic", action, params };
}

/** Donnée dynamique « à la `CharacterScheduleEntry(int theAction, ...)` » : nombre de paramètres de l'action. */
export function actionSupport(action: number, ...params: number[]): Support {
  const count = SCHEDULE_ACTION_PARAMS[action] ?? 0;
  return { kind: "dynamic", action, params: params.slice(0, count) };
}

/** `CurrentActionStack` : la tête de pile est `entries[0]`. */
export class ActionStack {
  entries: ActionEntry[] = [];

  isEmpty(): boolean {
    return this.entries.length === 0;
  }

  clear(): void {
    this.entries = [];
  }

  top(): ActionEntry {
    const entry = this.entries[0];
    if (!entry) throw new Error("pile d'actions vide");
    return entry;
  }

  bottom(): ActionEntry {
    const entry = this.entries[this.entries.length - 1];
    if (!entry) throw new Error("pile d'actions vide");
    return entry;
  }

  /** Action en tête, `NO_ACTION` si la pile est vide. */
  action(): number {
    return this.entries[0]?.action ?? CurrentAction.NO_ACTION;
  }

  pop(): void {
    this.entries.shift();
  }

  get size(): number {
    return this.entries.length;
  }

  addBack(action: number, roomNumber: number, support: Support | null = null): void {
    this.entries.push({ action, support, roomNumber });
    this.validate();
  }

  addFront(action: number, roomNumber: number, support: Support | null = null): void {
    this.entries.unshift({ action, support, roomNumber });
    this.validate();
  }

  /** `addBack(Action, roomNum, param1, param2)` : action de verbe à exécuter (`DISPATCH_ACTION` avec une donnée dynamique). */
  addBackAction(action: number, roomNumber: number, param1: number, param2: number): void {
    this.addBack(CurrentAction.DISPATCH_ACTION, roomNumber, dynamicSupport(action, [param1, param2]));
  }

  addFrontAction(action: number, roomNumber: number, param1: number, param2: number): void {
    this.addFront(CurrentAction.DISPATCH_ACTION, roomNumber, dynamicSupport(action, [param1, param2]));
  }

  private validate(): void {
    if (this.entries.length > MAX_PENDING_ACTIONS) throw new Error("un personnage a trop d'actions en attente");
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Hotspots
// ---------------------------------------------------------------------------------------------------------------------------------

/** `HotspotData` : enregistrement de `0x3F07` modifiable, plus les champs d'exécution et la pile d'actions (`npcSchedule`). */
export interface HotspotState extends Omit<HotspotRecord, "npcScheduleId"> {
  npcScheduleId: number;
  npcSchedule: ActionStack;
  actionCtr: number;
  blockedState: number;
  blockedFlag: boolean;
  coveredFlag: number;
  talkMessageId: number;
  talkerId: number;
  talkDestCharacterId: number;
  talkCountdown: number;
  pauseCtr: number;
  useHotspotId: number;
  talkGate: number;
  actionHotspotId: number;
  talkOverride: number;
  scriptHotspotId: number;
}

function createHotspotState(record: HotspotRecord): HotspotState {
  return {
    ...record,
    npcSchedule: new ActionStack(),
    actionCtr: 0,
    blockedState: BlockedState.NONE,
    blockedFlag: false,
    coveredFlag: Covered.INITIAL,
    talkMessageId: 0,
    talkerId: 0,
    talkDestCharacterId: 0,
    talkCountdown: 0,
    pauseCtr: 0,
    useHotspotId: 0,
    talkGate: 0,
    actionHotspotId: 0,
    talkOverride: 0,
    scriptHotspotId: 0,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Pièces et grilles de cheminement
// ---------------------------------------------------------------------------------------------------------------------------------

/** `RoomData` : données fixes de la pièce, et ce que le jeu modifie (drapeau « trouvée », heure de sortie, grille de cheminement). */
export interface RoomState {
  readonly data: RoomData;
  roomNumber: number;
  flags: number;
  /** Heure de sortie en ms (`exitTime` ; `0xFFFF` ou 0 : pas d'avance rapide en revenant). */
  exitTime: number;
  /** Copie de la grille de 40 x 24 blocs (1 bit par bloc). */
  paths: Uint8Array;
}

/** `RoomPathsData::isOccupied(x, y)` : hors de la grille, rien n'est occupé. */
export function pathOccupied(paths: Uint8Array, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= ROOM_PATHS_WIDTH || y >= ROOM_PATHS_HEIGHT) return false;
  return (paths[y * 5 + (x >> 3)]! & (0x80 >> (x % 8))) !== 0;
}

/** `isOccupied(x, y, width)` : comme ScummVM, le pas entre deux blocs testés est de 8 (et non 1) : reproduit tel quel. */
export function pathOccupiedWidth(paths: Uint8Array, x: number, y: number, width: number): boolean {
  for (let block = 0; block < width; block++) if (pathOccupied(paths, x + 8 * block, y)) return true;
  return false;
}

function changeOccupied(paths: Uint8Array, x: number, y: number, width: number, set: boolean): void {
  if (x < 0 || y < 0 || x >= ROOM_PATHS_WIDTH || y >= ROOM_PATHS_HEIGHT) return;
  let p = y * 5 + (x >> 3);
  let mask = 0x80 >> (x % 8);
  for (let bit = 0; bit < width; bit++) {
    if (p < paths.length) paths[p] = set ? paths[p]! | mask : paths[p]! & ~mask;
    mask >>= 1;
    if (mask === 0) {
      p++;
      mask = 0x80;
    }
  }
}

export function setPathOccupied(paths: Uint8Array, x: number, y: number, width: number): void {
  changeOccupied(paths, x, y, width, true);
}

export function clearPathOccupied(paths: Uint8Array, x: number, y: number, width: number): void {
  changeOccupied(paths, x, y, width, false);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Portes, actions aléatoires
// ---------------------------------------------------------------------------------------------------------------------------------

export interface ExitJoinSideState {
  hotspotId: number;
  currentFrame: number;
  destFrame: number;
  openSound: number;
  closeSound: number;
}

/** `RoomExitJoinData` : porte partagée par deux pièces ; `blocked` non nul = fermée. */
export interface ExitJoinState {
  hotspots: [ExitJoinSideState, ExitJoinSideState];
  blocked: number;
}

export const RandomActionType = { REPEATABLE: 0, REPEAT_ONCE: 1, REPEAT_ONCE_DONE: 2 } as const;

export interface RandomActionState {
  roomNumber: number;
  ids: number[];
  types: number[];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Séquences différées
// ---------------------------------------------------------------------------------------------------------------------------------

/** `SequenceDelayData` : `timeoutCtr` en millisecondes. */
export interface DelayedSequence {
  timeoutCtr: number;
  sequenceOffset: number;
  canClear: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// État complet
// ---------------------------------------------------------------------------------------------------------------------------------

export interface LureState {
  fields: ValueTable;
  /** Hotspots dans l'ordre de `0x3F07` (l'ordre compte : `checkRoomHotspots`, inventaire, `loadRoomHotspots`). */
  hotspots: HotspotState[];
  rooms: RoomState[];
  exitJoins: ExitJoinState[];
  randomActions: RandomActionState[];
  /** Liste des séquences différées : la tête est `delayList[0]` (`push_front` à l'ajout). */
  delayList: DelayedSequence[];
  /** Personnage dont la bulle est affichée (`Resources::_talkingCharacter`). */
  talkingCharacter: number;
  /** Personnages en attente les uns des autres (`Resources::_pausedList`, `paused-list.ts`). */
  pausedList: PausedCharacter[];
  /** Conversation en cours et options déjà choisies (`talk.ts`). */
  talk: TalkSessionState;
}

/**
 * Ce que ScummVM garde dans des statiques de `talkAnimHandler` (`talkDestCharacter`, `TalkSelections`, `_talkResponse`) et dans les
 * entrées de `0x3F12` (`descId |= 0x4000`). Seul `asked` est sauvegardé : la sauvegarde est refusée pendant un dialogue.
 */
export interface TalkSessionState {
  /** Personnage à qui le joueur parle. */
  destCharacter: number;
  /** Rangs, dans l'enregistrement actif, des options montrées. */
  choices: number[];
  /** Rang de la réponse choisie dans l'enregistrement actif, -1 : aucune. */
  responseIndex: number;
  /** Ligne survolée au dernier tick de choix (0 : aucune). */
  hover: number;
  /** Dernier clic non traité : 0 aucun, 1 gauche, 2 droit. */
  click: number;
  /** Options déjà choisies : `recordId * 1024 + rang`, triées. */
  asked: number[];
}

export function createTalkSession(): TalkSessionState {
  return { destCharacter: 0, choices: [], responseIndex: -1, hover: 0, click: 0, asked: [] };
}

function copyJoin(join: RoomExitJoin): ExitJoinState {
  const side = (s: RoomExitJoin["hotspots"][number]): ExitJoinSideState => ({ ...s });
  return { hotspots: [side(join.hotspots[0]), side(join.hotspots[1])], blocked: join.blocked };
}

/** État initial (`Resources::reloadData` + `ValueTableData::reset`). */
export function createState(data: LureData): LureState {
  return {
    fields: new ValueTable(),
    hotspots: data.hotspots.map(createHotspotState),
    rooms: data.rooms.map((room) => ({ data: room, roomNumber: room.roomNumber, flags: room.flags, exitTime: room.exitTime, paths: new Uint8Array(room.paths) })),
    exitJoins: data.roomExitJoins.map(copyJoin),
    randomActions: data.schedules.randomActions.map((set) => ({
      roomNumber: set.roomNumber,
      ids: set.actions.map((a) => a.id),
      types: set.actions.map((a) => (a.repeatable ? RandomActionType.REPEATABLE : RandomActionType.REPEAT_ONCE)),
    })),
    delayList: [],
    talkingCharacter: 0,
    pausedList: [],
    talk: createTalkSession(),
  };
}
