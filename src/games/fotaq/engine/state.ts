/**
 * État du monde de *Flight of the Amazon Queen* (`docs/fotaq/engine.md`, § 3) : données statiques chargées une fois
 * (`GameData` : `QUEEN.JAS`, `QUEEN2.JAS`) et état mutable sérialisable (`GameState` : objets, inventaire, zones, états du jeu,
 * pièce, Joe). Ce sont les tableaux et variables de `Logic` et de `Grid` (engines/queen/logic.h, grid.h, ScummVM) ; ce que
 * `Logic::saveState` et `Grid::saveState` écrivent est ici, en données simples (JSON) pour la vague S.
 *
 * Sources : `logic.h`, `logic.cpp` (`Logic::Logic`, `readQueenJas`, `gameState`, `saveState`), `state.cpp` (champs du mot
 * d'état d'un objet : `State::find*`, `alterOn`, `alterDefaultVerb`), `defs.h` (verbes, directions, objets d'inventaire).
 * Écarts volontaires :
 * - les tables de `QUEEN.JAS` modifiées par le jeu (objets, objets d'inventaire, zones, points de sortie, descriptions) sont
 *   **copiées** dans l'état ; les autres restent dans `GameData` (`jas`) ;
 * - `State::findUse` de ScummVM rend `STATE_USE` quand le bit 10 est levé : la fonction s'appelle ici `usesWith` et rend vrai
 *   quand l'objet attend un second objet (`STATE_USE_ON`, bit 10 à 0) ;
 * - les erreurs d'indice (`assert` de ScummVM) lèvent une exception.
 */

import type { JasArea, JasItem, JasObject, JasObjectDescription, JasWalkOff, QueenJas } from "../data/jas";
import { parseQueenJas } from "../data/jas";
import { type GameTexts, parseGameTexts } from "../data/text";

/** États du jeu (`GAME_STATE_COUNT`) : les conditions des listes de commandes et des dialogues. */
export const GAME_STATE_COUNT = 211;
/** Mémoire des dialogues (`TALK_SELECTED_COUNT`), une par `talkKey` de `.DOG` (vague T). */
export const TALK_SELECTED_COUNT = 86;
/** Réponses de Joe (`JOE_RESPONSE_MAX`) : les descriptions d'objets sont numérotées après elles dans les voix. */
export const JOE_RESPONSE_MAX = 40;
/** Cases visibles de l'inventaire. */
export const INVENTORY_SLOTS = 4;

/**
 * Verbes (`Verb` de `defs.h`) : numéros des listes de commandes de `QUEEN.JAS`, des noms de `QUEEN2.JAS` (1 à 12) et des
 * zones du panneau. 11 et 12 servent à la fois de défilement de l'inventaire et de mots de liaison (« avec », « à »).
 */
export const Verb = {
  None: 0,
  Open: 1,
  Close: 2,
  Move: 3,
  Give: 5,
  Use: 6,
  PickUp: 7,
  TalkTo: 8,
  LookAt: 9,
  WalkTo: 10,
  ScrollUp: 11,
  ScrollDown: 12,
  /** Cases 1 à 4 de l'inventaire (`VERB_INV_1` à `VERB_INV_4`). */
  Inventory1: 13,
  Inventory4: 16,
  UseJournal: 20,
  SkipText: 101,
  /** Mots de liaison (`VERB_PREP_WITH`, `VERB_PREP_TO`) : mêmes numéros que le défilement. */
  With: 11,
  To: 12,
} as const;
export type Verb = number;

/** Verbes d'action du panneau (`isVerbAction` de `command.h` : ouvrir à utiliser, plus « aller vers »). */
export function isActionVerb(verb: Verb): boolean {
  return (verb >= Verb.Open && verb <= Verb.LookAt) || verb === Verb.WalkTo;
}

/** Case d'inventaire (`isVerbInv`). */
export function isInventoryVerb(verb: Verb): boolean {
  return verb >= Verb.Inventory1 && verb <= Verb.Inventory4;
}

/** Flèches de l'inventaire (`isVerbInvScroll`). */
export function isInventoryScrollVerb(verb: Verb): boolean {
  return verb === Verb.ScrollUp || verb === Verb.ScrollDown;
}

/** Orientation (`Direction` de `defs.h`) ; 0 : aucune. */
export const Direction = { None: 0, Left: 1, Right: 2, Front: 3, Back: 4 } as const;
export type Direction = number;

/** Geste de saisie de Joe (`StateGrab`). */
export const Grab = { None: 0, Down: 1, Up: 2, Mid: 3 } as const;
export type Grab = number;

/** Mode de Joe (`JoeWalkMode` de `logic.h`) : la boucle principale exécute la commande en attente quand il vaut `Execute`. */
export const JoeWalk = { Normal: 0, Move: 1, Execute: 2, Speak: 3 } as const;
export type JoeWalk = number;

/** Objets d'inventaire cités par le code de ScummVM (`ITEM_*` de `defs.h`, numéros vérifiés sur les noms de `QUEEN2.JAS`). */
export const Item = {
  None: 0,
  Bat: 1,
  Journal: 2,
  Crowbar: 54,
  Dress: 56,
  Clothes: 58,
  Hay: 59,
  Oil: 60,
  Chicken: 61,
} as const;

/** États du jeu nommés par ScummVM (`VAR_*` de `defs.h`). */
export const GameVar = {
  HotelItemsRemoved: 3,
  JoeDressingMode: 19,
  BypassZombies: 21,
  BypassFlodaReceptionist: 35,
  GuardsTurnedOn: 85,
  HotelEscapeState: 93,
  IntroPlayed: 117,
  AzuraInLove: 167,
} as const;

/** Mode d'affichage d'une pièce (`RoomDisplayMode`). */
export const RoomDisplay = {
  /** Fondu, sans Joe. */
  FadeNoJoe: 0,
  /** Fondu, Joe placé à son entrée. */
  FadeJoe: 1,
  /** Sans fondu, avec Joe. */
  NoFadeJoe: 2,
  /** Fondu, Joe à la position demandée (`joe.startX`, `startY`). */
  FadeJoeXY: 3,
} as const;

/** Pièces nommées par ScummVM (`ROOM_*` de `defs.h`) qui servent au moteur commun. */
export const Room = {
  JunglePinnacle: 7,
  FotaqLogo: 95,
  HotelLobby: 73,
  /** Temple vu de l'extérieur : le bateau d'une cinématique y emporte Joe (`handleAnimation`). */
  TempleOutside: 43,
  /** Combat final : Joe tient le pistolet à dinosaure, il ne se retourne pas en parlant (`speakSegment`). */
  FinalFight: 69,
  /** Pièces des têtes parlantes (`FAYE_HEAD`, `AZURA_HEAD`, `FRANK_HEAD`) : le texte est en haut de l'écran. */
  FayeHead: 37,
  AzuraHead: 106,
  FrankHead: 107,
  /** Générique de fin : la cinématique n'en repart pas (`Cutaway::run`). */
  EndingCredits: 110,
  /** Joe vu de dos en grand (`setupJoeInRoom`, `joeFace`). */
  Room108: 108,
} as const;

// --- Mot d'état d'un objet (`state.cpp`) --------------------------------------------------------------------------------

const DIRECTIONS = [Direction.Back, Direction.Right, Direction.Left, Direction.Front];
const GRABS = [Grab.None, Grab.Down, Grab.Up, Grab.Mid];
/** Verbe par défaut selon les bits 4 à 7 (`State::findDefaultVerb`). */
const DEFAULT_VERBS: Verb[] = [
  Verb.None, Verb.Open, Verb.None, Verb.Close,
  Verb.None, Verb.None, Verb.LookAt, Verb.Move,
  Verb.Give, Verb.TalkTo, Verb.None, Verb.None,
  Verb.Use, Verb.None, Verb.PickUp, Verb.None,
];
const ON_BIT = 1 << 8;
const TALK_BIT = 1 << 9;
const USE_BIT = 1 << 10;

/** Orientation de Joe face à l'objet (bits 2 et 3). */
export function stateDirection(state: number): Direction {
  return DIRECTIONS[(state >> 2) & 3];
}

/** Geste de saisie (bits 0 et 1). */
export function stateGrab(state: number): Grab {
  return GRABS[state & 3];
}

/** Bit « allumé » (bit 8) : une porte fermée est « allumée » (`STATE_ON_ON`). */
export function stateOn(state: number): boolean {
  return (state & ON_BIT) !== 0;
}

/** On peut parler à l'objet (bit 9, `STATE_TALK_TALK`). */
export function stateTalks(state: number): boolean {
  return (state & TALK_BIT) !== 0;
}

/** « Utiliser » attend un second objet (`STATE_USE_ON` : bit 10 à 0). */
export function usesWith(state: number): boolean {
  return (state & USE_BIT) === 0;
}

/** Verbe proposé par défaut (bits 4 à 7). */
export function stateDefaultVerb(state: number): Verb {
  return DEFAULT_VERBS[(state >> 4) & 0xf];
}

/** `State::alterOn` : rend le mot d'état avec le bit 8 levé ou baissé. */
export function withOn(state: number, on: boolean): number {
  return on ? state | ON_BIT : state & ~ON_BIT & 0xffff;
}

/** `State::alterDefaultVerb` : rend le mot d'état avec le verbe par défaut `verb` (0 si le verbe n'a pas de code). */
export function withDefaultVerb(state: number, verb: Verb): number {
  const code = DEFAULT_VERBS.indexOf(verb);
  const value = verb === Verb.None || code < 0 ? 0 : code;
  return (state & ~0xf0 & 0xffff) | (value << 4);
}

// --- Données statiques ---------------------------------------------------------------------------------------------------

/** Données statiques du jeu, lues une fois : `QUEEN.JAS` et les textes de `QUEEN2.JAS`. */
export interface GameData {
  jas: QueenJas;
  texts: GameTexts;
}

export function loadGameData(readFile: (name: string) => Uint8Array): GameData {
  const jas = parseQueenJas(readFile("QUEEN.JAS"));
  const texts = parseGameTexts(readFile("QUEEN2.JAS"), {
    descriptions: jas.descriptionCount,
    names: jas.nameCount,
    rooms: jas.roomCount,
    actorAnimations: jas.actorAnimationCount,
    actorNames: jas.actorNameCount,
    actorFiles: jas.actorFileCount,
  });
  return { jas, texts };
}

// --- État mutable --------------------------------------------------------------------------------------------------------

/** Mémoire d'un dialogue (`TalkSelected`) : utilisée par la vague T. */
export interface TalkSelected {
  hasTalkedTo: boolean;
  values: [number, number, number, number];
}

/** Joe (`Logic::_joe` et la position du bob 0). */
export interface JoeState {
  /** Position des pieds dans le décor (bob 0). */
  x: number;
  y: number;
  /** Position où placer Joe à la prochaine pièce ou à la fin d'une cinématique (`_joe.x`, `_joe.y`, `joePos`) ; 0, 0 : aucune. */
  startX: number;
  startY: number;
  facing: Direction;
  prevFacing: Direction;
  /** Orientation imposée par une cinématique (`cutFacing`) ; 0 : aucune. */
  cutFacing: Direction;
  /** Échelle en pourcentage. */
  scale: number;
}

export interface GameState {
  /** Pièce courante (`_currentRoom`), précédente (`_oldRoom`), demandée (`_newRoom`, 0 : aucune). */
  room: number;
  oldRoom: number;
  newRoom: number;
  /** Objet par lequel on entre dans la pièce demandée (`_entryObj`) : place Joe à l'arrivée. */
  entryObject: number;
  /** Objets du jeu (`_objectData`), à partir de 1. */
  objects: JasObject[];
  /** Objets d'inventaire (`_itemData`), à partir de 1 : nom > 0 = possédé. */
  items: JasItem[];
  /** Zones de marche de chaque pièce (`Grid::_area`), à partir de 1 ; `mapNeighbors` < 0 : zone éteinte. */
  areas: JasArea[][];
  /** Points de sortie (`_walkOffData`), modifiés par les copies d'objets. */
  walkOffs: JasWalkOff[];
  /** Descriptions successives (`_objectDescription`) : `lastSeenNumber` avance. */
  objectDescriptions: JasObjectDescription[];
  /** États du jeu (`_gameState`), entiers 16 bits signés. */
  gameStates: number[];
  talkSelected: TalkSelected[];
  /** Les quatre objets d'inventaire visibles (`_inventoryItem`), 0 : case vide. */
  inventory: number[];
  joe: JoeState;
  /** Tentatives du puzzle de la pièce 102 (`_puzzleAttemptCount`, mouvement spécial 33). */
  puzzleAttemptCount: number;
}

/** État de départ d'une partie (`Logic::Logic` puis `readQueenJas`) : la pièce de l'objet d'entrée de `QUEEN.JAS`. */
export function createGameState(data: GameData): GameState {
  const { jas } = data;
  const clone = <T>(rows: T[]): T[] => rows.map((row) => ({ ...row }));
  return {
    room: jas.objects[jas.entryObject].room,
    oldRoom: 0,
    newRoom: 0,
    entryObject: 0,
    objects: clone(jas.objects),
    items: clone(jas.items),
    areas: jas.rooms.map((room) => room.areas.map((area) => ({ ...area, box: { ...area.box } }))),
    walkOffs: clone(jas.walkOffs),
    objectDescriptions: clone(jas.objectDescriptions),
    gameStates: new Array<number>(GAME_STATE_COUNT).fill(0),
    talkSelected: Array.from({ length: TALK_SELECTED_COUNT }, () => ({ hasTalkedTo: false, values: [0, 0, 0, 0] })),
    inventory: [Item.None, Item.None, Item.None, Item.None],
    joe: { x: 0, y: 0, startX: 0, startY: 0, facing: Direction.Front, prevFacing: Direction.Front, cutFacing: 0, scale: 100 },
    puzzleAttemptCount: 0,
  };
}

/** Ce que les modules du moteur lisent : les données statiques et l'état courant (le moteur, dont l'état change au chargement). */
export interface World {
  readonly data: GameData;
  readonly state: GameState;
}

/** Copie profonde de l'état (données simples). */
export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

/** Entier 16 bits signé (les `int16` de ScummVM). */
export function toInt16(value: number): number {
  return (value << 16) >> 16;
}

/** Entier 16 bits non signé (les `uint16` de ScummVM). */
export function toUint16(value: number): number {
  return value & 0xffff;
}
