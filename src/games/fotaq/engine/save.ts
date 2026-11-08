/**
 * Sauvegarde de l'état de *Flight of the Amazon Queen* (vague S) : un objet JSON versionné, sans lien avec le format de ScummVM
 * (`QueenEngine::saveGameState`, décision D7 de `plan.md`). Il garde ce que `Logic::saveState`, `Grid::saveState` et
 * `BamScene::saveState` écrivent : la pièce, les objets du jeu et ceux de l'inventaire, les zones de marche (allumées ou éteintes), les
 * points de sortie, les descriptions successives, les 211 états du jeu, la mémoire des 86 dialogues, les quatre cases visibles de
 * l'inventaire, Joe (position, orientations, échelle), le compteur d'essais du puzzle et l'animation de la course ou du combat, et
 * ajoute le dernier morceau de musique (`Sound::saveState`) et l'avancement de l'animation (ligne de la table, table du combat).
 * La tenue de Joe est l'état du jeu `JoeDressingMode` : elle n'est pas sauvegardée à part.
 *
 * Ne sont pas sauvegardés (transitoires, remis à zéro au chargement comme `Logic::setupRestoredGame`) : le mode de Joe, la commande en
 * construction, le défilement (la caméra le recalcule), les entrées en cours, le hasard, la pièce quittée et la pièce demandée.
 * Les tables sont rangées en lignes de nombres (un objet = `OBJECT_FIELDS`) : la taille d'une sauvegarde reste de l'ordre de la
 * centaine de kilo-octets, ce qui laisse dix emplacements dans `localStorage`.
 *
 * Module pur : il ne connaît ni le moteur ni le stockage ; `FotaqEngine.saveGame` / `loadGame` s'en servent, `ui/saves.ts` écrit le
 * résultat dans les emplacements.
 */

import type { JasArea, JasItem, JasObject, JasObjectDescription, JasWalkOff } from "../data/jas";
import type { SavedBam } from "./specials/bam";
import {
  Direction,
  GAME_STATE_COUNT,
  type GameData,
  type GameState,
  INVENTORY_SLOTS,
  type JoeState,
  TALK_SELECTED_COUNT,
  type TalkSelected,
} from "./state";

/** Version du format. Une autre version est refusée (`parseSave` rend `null`) : l'emplacement compte alors comme vide. */
export const SAVE_VERSION = 1;

export type { SavedBam };

/** Un tableau de lignes de nombres (voir `*_FIELDS`). */
type Rows = number[][];

export interface SaveData {
  version: typeof SAVE_VERSION;
  /** Pièce courante (`_currentRoom`) et objet par lequel Joe y est entré (`_entryObj`). */
  room: number;
  entryObject: number;
  /** `_objectData` (à partir de 0, la ligne 0 est nulle), `_itemData`, `_walkOffData`, `_objectDescription` : une ligne par entrée. */
  objects: Rows;
  items: Rows;
  /** Zones de marche : une liste de lignes par pièce (`Grid::_area`). */
  areas: Rows[];
  walkOffs: Rows;
  objectDescriptions: Rows;
  /** `_gameState` (211). */
  gameStates: number[];
  /** `_talkSelected` (86) : `hasTalkedTo` puis les quatre valeurs. */
  talkSelected: Rows;
  /** Les quatre objets d'inventaire visibles (`_inventoryItem`). */
  inventory: number[];
  joe: JoeState;
  puzzleAttemptCount: number;
  /** Dernier morceau de musique retenu (`Sound::_lastOverride`), 0 : aucun. */
  lastSong: number;
  /** Course de voiture et combat final (`BamScene`). */
  bam: SavedBam;
  /** La pièce est sans lumière (mouvements spéciaux 21 et 22 : les couleurs de la pièce sont noires). */
  lightsOff: boolean;
}

// --- Lignes de tables ----------------------------------------------------------------------------------------------------------

/** Champs d'une ligne, dans l'ordre : le type vérifie qu'aucun champ de la table d'origine n'est oublié. */
type AllFields<T, F extends readonly (keyof T)[]> = Exclude<keyof T, F[number]> extends never ? F : never;
const fields = <T>() => <const F extends readonly (keyof T)[]>(list: AllFields<T, F>): F => list;

const OBJECT_FIELDS = fields<JasObject>()(["name", "x", "y", "description", "entryObject", "room", "state", "image"]);
const ITEM_FIELDS = fields<JasItem>()(["name", "description", "state", "frame", "sfxDescription"]);
const WALK_OFF_FIELDS = fields<JasWalkOff>()(["entryObject", "x", "y"]);
const DESCRIPTION_FIELDS = fields<JasObjectDescription>()(["object", "type", "lastDescription", "lastSeenNumber"]);
/** Une zone de marche : `box` est rangée à plat (`x1`, `y1`, `x2`, `y2`) après `mapNeighbors`. */
const AREA_WIDTH = 8;
const TALK_WIDTH = 5;
const JOE_FIELDS = fields<JoeState>()(["x", "y", "startX", "startY", "facing", "prevFacing", "cutFacing", "scale"]);

function encodeRow<T, F extends readonly (keyof T)[]>(row: T, list: F): number[] {
  return list.map((key) => row[key] as number);
}

function decodeRow<T>(row: readonly number[], list: readonly (keyof T)[]): T {
  const out: Record<string, number> = {};
  list.forEach((key, i) => (out[key as string] = row[i]));
  return out as T;
}

const encodeArea = (a: JasArea): number[] => [a.mapNeighbors, a.box.x1, a.box.y1, a.box.x2, a.box.y2, a.bottomScaleFactor, a.topScaleFactor, a.object];
const decodeArea = (r: readonly number[]): JasArea => ({
  mapNeighbors: r[0],
  box: { x1: r[1], y1: r[2], x2: r[3], y2: r[4] },
  bottomScaleFactor: r[5],
  topScaleFactor: r[6],
  object: r[7],
});

// --- Instantané et reprise ---------------------------------------------------------------------------------------------------

/** Instantané de l'état : rien de ce qui est rendu ne partage de structure avec `state`. */
export function snapshotState(state: GameState, extras: { lastSong: number; bam: SavedBam; lightsOff: boolean }): SaveData {
  return {
    version: SAVE_VERSION,
    room: state.room,
    entryObject: state.entryObject,
    objects: state.objects.map((row) => encodeRow(row, OBJECT_FIELDS)),
    items: state.items.map((row) => encodeRow(row, ITEM_FIELDS)),
    areas: state.areas.map((room) => room.map(encodeArea)),
    walkOffs: state.walkOffs.map((row) => encodeRow(row, WALK_OFF_FIELDS)),
    objectDescriptions: state.objectDescriptions.map((row) => encodeRow(row, DESCRIPTION_FIELDS)),
    gameStates: [...state.gameStates],
    talkSelected: state.talkSelected.map((t) => [t.hasTalkedTo ? 1 : 0, ...t.values]),
    inventory: [...state.inventory],
    joe: { ...state.joe },
    puzzleAttemptCount: state.puzzleAttemptCount,
    lastSong: extras.lastSong,
    bam: { ...extras.bam },
    lightsOff: extras.lightsOff,
  };
}

/**
 * L'état de jeu d'une sauvegarde (copie neuve). `oldRoom` est la pièce elle-même : `eraseRoom` en remet en ordre les images, comme
 * à la sortie d'une pièce (un objet éteint en cours de partie redevient « bob éteint »). Aucune pièce n'est demandée, Joe n'a pas de
 * déplacement en attente et l'orientation de la sauvegarde est celle qu'il reprend (`cutFacing`).
 */
export function restoreState(save: SaveData): GameState {
  const joe: JoeState = { ...save.joe, startX: 0, startY: 0, cutFacing: save.joe.facing };
  return {
    room: save.room,
    oldRoom: save.room,
    newRoom: 0,
    entryObject: save.entryObject,
    objects: save.objects.map((row) => decodeRow<JasObject>(row, OBJECT_FIELDS)),
    items: save.items.map((row) => decodeRow<JasItem>(row, ITEM_FIELDS)),
    areas: save.areas.map((room) => room.map(decodeArea)),
    walkOffs: save.walkOffs.map((row) => decodeRow<JasWalkOff>(row, WALK_OFF_FIELDS)),
    objectDescriptions: save.objectDescriptions.map((row) => decodeRow<JasObjectDescription>(row, DESCRIPTION_FIELDS)),
    gameStates: [...save.gameStates],
    talkSelected: save.talkSelected.map((row): TalkSelected => ({ hasTalkedTo: row[0] === 1, values: [row[1], row[2], row[3], row[4]] })),
    inventory: [...save.inventory],
    joe,
    puzzleAttemptCount: save.puzzleAttemptCount,
  };
}

/**
 * La sauvegarde correspond aux données du jeu chargées (même nombre d'objets, de pièces, de zones, de points de sortie…) et ses
 * numéros sont dans les tables : sinon elle vient d'un autre jeu ou d'un autre fichier de données et ne peut pas être reprise.
 */
export function matchesGame(save: SaveData, data: GameData): boolean {
  const { jas } = data;
  if (save.room < 1 || save.room > jas.roomCount) return false;
  if (save.objects.length !== jas.objects.length || save.items.length !== jas.items.length) return false;
  if (save.walkOffs.length !== jas.walkOffs.length || save.objectDescriptions.length !== jas.objectDescriptions.length) return false;
  if (save.areas.length !== jas.rooms.length || save.areas.some((rows, room) => rows.length !== jas.rooms[room].areas.length)) return false;
  if (save.entryObject < 0 || save.entryObject >= save.objects.length) return false;
  return save.inventory.every((item) => item >= 0 && item < save.items.length);
}

// --- Lecture d'un JSON inconnu -------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const isInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

function intList(value: unknown, length?: number): number[] | null {
  return Array.isArray(value) && (length === undefined || value.length === length) && value.every(isInt) ? [...value] : null;
}

/** Lignes de `width` entiers. */
function rows(value: unknown, width: number, count?: number): Rows | null {
  if (!Array.isArray(value) || (count !== undefined && value.length !== count)) return null;
  const out: Rows = [];
  for (const row of value) {
    const list = intList(row, width);
    if (!list) return null;
    out.push(list);
  }
  return out;
}

function readJoe(value: unknown): JoeState | null {
  if (!isObject(value) || !JOE_FIELDS.every((key) => isInt(value[key]))) return null;
  return decodeRow<JoeState>(
    JOE_FIELDS.map((key) => value[key] as number),
    JOE_FIELDS,
  );
}

function readBam(value: unknown): SavedBam | null {
  if (!isObject(value) || !isInt(value.flag) || value.flag < 0 || value.flag > 2) return null;
  if (!isInt(value.index) || value.index < 0 || !isInt(value.fightTable) || value.fightTable < 0 || typeof value.screenShaked !== "boolean") return null;
  return { flag: value.flag as SavedBam["flag"], index: value.index, screenShaked: value.screenShaked, fightTable: value.fightTable };
}

/**
 * Valide une valeur lue d'un JSON : rend la sauvegarde, ou `null` si ce n'en est pas une (pas un objet, autre version, champ
 * manquant ou d'un autre type, ligne de table de la mauvaise largeur). Les champs en trop sont ignorés. Le moteur vérifie en plus que
 * les tailles des tables correspondent aux données du jeu (`matchesGame`).
 */
export function parseSave(value: unknown): SaveData | null {
  if (!isObject(value) || value.version !== SAVE_VERSION) return null;
  const { room, entryObject, puzzleAttemptCount, lastSong, lightsOff } = value;
  if (!isInt(room) || room < 1 || !isInt(entryObject) || entryObject < 0 || !isInt(puzzleAttemptCount) || !isInt(lastSong) || lastSong < 0 || typeof lightsOff !== "boolean") return null;
  const objects = rows(value.objects, OBJECT_FIELDS.length);
  const items = rows(value.items, ITEM_FIELDS.length);
  const walkOffs = rows(value.walkOffs, WALK_OFF_FIELDS.length);
  const objectDescriptions = rows(value.objectDescriptions, DESCRIPTION_FIELDS.length);
  const talkSelected = rows(value.talkSelected, TALK_WIDTH, TALK_SELECTED_COUNT);
  const gameStates = intList(value.gameStates, GAME_STATE_COUNT);
  const inventory = intList(value.inventory, INVENTORY_SLOTS);
  const joe = readJoe(value.joe);
  const bam = readBam(value.bam);
  if (!Array.isArray(value.areas)) return null;
  const areas = value.areas.map((room) => rows(room, AREA_WIDTH));
  if (!objects || !items || !walkOffs || !objectDescriptions || !talkSelected || !gameStates || !inventory || !joe || !bam || areas.some((a) => a === null)) return null;
  if (talkSelected.some((row) => row[0] !== 0 && row[0] !== 1)) return null;
  if (joe.facing < Direction.None || joe.facing > Direction.Back) return null;
  return {
    version: SAVE_VERSION,
    room,
    entryObject,
    objects,
    items,
    areas: areas as Rows[],
    walkOffs,
    objectDescriptions,
    gameStates,
    talkSelected,
    inventory,
    joe,
    puzzleAttemptCount,
    lastSong,
    bam,
    lightsOff,
  };
}
