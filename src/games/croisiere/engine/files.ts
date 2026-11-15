/**
 * Base de fichiers du moteur (`filesDatabase[257]`) : sprites, masques, polygones, polices et bruitages chargés par les scripts.
 *
 * Références : `dataLoader.cpp` (`loadFullBundle`, `loadFileRange`, `loadFile`, `loadSetEntry`, `updateResFileEntry`, `loadFNTSub`,
 * `loadSPLSub`, `getFileType`) et `cruise_main.cpp` (`loadFileSub1` : `.SPL` remplacé par `.ADL`, `resetFileEntry`) de ScummVM
 * (GPL v3+, release 2026.4.0). Lu puis réécrit.
 *
 * Les champs logiques (`width`, `height`, `widthInColumn`, `resType`, `resourceType`, `index`, `transparency`, `name`) suivent les
 * formules de ScummVM ; le décodage des pixels vient de `data/sets.ts` (`set`) et sert au rendu.
 * Écart volontaire : une entrée de SET absente de la table (indice égal au nombre d'entrées, que `loadFileRange` laisse passer) est
 * ignorée au lieu de lire au-delà.
 */
import { SetFile, type SetEntry } from "../data/sets";
import { NUM_FILE_ENTRIES, ObjType, ScriptError } from "./ids";
import { strlcpy } from "./memory";
import type { GameFiles } from "./overlays";

export interface FileEntry {
  /** Nom du fichier source (SET seulement ; vide pour les polices et les sons). */
  name: string;
  /** Type de l'entrée de SET (0 poly, 1 masque, 4, 5, 8 sprite) ou 1 pour une police / un son. */
  resType: number;
  /** `subData.resourceType` : `ObjType.POLY`, `BGMASK`, `SPRITE`, ou 0. */
  resourceType: number;
  width: number;
  height: number;
  widthInColumn: number;
  /** Numéro de l'entrée dans le SET (`subData.index`), −1 sinon. */
  index: number;
  transparency: number;
  /** Octets bruts (police, son, modèle polygonal) ; pour une image, ceux du fichier avant décodage. */
  data: Uint8Array;
  /** Entrée décodée du SET (pixels, masque, modèle). */
  set: SetEntry | null;
  /** Fichier d'une police ou d'un son (`name` reste vide, comme dans ScummVM) : la sauvegarde le recharge par ce nom. */
  source?: string;
}

type FileType = "SPL" | "SET" | "FNT";

function fileType(name: string): FileType {
  const dot = name.indexOf(".");
  const ext = dot < 0 ? "" : name.slice(dot);
  if (ext === ".SPL") return "SPL";
  if (ext === ".SET") return "SET";
  if (ext === ".FNT") return "FNT";
  throw new Error(`Type de fichier inconnu : ${name}`);
}

export class FileDatabase {
  readonly entries: (FileEntry | null)[] = new Array(NUM_FILE_ENTRIES).fill(null);
  constructor(private readonly files: GameFiles) {}

  get(index: number): FileEntry | null {
    return this.entries[index] ?? null;
  }

  /** `resetFileEntry`. */
  reset(index: number): void {
    if (index >= NUM_FILE_ENTRIES || index < 0) return;
    this.entries[index] = null;
  }

  /** `resetFileEntryRange`. */
  resetRange(start: number, count: number): void {
    for (let i = 0; i < count; i++) this.reset(start + i);
  }

  /** `initBigVar3` : tout vider. */
  clear(): void {
    this.entries.fill(null);
  }

  /** `Op_FindSet` : premier index dont le nom est `name` (déjà en majuscules), sinon −1. */
  findSet(name: string): number {
    for (let i = 0; i < NUM_FILE_ENTRIES; i++) if ((this.entries[i]?.name ?? "") === name) return i;
    return -1;
  }

  /** `loadFileSub1` : contenu dépacké (`extSize` + 2 octets), ou `null` si absent. */
  private read(name: string): Uint8Array | null {
    let file = name;
    const dot = name.indexOf(".");
    if (dot >= 0 && name.slice(dot) === ".SPL") file = `${name.slice(0, dot)}.ADL`;
    if (!this.files.has(file)) return null;
    const bytes = this.files.readFile(file);
    const out = new Uint8Array(bytes.length + 2);
    out.set(bytes);
    return out;
  }

  /** `loadSetEntry` : entrée `entryIdx` du SET vers `dest`. */
  private loadSetEntry(name: string, set: SetFile, raw: Uint8Array, entryIdx: number, dest: number): number {
    const header = set.headers[entryIdx];
    if (!header || dest < 0 || dest >= NUM_FILE_ENTRIES) return -1;
    const sec = set.kind === "SEC";
    let width = header.width;
    if (sec) width -= header.type * 2;
    if (!sec && header.type === 5) width -= 10;
    // updateResFileEntry(height, width, size, dest, type)
    let widthInColumn = width;
    if (header.type === 5) widthInColumn = Math.trunc((width * 8) / 5);
    const entry: FileEntry = {
      name: "",
      resType: header.type,
      resourceType: 0,
      width: Math.trunc(widthInColumn / 8),
      height: header.height,
      widthInColumn,
      index: -1,
      transparency: 0,
      data: raw,
      set: null,
    };
    if (!sec && header.type === 5) entry.width += 2;
    switch (header.type) {
      case 0:
        entry.resourceType = ObjType.POLY;
        entry.index = entryIdx;
        break;
      case 1:
        entry.width = entry.widthInColumn * 8;
        entry.resourceType = ObjType.BGMASK;
        entry.index = entryIdx;
        entry.transparency = 0;
        break;
      case 4:
        entry.width = entry.widthInColumn * 2;
        entry.resourceType = ObjType.SPRITE;
        entry.index = entryIdx;
        entry.transparency = header.transparency % 0x10;
        break;
      case 5:
        entry.resourceType = ObjType.SPRITE;
        entry.width = entry.widthInColumn;
        entry.index = entryIdx;
        entry.transparency = header.transparency;
        break;
      case 8:
        entry.resourceType = ObjType.SPRITE;
        entry.width = entry.widthInColumn;
        entry.index = entryIdx;
        entry.transparency = header.transparency;
        break;
      default:
        break;
    }
    entry.name = strlcpy(name, 13);
    try {
      entry.set = set.entry(entryIdx);
      if (entry.set.kind === "poly") entry.data = entry.set.data;
    } catch {
      entry.set = null; // type 4 ou entrée hors fichier : la logique reste valable, le rendu n'a rien à dessiner
    }
    this.entries[dest] = entry;
    return 1;
  }

  /** Police ou son : une entrée brute (`loadFNTSub`, `loadSPLSub`). */
  private loadRaw(type: "FNT" | "SPL", bytes: Uint8Array, dest: number, source: string): void {
    if (dest < 0 || dest >= NUM_FILE_ENTRIES) throw new Error(`Entrée de fichier ${dest} invalide`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const size = type === "FNT" ? view.getUint32(4) : bytes.length;
    const data = type === "FNT" ? bytes.slice(4, 4 + size) : bytes;
    this.entries[dest] = { name: "", resType: 1, resourceType: 0, width: 0, height: size, widthInColumn: 1, index: -1, transparency: 0, data, set: null, source };
  }

  /** `loadFullBundle` : toutes les entrées d'un SET à partir de `start`, ou une police / un son. Renvoie toujours 0. */
  loadFullBundle(name: string, start: number): number {
    const type = fileType(name);
    const bytes = this.read(name);
    if (!bytes) return 0;
    if (type === "SET") {
      const set = new SetFile(bytes);
      for (let i = 0; i < set.length; i++) this.loadSetEntry(name, set, bytes, i, start + i);
    } else {
      this.loadRaw(type, bytes, start, name);
    }
    return 0;
  }

  /** `loadFileRange` (`Op_LoadFrame`) : `count` entrées du SET à partir de `startIdx`, rangées à partir de `dest`. */
  loadFileRange(name: string, startIdx: number, dest: number, count: number): number {
    const type = fileType(name);
    const bytes = this.read(name);
    if (!bytes) throw new Error(`loadFileRange : ${name} absent`);
    if (type === "SET") {
      const set = new SetFile(bytes);
      for (let i = 0; i < count; i++) {
        if (startIdx + i > set.length) return 0;
        this.loadSetEntry(name, set, bytes, startIdx + i, dest + i);
      }
    } else {
      this.loadRaw(type, bytes, startIdx, name);
    }
    return 0;
  }

  /** `loadFile` : une entrée (`regenerateBackgroundIncrust`) ; −1 hors SET, 0 si l'entrée dépasse le SET. */
  loadFile(name: string, idx: number, destIdx: number): number {
    const type = fileType(name);
    const bytes = this.read(name);
    if (!bytes) return ScriptError.fileNotFound;
    if (type === "SET") {
      const set = new SetFile(bytes);
      if (destIdx > set.length) return 0;
      return this.loadSetEntry(name, set, bytes, destIdx, idx);
    }
    if (type === "FNT") {
      this.loadRaw(type, bytes, idx, name);
      return 1;
    }
    this.loadRaw(type, bytes, idx, name);
    return -1;
  }
}
