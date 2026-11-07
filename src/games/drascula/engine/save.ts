import { type Actor, type GameState, type Hero, INVENTORY_SIZE, LAST_CHAPTER, NUM_FLAGS, type RoomObject, type RoomState, type VonBraun, createGameState, createHero } from "./state";

/**
 * Sauvegarde de l'état de *Drascula* (vague S) : un objet JSON versionné, sans lien avec le format de ScummVM (`GSAVE*`, décision
 * « Sauvegardes » de `plan.md`). ScummVM ne sauvegarde que le chapitre, la pièce, la position du héros, l'inventaire, les drapeaux
 * et l'objet en main, et recharge la pièce (`loadGame` -> `enterRoom`) : ce portage garde en plus tout ce que les chapitres posent dans
 * l'état (`anim`, `savedTime`, Igor, Drascula, Von Braun, objets visibles et portes), pour qu'une partie reprenne exactement là où
 * elle était. Ce qui est transitoire est remis à zéro au chargement (voir `restoreState`).
 *
 * Module pur : il ne connaît ni le moteur ni le stockage ; `DrasculaEngine.saveGame` / `loadGame` s'en servent, `ui/saves.ts` écrit
 * le résultat dans les emplacements.
 */

/** Version du format. Une autre version est refusée (`parseSave` rend `null`) : l'emplacement compte alors comme vide. */
export const SAVE_VERSION = 1;

/** La pièce au moment de la sauvegarde : son numéro et l'état de ses objets (visibilité, portes, zones). */
export interface SavedRoom {
  number: number;
  objects: RoomObject[];
}

export interface SaveData {
  version: typeof SAVE_VERSION;
  /** Tick du moteur : les dates de l'état (`savedTime`, `hero.startTime`, `anim`) sont dans la même base, le chargement la reprend. */
  ticks: number;
  chapter: number;
  /** La pièce chargée (une sauvegarde sans pièce n'existe pas : le moteur refuse). */
  room: SavedRoom;
  hero: Hero;
  igor: Actor;
  drascula: Actor;
  vonBraun: VonBraun;
  flags: number[];
  inventory: number[];
  savedTime: number;
  anim: Record<string, number>;
  colorSolo: number;
  /** Le verbe ou l'objet du curseur (`takeObject`, `pickedObject`). */
  takeObject: boolean;
  pickedObject: number;
  objExit: number;
  roomMusic: number;
  musicStopped: boolean;
  excuseLook: number;
  excuseAction: number;
}

/** Copie profonde d'une valeur JSON. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Instantané de l'état. Rend `null` sans pièce chargée. Rien de ce qui est rendu ne partage de structure avec `state`.
 * Les champs transitoires (`menuScreen`, `menuBar`, `hasName`, `textName`, `previousMusic`) n'y sont pas.
 */
export function snapshotState(state: GameState, ticks: number): SaveData | null {
  const room = state.room;
  if (!room) return null;
  return clone({
    version: SAVE_VERSION,
    ticks,
    chapter: state.chapter,
    room: { number: room.number, objects: room.objects },
    hero: state.hero,
    igor: state.igor,
    drascula: state.drascula,
    vonBraun: state.vonBraun,
    flags: state.flags,
    inventory: state.inventory,
    savedTime: state.savedTime,
    anim: state.anim,
    colorSolo: state.colorSolo,
    takeObject: state.takeObject,
    pickedObject: state.pickedObject,
    objExit: state.objExit,
    roomMusic: state.roomMusic,
    musicStopped: state.musicStopped,
    excuseLook: state.excuseLook,
    excuseAction: state.excuseAction,
  });
}

/**
 * Les champs de `GameState` que la sauvegarde porte, copiés (sans la pièce, que le moteur recharge depuis sa fiche `.ALD`).
 * Remis à zéro au chargement, comme ScummVM (`loadGame`) : déplacement en cours du héros et de Von Braun. Le moteur les remet
 * dans l'état une première fois au chargement, puis une seconde fois quand la pièce est chargée (`roomLoaded` a pu y toucher).
 */
export function savedFields(data: SaveData): Partial<GameState> {
  const saved = clone(data);
  return {
    chapter: saved.chapter,
    hero: { ...saved.hero, moving: false, walkToObject: false },
    igor: saved.igor,
    drascula: saved.drascula,
    vonBraun: { ...saved.vonBraun, moving: false },
    flags: saved.flags,
    inventory: saved.inventory,
    savedTime: saved.savedTime,
    anim: saved.anim,
    colorSolo: saved.colorSolo,
    takeObject: saved.takeObject,
    pickedObject: saved.pickedObject,
    objExit: saved.objExit,
    roomMusic: saved.roomMusic,
    musicStopped: saved.musicStopped,
    excuseLook: saved.excuseLook,
    excuseAction: saved.excuseAction,
  };
}

/**
 * État d'une partie chargée, sans pièce (`room` est `null`) : un chapitre neuf (`createGameState`) où l'on remet ce qui est
 * sauvegardé. Écran d'inventaire fermé et nom sous le curseur effacé, comme ScummVM. `previousMusic` est celui de l'état remplacé
 * (`loadGame` : `previousMusic = roomMusic`).
 */
export function restoreState(data: SaveData, previousMusic: number): GameState {
  return Object.assign(createGameState(data.chapter), savedFields(data), { previousMusic });
}

/** Remet les objets sauvegardés (visibilité, portes, zones) dans la pièce rechargée : un objet n'est repris que s'il porte le même numéro à la même place. */
export function restoreObjects(room: RoomState, saved: SavedRoom): void {
  saved.objects.forEach((object, index) => {
    const target = room.objects[index];
    if (target?.id !== object.id) return;
    Object.assign(target, clone({ rect: object.rect, approach: object.approach, track: object.track, visible: object.visible, isDoor: object.isDoor, door: object.door }));
  });
}

// --- Lecture d'un JSON inconnu -------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const isInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Copie de `value` si c'est un objet qui a toutes les clés de `template`, chacune du même type (nombre fini ou booléen). */
function matchShape<T extends object>(value: unknown, template: T): T | null {
  if (!isObject(value)) return null;
  const out: Json = {};
  for (const [key, sample] of Object.entries(template)) {
    const field = value[key];
    if (typeof sample === "boolean" ? typeof field !== "boolean" : !isNumber(field)) return null;
    out[key] = field;
  }
  return out as T;
}

function intList(value: unknown, length: number): number[] | null {
  return Array.isArray(value) && value.length === length && value.every(isInt) ? [...value] : null;
}

function readObject(value: unknown): RoomObject | null {
  if (!isObject(value) || !isInt(value.id) || typeof value.name !== "string") return null;
  const rect = matchShape(value.rect, { x1: 0, y1: 0, x2: 0, y2: 0 });
  const approach = matchShape(value.approach, { x: 0, y: 0 });
  const door = value.door === null ? null : matchShape(value.door, { room: 0, x: 0, y: 0, direction: 0, exit: 0 });
  if (!rect || !approach || (value.door !== null && !door)) return null;
  if (!isInt(value.track) || typeof value.visible !== "boolean" || typeof value.isDoor !== "boolean") return null;
  return { id: value.id, name: value.name, rect, approach, track: value.track, visible: value.visible, isDoor: value.isDoor, door };
}

function readRoom(value: unknown): SavedRoom | null {
  if (!isObject(value) || !isInt(value.number) || value.number < 0 || !Array.isArray(value.objects)) return null;
  const objects = value.objects.map(readObject);
  return objects.every((object) => object !== null) ? { number: value.number, objects } : null;
}

function readAnim(value: unknown): Record<string, number> | null {
  if (!isObject(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, frame] of Object.entries(value)) {
    if (!isNumber(frame)) return null;
    out[key] = frame;
  }
  return out;
}

/**
 * Valide une valeur lue d'un JSON : rend la sauvegarde, ou `null` si ce n'en est pas une (pas un objet, autre version, champ
 * manquant ou d'un autre type, chapitre hors du jeu). Le moteur ne reçoit jamais autre chose qu'une sauvegarde de cette version.
 */
export function parseSave(value: unknown): SaveData | null {
  if (!isObject(value) || value.version !== SAVE_VERSION) return null;
  const { ticks, chapter, savedTime, colorSolo, pickedObject, objExit, roomMusic, excuseLook, excuseAction } = value;
  if (![ticks, chapter, savedTime, colorSolo, pickedObject, objExit, roomMusic, excuseLook, excuseAction].every(isInt)) return null;
  if ((chapter as number) < 1 || (chapter as number) > LAST_CHAPTER || (ticks as number) < 0) return null;
  if (typeof value.takeObject !== "boolean" || typeof value.musicStopped !== "boolean") return null;
  const room = readRoom(value.room);
  const hero = matchShape(value.hero, createHero());
  const igor = matchShape(value.igor, { x: 0, y: 0, track: 0 });
  const drascula = matchShape(value.drascula, { x: 0, y: 0, track: 0 });
  const vonBraun = matchShape(value.vonBraun, { x: 0, track: 0, moving: false, frame: 0 });
  const flags = intList(value.flags, NUM_FLAGS);
  const inventory = intList(value.inventory, INVENTORY_SIZE);
  const anim = readAnim(value.anim);
  if (!room || !hero || !igor || !drascula || !vonBraun || !flags || !inventory || !anim) return null;
  return {
    version: SAVE_VERSION,
    ticks: ticks as number,
    chapter: chapter as number,
    room,
    hero,
    igor,
    drascula,
    vonBraun,
    flags,
    inventory,
    savedTime: savedTime as number,
    anim,
    colorSolo: colorSolo as number,
    takeObject: value.takeObject,
    pickedObject: pickedObject as number,
    objExit: objExit as number,
    roomMusic: roomMusic as number,
    musicStopped: value.musicStopped,
    excuseLook: excuseLook as number,
    excuseAction: excuseAction as number,
  };
}
