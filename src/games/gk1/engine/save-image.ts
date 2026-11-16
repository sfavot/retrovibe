/**
 * Ce qu'est une sauvegarde de Gabriel Knight vue de l'extérieur du moteur : son format, sa version, et de quoi reconnaître une
 * image lisible. Module **léger** (aucune dépendance au moteur à l'exécution) : l'écran titre du site s'en sert pour savoir s'il
 * y a une partie à continuer sans charger la machine virtuelle. La prise d'une image et sa reprise sont dans `save.ts`.
 */
import type { DigitalState } from "../audio/digital";
import type { Reg } from "./memory";
import type { Json } from "./save-codec";
import type { VmState } from "./vm";

/** Types de segments (`SegmentKind` de `memory.ts`), répétés ici pour ne rien importer du moteur. */
type ScriptKind = 0;
type LocalsKind = 1;

/** Marque du format : une valeur qui ne la porte pas n'est pas une sauvegarde de ce jeu. */
export const SAVE_FORMAT = "gk1-image";
/** Version du format : toute modification de ce qu'une image contient la change, et les images d'une autre version sont refusées. */
export const SAVE_VERSION = 1;
/** Emplacements : le maximum de la fenêtre de sauvegarde du jeu (script 64990). */
export const SAVE_SLOT_COUNT = 20;
/** Longueur maximale du nom d'une sauvegarde (`kMaxSaveNameLength` de ScummVM, la largeur d'une entrée du catalogue d'origine). */
export const SAVE_NAME_LENGTH = 36;


export interface TableImage {
  /** Indices des cases occupées, croissants. */
  index: number[];
  /** Indices libres, dans l'ordre de leur réemploi. */
  free: number[];
  /** Nombre de cases de la table, libres comprises. */
  length: number;
}

export interface ScriptImage {
  k: ScriptKind;
  n: number;
  loaded: boolean;
  lockers: number;
  deleted: boolean;
  locals: number;
  /** Heap OU exclusif heap de la ressource, s'ils diffèrent. */
  heap?: string;
  /** Propriétés de tous les objets, dans l'ordre de la ressource, en OU exclusif avec les valeurs de la ressource. */
  vars: string;
}

export interface LocalsImage {
  k: LocalsKind;
  n: number;
  values: string;
}

export interface MemoryImage {
  stack: string;
  clones: TableImage & { origin: string; freed: number[]; sizes: number[]; vars: string };
  lists: TableImage & { data: string };
  nodes: TableImage & { data: string };
  arrays: TableImage & { types: number[]; sizes: number[]; bytes: string; words: string };
  bitmaps: TableImage & { widths: number[]; heights: number[]; skips: number[]; pixels: string };
  segments: (ScriptImage | LocalsImage)[];
  classes: string;
}

/** Une partie sauvegardée. */
export interface SaveImage {
  format: typeof SAVE_FORMAT;
  version: typeof SAVE_VERSION;
  /** Nom donné par le joueur, un caractère par octet (CP850), comme les chaînes des scripts. */
  name: string;
  /** Version du jeu donnée par les scripts à `SaveGame` (`CheckSaveGame` la compare). */
  gameVersion: string;
  /** Pièce où la partie a été sauvée (information : la reprise ne s'en sert pas). */
  room: number;
  vm: VmState;
  memory: MemoryImage;
  frameout: Json;
  sound: { driver: Json; manager: Json };
  digital: DigitalState;
  lipSync: Json;
  messages: Json;
  /** Drapeau de `GameIsRestarting` et tableau rendu par `GetSaveDir`. */
  kernel: { restarting: number; saveDir: Reg };
}

/** Valide une valeur lue du stockage : l'image, ou `null` si ce n'en est pas une ou si elle est d'une autre version. */
export function parseSaveImage(value: unknown): SaveImage | null {
  if (value === null || typeof value !== "object") return null;
  const image = value as Partial<SaveImage>;
  if (image.format !== SAVE_FORMAT || image.version !== SAVE_VERSION) return null;
  if (typeof image.name !== "string" || typeof image.gameVersion !== "string") return null;
  const isObject = (part: unknown): boolean => part !== null && typeof part === "object";
  if (!isObject(image.vm) || !Array.isArray(image.vm!.frames) || !isObject(image.memory) || !Array.isArray(image.memory!.segments)) return null;
  if (!isObject(image.frameout) || !isObject(image.sound) || !isObject(image.digital) || !isObject(image.kernel)) return null;
  return image as SaveImage;
}
