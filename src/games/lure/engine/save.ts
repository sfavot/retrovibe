/**
 * Sauvegarde de l'état de *Lure of the Temptress* (vague S) : un objet JSON versionné, sans lien avec le format de ScummVM
 * (`LureEngine::saveGame` : `Resources`, `Game`, `Sound`, `Fights`, `Room`, décision D5 de `plan.md`). Il garde ce que ScummVM écrit,
 * et plus : ScummVM relit une sauvegarde par `Room::setRoomNumber` (entrée de pièce rejouée, recherches de chemin recommencées, images
 * perdues) ; ici la reprise est **exacte** : le moteur repris suit la même suite d'états et de hasard qu'un moteur qui n'a pas été
 * interrompu.
 *
 * Sauvegardé :
 * - la table des valeurs (90 champs, groats, nouvelle position du joueur demandée, compteurs de texte, masque de « Dis à ») ;
 * - les enregistrements de hotspots **modifiés** (champs qui diffèrent de `lure.dat`, avec leur pile d'actions) ; les pièces modifiées
 *   (drapeaux, heure de sortie, grille de cheminement), les portes et les actions aléatoires modifiées ;
 * - les hotspots **actifs**, dans l'ordre des ticks, avec ce qu'un hotspot d'exécution porte en plus de son enregistrement (position,
 *   animation, orientation, destination, compteurs) et l'état de sa marche : `pathFinder` (recherche en cours comprise : grille,
 *   tronçons, compteurs, `inProgress`) et `followerCountdown` ; les bulles de parole et de perplexité sont des hotspots dynamiques
 *   (`dest` : le personnage qui parle) ;
 * - la liste des personnages en attente (`pausedList`), les séquences différées, le personnage qui parle ;
 * - la pièce affichée (numéro, sortie visée, état du curseur, bulle), l'horloge du jeu (`ticks`, `shopMs`), l'état du jeu (tic-tac de
 *   la boutique), « Texte rapide » et « Son » (comme `Game::saveToStream`) ;
 * - l'état du hasard (`rng`) ;
 * - les numéros des sons actifs (`activeSoundNumbers` ; au chargement `restoreSounds` relance ceux de description `SF_RESTORE`) ;
 * - l'état des services qui en ont un (`Fights.saveState`, `Bar.saveState` : vagues F et L3).
 *
 * Non sauvegardé (transitoire) : la dernière entrée du pointeur, les séquences et fenêtres en cours (la sauvegarde est refusée pendant ;
 * au chargement elles sont abandonnées), la commande « Dis à » en construction, le dialogue en cours (refusé aussi), la ligne d'état
 * et le hotspot sous le pointeur (recalculés à l'image suivante), le journal.
 *
 * Les pointeurs sont des numéros (`engine.md` § 9) : tout l'état est du JSON tel quel. Un hotspot ou une pièce inconnus des données
 * font refuser le chargement **avant** toute modification du moteur.
 *
 * Module pur : il ne connaît pas le stockage ; `ui/saves.ts` écrit le résultat dans les emplacements.
 */

import { gameTextToUnicode } from "../data/charset";
import type { LureEngine } from "./game";
import { Hotspot } from "./hotspot";
import { Cursor, GameState, HotspotId, NUM_VALUE_FIELDS, TickProc } from "./ids";
import { type PathFinderState, createPathFinder } from "./pathfinder";
import type { PausedCharacter } from "./paused-list";
import {
  type ActionEntry,
  type DelayedSequence,
  type ExitJoinState,
  type HotspotState,
  type RandomActionState,
  type Support,
  createState,
  createTalkSession,
} from "./state";
import type { TalkDialogState } from "./room";

/** Version du format. Une autre version est refusée (`parseSave` rend `null`) : l'emplacement compte alors comme vide. */
export const SAVE_VERSION = 1;

type Scalar = number | boolean;
type Fields = Record<string, Scalar>;

/** Un enregistrement de hotspot de `0x3F07` modifié depuis le début : rang dans la table, champs différents, pile d'actions. */
export interface SavedHotspotData {
  index: number;
  fields: Fields;
  schedule: ActionEntry[];
}

export interface SavedRoomData {
  index: number;
  flags: number;
  exitTime: number;
  paths: number[];
}

/** Un hotspot actif (`Hotspot`) : voir `HOTSPOT_NUMBERS`, `HOTSPOT_FLAGS`. */
export interface SavedActiveHotspot {
  /** Numéro de l'enregistrement d'origine (`originalId`) : pour une bulle, son type (`SpecialAnim`). */
  original: number;
  /** Vrai : hotspot dynamique sans enregistrement (bulle, perplexité), créé pour le personnage `values.destHotspotId`. */
  special: boolean;
  values: Record<string, number>;
  flags: Record<string, boolean>;
  /** Rang de l'enregistrement d'animation dans `0x3F0B`, -1 : aucun. */
  animIndex: number;
  /** Relevé de la construction des images à `setAnimation` (`Hotspot.animBuild`, lu par le rendu), `null` sans animation. */
  animBuild: { hotspotId: number; width: number; height: number; colorOffset: number } | null;
  tempDest: { counter: number; x: number; y: number };
  pathFinder: PathFinderState;
}

export interface SaveData {
  version: typeof SAVE_VERSION;
  /** Pièce affichée et son nom (Unicode, vide si le jeu n'en donne pas) : description d'un emplacement. */
  room: number;
  roomName: string;
  ticks: number;
  shopMs: number;
  gameState: number;
  fastText: boolean;
  sound: boolean;
  /** État du générateur de hasard (`ScummvmRandom.state`). */
  rng: number;
  fields: number[];
  numGroats: number;
  playerNewPos: { x: number; y: number; roomNumber: number };
  textCtr1: number;
  textCtr2: number;
  hdrFlagMask: number;
  talkingCharacter: number;
  /** Options de dialogue déjà choisies (`talkAskedKeys`) ; ScummVM sauve le `descId` de chaque entrée. */
  talkAsked: number[];
  currentAction: number;
  pausedList: PausedCharacter[];
  delayList: DelayedSequence[];
  hotspotData: SavedHotspotData[];
  rooms: SavedRoomData[];
  exitJoins: Array<{ index: number; join: ExitJoinState }>;
  randomActions: Array<{ index: number; set: RandomActionState }>;
  active: SavedActiveHotspot[];
  display: { destRoomNumber: number; cursorState: number; talkDialog: TalkDialogState | null };
  /** Numéros des sons actifs, dans l'ordre où ils ont été lancés. */
  sounds: number[];
  /** `Fights.saveState()` et `Bar.saveState()` (JSON), absents si le service n'a pas d'état. */
  fights?: unknown;
  bar?: unknown;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Hotspots actifs : champs sauvegardés
// ---------------------------------------------------------------------------------------------------------------------------------

/** Champs numériques d'un hotspot d'exécution, assignables tels quels (ceux de l'enregistrement : `layer`, `hotspotScript`, à part). */
export const HOTSPOT_NUMBERS = [
  "hotspotId",
  "roomNumber",
  "x",
  "y",
  "destX",
  "destY",
  "destHotspotId",
  "walkToHotspotId",
  "frameWidth",
  "width",
  "height",
  "widthCopy",
  "heightCopy",
  "yCorrection",
  "talkX",
  "talkY",
  "frameCtr",
  "colorOffset",
  "animId",
  "numFrames",
  "frameNumber",
  "tickProcId",
  "direction",
  "charRectY",
  "voiceCtr",
  "blockedOffset",
  "exitCtr",
  "startRoomNumber",
  "supportValue",
  "followerCountdown",
] as const satisfies readonly (keyof Hotspot)[];

export const HOTSPOT_FLAGS = ["persistent", "skipFlag", "walkFlag"] as const satisfies readonly (keyof Hotspot)[];

/**
 * Propriétés propres d'un hotspot sauvegardées à part (`anim`, `animBuild`, `tempDest`, `pathFinder`) ou qui se déduisent des autres ou du
 * contexte : un test vérifie que toute propriété ajoutée à `Hotspot` est dans l'une des listes, pour ne pas l'oublier ici.
 */
export const HOTSPOT_DERIVED = [
  "ctx",
  "data",
  "originalId",
  "override",
  "anim",
  "animBuild",
  "tempDest",
  "pathFinder",
  "_roomNumber",
  "_layer",
  "_hotspotScriptOffset",
] as const;

type NumericHotspot = Record<(typeof HOTSPOT_NUMBERS)[number], number>;
type FlagHotspot = Record<(typeof HOTSPOT_FLAGS)[number], boolean>;

// ---------------------------------------------------------------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Peut-on sauvegarder ? Non : séquence ou menu en cours, vue à distance, dialogue (`Game::isMenuAvailable`), combat, fin de partie, et
 * conversation commencée qui attend la fin d'une bulle (le joueur a déjà le gestionnaire de dialogue, `talkState` vaut encore `NONE`).
 * Écart avec ScummVM : `isMenuAvailable` laisse sauver dans ce dernier cas, mais la sauvegarde ne contient pas le dialogue actif
 * (`Resources::loadFromStream` le remet à nul) et `talkAnimHandler` le déréférence à la reprise ; le portage refuse plutôt que de planter.
 */
export function canSave(engine: LureEngine): boolean {
  if (!engine.isMenuAvailable) return false;
  if (engine.fights.isFighting) return false;
  if (engine.world.getActiveHotspot(HotspotId.PLAYER)?.tickProcId === TickProc.TALK) return false;
  return (engine.gameState & (GameState.RESTART | GameState.CAUGHT | GameState.RESTORE)) === 0;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Capture l'état de la partie ; `null` quand le menu d'origine n'est pas disponible (`canSave`). À appeler entre deux ticks. */
export function captureSave(engine: LureEngine): SaveData | null {
  if (!canSave(engine)) return null;
  const world = engine.world;
  const state = world.state;
  const pristine = createState(engine.data);
  const room = engine.room;

  const hotspotData: SavedHotspotData[] = [];
  state.hotspots.forEach((h, index) => {
    const initial = pristine.hotspots[index]!;
    const fields: Fields = {};
    for (const key of Object.keys(initial) as Array<keyof HotspotState>) {
      if (key === "npcSchedule") continue;
      if (h[key] !== initial[key]) fields[key] = h[key] as Scalar;
    }
    const schedule = clone(h.npcSchedule.entries);
    if (Object.keys(fields).length > 0 || schedule.length > 0) hotspotData.push({ index, fields, schedule });
  });

  const rooms: SavedRoomData[] = [];
  state.rooms.forEach((r, index) => {
    const initial = pristine.rooms[index]!;
    if (r.flags !== initial.flags || r.exitTime !== initial.exitTime || !same(Array.from(r.paths), Array.from(initial.paths))) {
      rooms.push({ index, flags: r.flags, exitTime: r.exitTime, paths: Array.from(r.paths) });
    }
  });

  const exitJoins: SaveData["exitJoins"] = [];
  state.exitJoins.forEach((join, index) => {
    if (!same(join, pristine.exitJoins[index])) exitJoins.push({ index, join: clone(join) });
  });
  const randomActions: SaveData["randomActions"] = [];
  state.randomActions.forEach((set, index) => {
    if (!same(set, pristine.randomActions[index])) randomActions.push({ index, set: clone(set) });
  });

  const active = world.activeHotspots.map((h): SavedActiveHotspot => {
    const numbers = h as unknown as NumericHotspot;
    const flagValues = h as unknown as FlagHotspot;
    const values: Record<string, number> = {};
    for (const key of HOTSPOT_NUMBERS) values[key] = numbers[key];
    const flags: Record<string, boolean> = {};
    for (const key of HOTSPOT_FLAGS) flags[key] = flagValues[key];
    if (h.data) {
      values.layer = h.layer;
      values.hotspotScript = h.hotspotScript;
    }
    return {
      original: h.originalId,
      special: h.data === null,
      values,
      flags,
      animIndex: world.getAnimationIndex(h.anim),
      animBuild: h.animBuild ? { ...h.animBuild } : null,
      tempDest: { ...h.tempDest },
      pathFinder: clone(h.pathFinder),
    };
  });

  const talk = room.talkDialog;
  const save: SaveData = {
    version: SAVE_VERSION,
    room: room.roomNumber,
    roomName: room.roomData ? gameTextToUnicode(engine.text(room.roomData.data.descId)).trim() : "",
    ticks: engine.ticks,
    shopMs: engine.shopMs,
    gameState: engine.gameState,
    fastText: engine.fastTextFlag,
    sound: engine.soundFlag,
    rng: engine.rng.state,
    fields: Array.from(state.fields.fields),
    numGroats: state.fields.numGroats,
    playerNewPos: { ...state.fields.playerNewPos },
    textCtr1: state.fields.textCtr1,
    textCtr2: state.fields.textCtr2,
    hdrFlagMask: state.fields.hdrFlagMask,
    talkingCharacter: state.talkingCharacter,
    talkAsked: [...state.talk.asked],
    currentAction: world.currentAction,
    pausedList: clone(state.pausedList),
    delayList: clone(state.delayList),
    hotspotData,
    rooms,
    exitJoins,
    randomActions,
    active,
    display: { destRoomNumber: room.destRoomNumber, cursorState: room.cursorState, talkDialog: talk ? { ...talk } : null },
    sounds: engine.sound.activeSoundNumbers?.() ?? [],
  };
  const fights = engine.fights.saveState?.();
  if (fights !== undefined) save.fights = clone(fights);
  const bar = engine.bar.saveState?.();
  if (bar !== undefined) save.bar = clone(bar);
  return save;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Restauration
// ---------------------------------------------------------------------------------------------------------------------------------

/** Les références de la sauvegarde existent dans les données du jeu (hotspots, pièces, animations, sorties). */
function referencesExist(engine: LureEngine, save: SaveData): boolean {
  const world = engine.world;
  const state = world.state;
  const hotspots = state.hotspots.length;
  if (!world.getRoom(save.room)) return false;
  if (save.hotspotData.some((d) => d.index >= hotspots)) return false;
  if (save.rooms.some((r) => r.index >= state.rooms.length || r.paths.length !== state.rooms[r.index]!.paths.length)) return false;
  if (save.exitJoins.some((j) => j.index >= state.exitJoins.length)) return false;
  if (save.randomActions.some((r) => r.index >= state.randomActions.length)) return false;
  if (save.pausedList.some((p) => p.destCharId < 0xffff && p.destCharId >= 0x2710 && !world.hotspot(p.destCharId))) return false;
  const data = engine.data;
  const seen: number[] = [];
  for (const a of save.active) {
    if (a.animIndex >= data.anims.length) return false;
    if (a.special) {
      // Une bulle est créée pour un personnage actif placé avant elle.
      const character = seen.includes(a.values.destHotspotId ?? -1);
      if (!character || (a.original !== 1 && a.original !== 2 && a.original !== 3)) return false;
    } else {
      if (!world.hotspot(a.original)) return false;
      if (a.values.animId && !world.getAnimation(a.values.animId)) return false;
    }
    seen.push(a.values.hotspotId ?? -1);
  }
  const fieldKeys = Object.keys(state.hotspots[0] ?? {});
  for (const d of save.hotspotData) for (const key of Object.keys(d.fields)) if (!fieldKeys.includes(key)) return false;
  return true;
}

/**
 * Reprend la partie : le moteur revient exactement à l'état capturé. Faux (moteur intact) si la sauvegarde ne correspond pas aux données
 * du jeu. À appeler entre deux ticks ; abandonne les séquences et fenêtres en cours (`LureEngine.beginResume`).
 */
export function restoreSave(engine: LureEngine, save: SaveData): boolean {
  if (save.version !== SAVE_VERSION || !referencesExist(engine, save)) return false;
  const world = engine.world;

  engine.beginResume();
  world.reset();
  const state = world.state;

  // Valeurs, hotspots, pièces, portes, actions aléatoires.
  save.fields.forEach((value, i) => state.fields.set(i, value));
  state.fields.numGroats = save.numGroats;
  state.fields.playerNewPos = { ...save.playerNewPos };
  state.fields.textCtr1 = save.textCtr1;
  state.fields.textCtr2 = save.textCtr2;
  state.fields.hdrFlagMask = save.hdrFlagMask;
  state.talkingCharacter = save.talkingCharacter;
  state.talk = createTalkSession();
  state.talk.asked = [...(save.talkAsked ?? [])];
  state.pausedList = clone(save.pausedList);
  state.delayList = clone(save.delayList);
  for (const d of save.hotspotData) {
    const h = state.hotspots[d.index]!;
    Object.assign(h, d.fields);
    h.npcSchedule.entries = clone(d.schedule);
  }
  for (const r of save.rooms) {
    const room = state.rooms[r.index]!;
    room.flags = r.flags;
    room.exitTime = r.exitTime;
    room.paths = new Uint8Array(r.paths);
  }
  for (const j of save.exitJoins) state.exitJoins[j.index] = clone(j.join);
  for (const r of save.randomActions) state.randomActions[r.index] = clone(r.set);

  // Hotspots actifs : tous créés (une bulle pour un personnage déjà créé), puis leurs champs reposés.
  const created: Hotspot[] = [];
  for (const a of save.active) {
    let h: Hotspot;
    if (a.special) {
      const character = created.find((c) => c.hotspotId === a.values.destHotspotId);
      h = Hotspot.special(engine, character!, a.original);
    } else {
      h = new Hotspot(engine, world.requireHotspot(a.original));
    }
    created.push(h);
  }
  save.active.forEach((a, i) => {
    const h = created[i]!;
    const numbers = h as unknown as NumericHotspot;
    const flagValues = h as unknown as FlagHotspot;
    for (const key of HOTSPOT_NUMBERS) numbers[key] = a.values[key]!;
    for (const key of HOTSPOT_FLAGS) flagValues[key] = a.flags[key]!;
    if (h.data) {
      h.layer = a.values.layer!;
      h.setHotspotScript(a.values.hotspotScript!);
    }
    h.anim = a.animIndex >= 0 ? (engine.data.anims[a.animIndex] ?? null) : null;
    h.animBuild = a.animBuild ? { ...a.animBuild } : null;
    Object.assign(h.tempDest, a.tempDest);
    h.pathFinder = clone(a.pathFinder);
  });
  world.activeHotspots = created;
  world.currentAction = save.currentAction;

  // Moteur, son, services.
  engine.ticks = save.ticks;
  engine.shopMs = save.shopMs;
  engine.gameState = save.gameState;
  engine.fastTextFlag = save.fastText;
  engine.menuBar.setFastText(save.fastText);
  engine.soundFlag = save.sound;
  engine.menuBar.setSound(save.sound);
  engine.rng.seed(save.rng);
  engine.fights.reset();
  engine.fights.restoreState?.(save.fights);
  engine.bar.restoreState?.(save.bar);
  engine.sound.restoreSounds?.(save.sounds);

  // Pièce affichée : sans `setRoomNumber` (pas d'entrée rejouée, pas de rattrapage de ticks).
  const room = engine.room;
  const roomData = world.requireRoom(save.room);
  room.roomNumber = roomData.roomNumber;
  room.roomData = roomData;
  room.descId = roomData.data.descId;
  room.layers = roomData.data.layers.slice(0, roomData.data.numLayers);
  room.changes++;
  room.hotspotId = 0;
  room.hotspot = null;
  room.hotspotNameId = 0;
  room.hotspotName = "";
  room.isExit = false;
  room.statusLine = "";
  room.cursor = Cursor.ARROW;
  room.destRoomNumber = save.display.destRoomNumber;
  room.cursorState = save.display.cursorState;
  room.talkDialog = save.display.talkDialog ? { ...save.display.talkDialog } : null;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Lecture d'une valeur JSON
// ---------------------------------------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => value !== null && typeof value === "object" && !Array.isArray(value);
const isInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
const isIntList = (value: unknown): value is number[] => Array.isArray(value) && value.every(isInt);
const isList = <T>(value: unknown, item: (v: unknown) => v is T): value is T[] => Array.isArray(value) && value.every(item);
const isScalar = (value: unknown): value is Scalar => isInt(value) || typeof value === "boolean";

function isSupport(value: unknown): value is Support {
  if (!isObject(value)) return false;
  if (value.kind === "schedule") return isInt(value.id);
  return value.kind === "dynamic" && isInt(value.action) && isIntList(value.params);
}

function isActionEntry(value: unknown): value is ActionEntry {
  return isObject(value) && isInt(value.action) && isInt(value.roomNumber) && (value.support === null || isSupport(value.support));
}

function isPausedCharacter(value: unknown): value is PausedCharacter {
  return isObject(value) && isInt(value.srcCharId) && isInt(value.destCharId) && isInt(value.counter);
}

function isDelayed(value: unknown): value is DelayedSequence {
  return isObject(value) && isInt(value.timeoutCtr) && isInt(value.sequenceOffset) && typeof value.canClear === "boolean";
}

function isExitSide(value: unknown): boolean {
  return isObject(value) && ["hotspotId", "currentFrame", "destFrame", "openSound", "closeSound"].every((k) => isInt(value[k]));
}

function isExitJoin(value: unknown): value is ExitJoinState {
  return isObject(value) && Array.isArray(value.hotspots) && value.hotspots.length === 2 && value.hotspots.every(isExitSide) && isInt(value.blocked);
}

function isRandomAction(value: unknown): value is RandomActionState {
  return isObject(value) && isInt(value.roomNumber) && isIntList(value.ids) && isIntList(value.types) && value.ids.length === value.types.length;
}

function isRecord<T>(value: unknown, item: (v: unknown) => v is T): value is Record<string, T> {
  return isObject(value) && Object.values(value).every(item);
}

function isPathFinder(value: unknown): value is PathFinderState {
  if (!isObject(value)) return false;
  for (const [key, initial] of Object.entries(createPathFinder())) {
    const v = value[key];
    if (key === "list") {
      if (!isList(v, (w): w is object => isObject(w) && isInt(w.direction) && isInt(w.rawSteps))) return false;
    } else if (key === "layer") {
      if (!isIntList(v)) return false;
    } else if (typeof initial === "boolean" ? typeof v !== "boolean" : !isInt(v)) {
      return false;
    }
  }
  return true;
}

function isTalkDialog(value: unknown): value is TalkDialogState {
  return (
    isObject(value) &&
    ["srcCharacterId", "destCharacterId", "usedId", "stringId", "x", "y"].every((k) => isInt(value[k])) &&
    typeof value.building === "boolean"
  );
}

function isActive(value: unknown): value is SavedActiveHotspot {
  if (!isObject(value) || !isInt(value.original) || typeof value.special !== "boolean" || !isInt(value.animIndex)) return false;
  const { values, flags, tempDest } = value;
  if (!isRecord(values, isInt) || !isRecord(flags, (v): v is boolean => typeof v === "boolean")) return false;
  if (!HOTSPOT_NUMBERS.every((k) => isInt(values[k])) || !HOTSPOT_FLAGS.every((k) => typeof flags[k] === "boolean")) return false;
  if (!value.special && !(isInt(values.layer) && isInt(values.hotspotScript))) return false;
  const build = value.animBuild;
  if (build !== null && !(isObject(build) && ["hotspotId", "width", "height", "colorOffset"].every((k) => isInt(build[k])))) return false;
  return isObject(tempDest) && isInt(tempDest.counter) && isInt(tempDest.x) && isInt(tempDest.y) && isPathFinder(value.pathFinder);
}

const isHotspotData = (value: unknown): value is SavedHotspotData =>
  isObject(value) && isInt(value.index) && value.index >= 0 && isRecord(value.fields, isScalar) && isList(value.schedule, isActionEntry);
const isRoomData = (value: unknown): value is SavedRoomData =>
  isObject(value) && isInt(value.index) && value.index >= 0 && isInt(value.flags) && isInt(value.exitTime) && isIntList(value.paths);

/** Valide (et versionne) la valeur lue dans un emplacement : la sauvegarde, ou `null` si elle est illisible ou d'une autre version. */
export function parseSave(value: unknown): SaveData | null {
  if (!isObject(value) || value.version !== SAVE_VERSION) return null;
  const { display, playerNewPos } = value;
  const ok =
    isInt(value.room) &&
    typeof value.roomName === "string" &&
    isInt(value.ticks) &&
    isInt(value.shopMs) &&
    isInt(value.gameState) &&
    typeof value.fastText === "boolean" &&
    typeof value.sound === "boolean" &&
    isInt(value.rng) &&
    isIntList(value.fields) &&
    value.fields.length === NUM_VALUE_FIELDS &&
    isInt(value.numGroats) &&
    isObject(playerNewPos) &&
    isInt(playerNewPos.x) &&
    isInt(playerNewPos.y) &&
    isInt(playerNewPos.roomNumber) &&
    isInt(value.textCtr1) &&
    isInt(value.textCtr2) &&
    isInt(value.hdrFlagMask) &&
    isInt(value.talkingCharacter) &&
    (value.talkAsked === undefined || isIntList(value.talkAsked)) &&
    isInt(value.currentAction) &&
    isList(value.pausedList, isPausedCharacter) &&
    isList(value.delayList, isDelayed) &&
    isList(value.hotspotData, isHotspotData) &&
    isList(value.rooms, isRoomData) &&
    isList(value.exitJoins, (v): v is { index: number; join: ExitJoinState } => isObject(v) && isInt(v.index) && isExitJoin(v.join)) &&
    isList(value.randomActions, (v): v is { index: number; set: RandomActionState } => isObject(v) && isInt(v.index) && isRandomAction(v.set)) &&
    isList(value.active, isActive) &&
    isObject(display) &&
    isInt(display.destRoomNumber) &&
    isInt(display.cursorState) &&
    (display.talkDialog === null || isTalkDialog(display.talkDialog)) &&
    isIntList(value.sounds);
  if (!ok) return null;
  const save = value as unknown as SaveData;
  if (save.exitJoins.some((j) => j.index < 0) || save.randomActions.some((r) => r.index < 0)) return null;
  return save;
}
