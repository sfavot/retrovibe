/**
 * Données brutes et immuables lues depuis DESKTOP.DAW (format « Desktop Adventures », variante Indy).
 * L'état de jeu (zones modifiées, inventaire…) vit ailleurs et ne modifie jamais ces objets.
 */

export const TILE_SIZE = 32;
export const TILE_PIXELS = TILE_SIZE * TILE_SIZE;
export const LAYERS = 3;

export enum Layer {
  Floor = 0,
  Object = 1,
  Roof = 2,
}

/** Attributs de tuile (champ de bits). Les bits hauts dépendent de la famille (arme, objet, personnage…). */
export const TileFlag = {
  Transparent: 1 << 0,
  Floor: 1 << 1,
  Object: 1 << 2,
  Draggable: 1 << 3,
  Roof: 1 << 4,
  Locator: 1 << 5,
  Weapon: 1 << 6,
  Item: 1 << 7,
  Character: 1 << 8,
  // Famille « Floor »
  Doorway: 1 << 16,
  // Famille « Weapon »
  Gun: 1 << 16,
  Ranged: 1 << 17,
  Blade: 1 << 18,
  Whip: 1 << 19,
  // Famille « Item »
  Key: 1 << 16,
  Tool: 1 << 17,
  Part: 1 << 18,
  Valuable: 1 << 19,
  Map: 1 << 20,
  Drink: 1 << 21,
  Edible: 1 << 22,
  // Famille « Character »
  Hero: 1 << 16,
  Enemy: 1 << 17,
  Npc: 1 << 18,
} as const;

export interface Tile {
  id: number;
  attributes: number;
  /** 32×32 index de palette, 0 = transparent. */
  pixels: Uint8Array;
  name: string;
}

export enum ZoneType {
  None = 0,
  Empty = 1,
  BlockadeNorth = 2,
  BlockadeSouth = 3,
  BlockadeEast = 4,
  BlockadeWest = 5,
  TravelStart = 6,
  TravelEnd = 7,
  Room = 8,
  Load = 9,
  Goal = 10,
  Town = 11,
  Win = 13,
  Lose = 14,
  Use = 15,
  Trade = 16,
  Find = 17,
  FindUniqueWeapon = 18,
}

export enum HotspotType {
  DropQuestItem = 0,
  SpawnLocation = 1,
  DropUniqueWeapon = 2,
  VehicleTo = 3,
  VehicleBack = 4,
  DropMap = 5,
  DropItem = 6,
  Npc = 7,
  DropWeapon = 8,
  DoorIn = 9,
  DoorOut = 10,
  /** Emplacement d'objet de soin optionnel (potion…), désactivé par script selon le hasard. */
  Bonus = 11,
  Lock = 12,
  Teleporter = 13,
}

export interface Hotspot {
  type: HotspotType;
  x: number;
  y: number;
  enabled: boolean;
  argument: number;
}

export interface ScriptItem {
  opcode: number;
  /** Les 5 arguments bruts ; ceux qui ne sont pas utilisés par l'opcode contiennent des déchets. */
  args: Int16Array;
  text: string;
}

export interface Action {
  name: string;
  conditions: ScriptItem[];
  instructions: ScriptItem[];
}

export interface MonsterPlacement {
  character: number;
  x: number;
  y: number;
}

export interface Zone {
  id: number;
  name: string;
  width: number;
  height: number;
  type: ZoneType;
  /** width × height × 3 couches, -1 = vide. */
  tiles: Int16Array;
  hotspots: Hotspot[];
  monsters: MonsterPlacement[];
  requiredItems: number[];
  providedItems: number[];
  npcs: number[];
  actions: Action[];
}

export enum PuzzleType {
  /** « TX » : un PNJ demande un objet. */
  Transaction = 0,
  /** « KL » : objet offert en échange (texte d'offre uniquement). */
  Offer = 1,
  /** « GW » : dernier échange avant l'objectif. */
  Goal = 2,
  /** « GO » : mission principale (briefing de Marcus). */
  Mission = 3,
}

export interface Puzzle {
  id: number;
  name: string;
  type: PuzzleType;
  itemClass: number;
  unknown: number;
  /** [0] demande, [1] remerciement, [2] offre / indice, [3] briefing, [4] inutilisé. */
  texts: string[];
  item: number;
}

export enum CharacterType {
  Hero = 1,
  Enemy = 2,
  Weapon = 4,
}

/** Index dans une frame de personnage. */
export enum FrameEntry {
  Up = 0,
  Down = 1,
  ExtensionUp = 2,
  Left = 3,
  ExtensionDown = 4,
  ExtensionLeft = 5,
  Right = 6,
  ExtensionRight = 7,
}

export interface Character {
  id: number;
  name: string;
  type: CharacterType;
  movementType: number;
  /** 3 frames × 8 tuiles (voir FrameEntry), -1 = absent. */
  frames: [Int16Array, Int16Array, Int16Array];
  /** Ennemi : personnage-arme utilisé ; arme : son joué. */
  reference: number;
  health: number;
  damage: number;
}

export interface GameData {
  version: number;
  startupImage: Uint8Array;
  sounds: string[];
  tiles: Tile[];
  zones: Zone[];
  puzzles: Puzzle[];
  characters: Character[];
}
