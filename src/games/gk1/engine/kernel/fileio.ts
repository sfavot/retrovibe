/**
 * Noyau : `FileIO`, les douze sous-fonctions que le jeu appelle (0 à 11), sur un **système de fichiers virtuel** : jamais le
 * disque (`docs/gk1/plan.md`, vague S2 ; `docs/gk1/engine.md` § 4).
 *
 * Référence : `engines/sci/engine/kfile.cpp` (`kFileIOOpen`, `kFileIOClose`, `kFileIOReadRaw`, `kFileIOWriteRaw`,
 * `kFileIOUnlink`, `kFileIOReadString`, `kFileIOWriteString`, `kFileIOSeek`, `kFileIOFindFirst`, `kFileIOFindNext`,
 * `kFileIOExists`, `kFileIORename`) et `file.cpp` (`file_open`, `fgets_wrapper`, `DirSeeker`) de ScummVM, GPL v3 ou
 * ultérieure, lus puis réécrits.
 *
 * **Les fichiers du jeu** (un nom est ramené à sa dernière partie, sans casse) :
 * - `version`, lu au démarrage par le script 0 (11 caractères, comparés par `CheckSaveGame`) : un **fichier fourni par la page**
 *   (`GameFiles.provide`), absent par défaut — l'ouverture échoue, la version du jeu reste « xx.yyy.zzz » ;
 * - le catalogue des sauvegardes (`GKsg.cat`) : **virtuel**. Il existe s'il y a au moins une sauvegarde, et se lit dans le
 *   format d'origine (par sauvegarde : numéro sur 16 bits puis 36 octets de nom ; 0xFFFF à la fin), composé depuis les
 *   emplacements ; ce qu'on y écrit est ignoré (la fenêtre du jeu le réécrit après un effacement) ;
 * - une sauvegarde (`GKsg.007`) : **virtuelle** elle aussi. Elle existe si l'emplacement est plein, `Unlink` le vide ; son
 *   contenu ne se lit pas par `FileIO` ;
 * - `buster` **existe toujours** (`Exists`), comme dans ScummVM : le script 805 en fait dépendre une surprise du hounfour ;
 * - tout autre fichier (journal de bogues du script 64952, `%d.scr`…) : un fichier du **stockage du site**, sous la clé
 *   `file:NOM` (octets compactés), écrit à la fermeture ; la liste des noms est sous la clé `files`.
 *
 * **Valeurs rendues** (SCI2) : `Open` un descripteur à partir de 1, ou −1 ; `Close` 1 (0 pour un descripteur inconnu,
 * accumulateur inchangé pour −1) ; `ReadRaw` et `WriteRaw` le nombre d'octets (−1 si l'écriture est impossible) ; `Unlink` et
 * `Exists` 1 ou 0 ; `ReadString` la destination, ou 0 en fin de fichier ; `WriteString` le nombre d'octets ; `Seek` la
 * nouvelle position ou −1 ; `FindFirst` et `FindNext` le tampon, ou 0 ; `Rename` 0 si c'est fait, −1 sinon.
 *
 * Modes d'ouverture : 0 ouvre ou crée, placé à la fin (ajout) ; 1 ouvre un fichier existant ; 2 crée ou vide.
 *
 * Écarts volontaires : pas de cas particuliers des autres jeux ; les descripteurs ouverts
 * ne sont pas sauvegardés (fermés à la reprise d'une partie) ; les attributs de `FindFirst` sont ignorés.
 */
import { ArrayType, Segment } from "../ids";
import { fromInt, NULL_REG, type Reg, regOffset, regSegment, SIGNAL_REG, toSint16 } from "../memory";
import { packBytes, unpackBytes } from "../save-codec";
import { SAVE_NAME_LENGTH, type SaveStore, saveStoreOf } from "../save";
import type { Vm } from "../vm";
import type { Kernel } from "./kernel";

const FileOp = { Open: 0, Close: 1, ReadRaw: 2, WriteRaw: 3, Unlink: 4, ReadString: 5, WriteString: 6, Seek: 7, FindFirst: 8, FindNext: 9, Exists: 10, Rename: 11 } as const;
export const FileMode = { OpenOrCreate: 0, OpenOrFail: 1, Create: 2 } as const;
const SeekOrigin = { Start: 0, Current: 1, End: 2 } as const;
const FIRST_HANDLE = 1;
const TRUE_REG: Reg = 1;
const LF = 0x0a;
const CR = 0x0d;
const WORD_BYTES = 2;
/** Clés du stockage : la liste des noms de fichiers, et le préfixe de chaque fichier. */
const FILE_LIST_KEY = "files";
const FILE_KEY_PREFIX = "file:";
const CATALOGUE = /SG\.CAT$/;
const SAVE_FILE = /SG\.(\d{3})$/;
const CATALOGUE_END = 0xffff;
/** Fichier que `Exists` trouve toujours : le script 805 (hounfour) le cherche pour une surprise des auteurs. */
const ALWAYS_PRESENT = "BUSTER";

const FileKind = { Stored: 0, Provided: 1, Catalogue: 2 } as const;
type FileKind = (typeof FileKind)[keyof typeof FileKind];

interface OpenFile {
  readonly name: string;
  readonly kind: FileKind;
  data: Uint8Array;
  length: number;
  position: number;
  dirty: boolean;
}

/** Nom tel que le système de fichiers le connaît : dernière partie du chemin, en majuscules. */
function normalize(name: string): string {
  return name.slice(Math.max(name.lastIndexOf("\\"), name.lastIndexOf("/"), name.lastIndexOf(":")) + 1).toUpperCase();
}

function globPattern(mask: string): RegExp {
  const pattern = normalize(mask === "*.*" ? "*" : mask).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${pattern}$`);
}

/** Les fichiers que le jeu voit. */
export class GameFiles {
  /** Fichiers en lecture seule fournis par la page, par nom normalisé (`provide`). */
  private readonly provided = new Map<string, Uint8Array>();
  private readonly open = new Map<number, OpenFile>();
  private nextHandle = FIRST_HANDLE;
  /** Noms restant à rendre par `FindNext`. */
  private found: string[] = [];

  constructor(private readonly store: SaveStore) {}

  /** La page fournit un fichier du CD en lecture seule (`VERSION`…). */
  provide(name: string, bytes: Uint8Array): void {
    this.provided.set(normalize(name), bytes);
  }

  /** Nombre de descripteurs ouverts. */
  get openCount(): number {
    return this.open.size;
  }

  // --- Fichiers du stockage ---

  private storedNames(): string[] {
    try {
      const names: unknown = JSON.parse(this.store.storage.get(FILE_LIST_KEY) ?? "[]");
      return Array.isArray(names) ? names.filter((name): name is string => typeof name === "string") : [];
    } catch {
      return [];
    }
  }

  private readStored(name: string): Uint8Array | undefined {
    const text = this.store.storage.get(FILE_KEY_PREFIX + name);
    if (text === null) return undefined;
    try {
      return unpackBytes(text);
    } catch {
      return undefined;
    }
  }

  private writeStored(name: string, bytes: Uint8Array): boolean {
    if (!this.store.storage.set(FILE_KEY_PREFIX + name, packBytes(bytes))) return false;
    const names = this.storedNames();
    if (!names.includes(name)) this.store.storage.set(FILE_LIST_KEY, JSON.stringify([...names, name]));
    return true;
  }

  private removeStored(name: string): boolean {
    const names = this.storedNames();
    if (!names.includes(name)) return false;
    this.store.storage.remove(FILE_KEY_PREFIX + name);
    this.store.storage.set(FILE_LIST_KEY, JSON.stringify(names.filter((other) => other !== name)));
    return true;
  }

  // --- Sauvegardes vues comme des fichiers ---

  private saves(): { number: number; name: string }[] {
    const out: { number: number; name: string }[] = [];
    for (let slot = 1; slot <= this.store.slots.count; slot++) {
      const stored = this.store.slots.read(slot);
      if (stored) out.push({ number: slot - 1, name: stored.save.name });
    }
    return out;
  }

  private saveNumber(name: string): number | undefined {
    const match = SAVE_FILE.exec(name);
    return match ? Number(match[1]) : undefined;
  }

  private hasSave(number: number): boolean {
    return this.store.slots.read(number + 1) !== null;
  }

  /** Catalogue dans le format d'origine. */
  private catalogue(): Uint8Array {
    const saves = this.saves();
    const entry = WORD_BYTES + SAVE_NAME_LENGTH;
    const bytes = new Uint8Array(saves.length * entry + WORD_BYTES);
    saves.forEach((save, index) => {
      bytes[index * entry] = save.number & 0xff;
      bytes[index * entry + 1] = save.number >> 8;
      for (let i = 0; i < Math.min(save.name.length, SAVE_NAME_LENGTH); i++) bytes[index * entry + WORD_BYTES + i] = save.name.charCodeAt(i) & 0xff;
    });
    bytes[saves.length * entry] = CATALOGUE_END & 0xff;
    bytes[saves.length * entry + 1] = CATALOGUE_END >> 8;
    return bytes;
  }

  // --- Opérations ---

  exists(rawName: string): boolean {
    const name = normalize(rawName);
    if (name === "") return false;
    if (name === ALWAYS_PRESENT) return true;
    if (CATALOGUE.test(name)) return this.saves().length > 0;
    const number = this.saveNumber(name);
    if (number !== undefined) return this.hasSave(number);
    return this.provided.has(name) || this.storedNames().includes(name);
  }

  /** Descripteur, ou −1. */
  openFile(rawName: string, mode: number): number {
    const name = normalize(rawName);
    if (name === "" || this.saveNumber(name) !== undefined) return -1;
    let file: OpenFile;
    if (CATALOGUE.test(name)) {
      // Sans sauvegarde, pas de catalogue : la fenêtre du jeu ouvre celui-ci pour savoir s'il y en a.
      if (mode !== FileMode.Create && this.saves().length === 0) return -1;
      const data = mode === FileMode.Create ? new Uint8Array(0) : this.catalogue();
      file = { name, kind: FileKind.Catalogue, data, length: data.length, position: 0, dirty: false };
    } else if (this.provided.has(name)) {
      if (mode === FileMode.Create) return -1;
      const data = this.provided.get(name)!;
      file = { name, kind: FileKind.Provided, data, length: data.length, position: mode === FileMode.OpenOrCreate ? data.length : 0, dirty: false };
    } else {
      const existing = mode === FileMode.Create ? undefined : this.readStored(name);
      if (!existing && mode === FileMode.OpenOrFail) return -1;
      const data = existing ?? new Uint8Array(0);
      file = { name, kind: FileKind.Stored, data, length: data.length, position: mode === FileMode.OpenOrCreate ? data.length : 0, dirty: !existing };
    }
    const handle = this.nextHandle++;
    this.open.set(handle, file);
    return handle;
  }

  /** Vrai si le descripteur était ouvert. */
  close(handle: number): boolean {
    const file = this.open.get(handle);
    if (!file) return false;
    this.open.delete(handle);
    if (file.kind === FileKind.Stored && file.dirty) this.writeStored(file.name, file.data.slice(0, file.length));
    return true;
  }

  /** Ferme tout (reprise d'une partie) : les fichiers modifiés sont écrits. */
  closeAll(): void {
    for (const handle of [...this.open.keys()]) this.close(handle);
    this.found = [];
  }

  read(handle: number, size: number): Uint8Array {
    const file = this.open.get(handle);
    if (!file) return new Uint8Array(0);
    const bytes = file.data.slice(file.position, Math.min(file.length, file.position + size));
    file.position += bytes.length;
    return bytes;
  }

  /** Octets écrits, ou −1 (descripteur inconnu, fichier en lecture seule). */
  write(handle: number, bytes: Uint8Array): number {
    const file = this.open.get(handle);
    if (!file || file.kind === FileKind.Provided) return -1;
    // Le catalogue se compose des emplacements : ce que le jeu y écrit est ignoré.
    if (file.kind === FileKind.Catalogue) return bytes.length;
    const end = file.position + bytes.length;
    if (end > file.data.length) {
      const grown = new Uint8Array(Math.max(end, file.data.length * 2));
      grown.set(file.data.subarray(0, file.length));
      file.data = grown;
    }
    file.data.set(bytes, file.position);
    file.position = end;
    file.length = Math.max(file.length, end);
    file.dirty = true;
    return bytes.length;
  }

  /** Ligne suivante (sans sa fin de ligne), au plus `maxLength − 1` caractères ; `undefined` en fin de fichier. */
  readLine(handle: number, maxLength: number): string | undefined {
    const file = this.open.get(handle);
    if (!file || file.position >= file.length) return undefined;
    let line = "";
    while (file.position < file.length && line.length < maxLength - 1) {
      const byte = file.data[file.position++];
      if (byte === LF) break;
      if (byte !== CR) line += String.fromCharCode(byte);
    }
    return line;
  }

  /** Nouvelle position, ou −1. */
  seek(handle: number, offset: number, origin: number): number {
    const file = this.open.get(handle);
    if (!file) return -1;
    const base = origin === SeekOrigin.Start ? 0 : origin === SeekOrigin.Current ? file.position : origin === SeekOrigin.End ? file.length : -1;
    if (base < 0) return -1;
    file.position = Math.max(0, Math.min(file.length, base + offset));
    return file.position;
  }

  unlink(rawName: string): boolean {
    const name = normalize(rawName);
    // Le catalogue disparaît de lui-même avec la dernière sauvegarde.
    if (CATALOGUE.test(name)) return true;
    const number = this.saveNumber(name);
    if (number !== undefined) {
      if (!this.hasSave(number)) return false;
      this.store.slots.clear(number + 1);
      return true;
    }
    return this.removeStored(name);
  }

  rename(rawOldName: string, rawNewName: string): boolean {
    const oldName = normalize(rawOldName);
    const newName = normalize(rawNewName);
    const bytes = this.readStored(oldName);
    if (!bytes || newName === "" || CATALOGUE.test(newName) || this.saveNumber(newName) !== undefined || this.provided.has(newName)) return false;
    if (!this.writeStored(newName, bytes)) return false;
    if (newName !== oldName) this.removeStored(oldName);
    return true;
  }

  /** Premier nom qui correspond au masque (`*`, `?`), ou `undefined` ; les suivants viennent par `findNext`. */
  findFirst(mask: string): string | undefined {
    const pattern = globPattern(mask);
    const names = new Set<string>([...this.provided.keys(), ...this.storedNames()]);
    this.found = [...names].filter((name) => pattern.test(name)).sort();
    return this.findNext();
  }

  findNext(): string | undefined {
    return this.found.shift();
  }
}

const instances = new WeakMap<Vm, GameFiles>();

/** Les fichiers vus par cette machine virtuelle (créés à la première demande). */
export function gameFilesOf(vm: Vm): GameFiles {
  let files = instances.get(vm);
  if (!files) {
    const store = saveStoreOf(vm);
    const created = new GameFiles(store);
    instances.set(vm, (files = created));
    store.restored.push(() => created.closeAll());
  }
  return files;
}

// -------------------------------------------------------------------------------------------------------------------------------
// Mémoire des scripts ↔ octets
// -------------------------------------------------------------------------------------------------------------------------------

/** Copie `bytes` à l'adresse `target` : tableau (qui grandit au besoin) ou heap d'un script. Faux si l'adresse ne s'y prête pas. */
function writeBytes(vm: Vm, target: Reg, bytes: Uint8Array): boolean {
  if (regSegment(target) === Segment.Arrays) {
    const array = vm.memory.array(target);
    if (array.type === ArrayType.Byte || array.type === ArrayType.String) {
      array.resize(bytes.length);
      bytes.forEach((byte, index) => array.set(index, byte));
    } else {
      // Tableau de mots : deux octets par case, poids faible d'abord, comme la mémoire d'origine.
      array.resize((bytes.length + 1) >> 1);
      for (let i = 0; i < bytes.length; i += WORD_BYTES) array.set(i >> 1, bytes[i] | ((bytes[i + 1] ?? 0) << 8));
    }
    return true;
  }
  const script = vm.memory.scriptSegment(regSegment(target));
  if (!script || regOffset(target) + bytes.length > script.heap.length) return false;
  script.heap.set(bytes, regOffset(target));
  return true;
}

function readBytes(vm: Vm, source: Reg, size: number): Uint8Array | undefined {
  const bytes = new Uint8Array(size);
  if (regSegment(source) === Segment.Arrays) {
    const array = vm.memory.array(source);
    const wide = array.type !== ArrayType.Byte && array.type !== ArrayType.String;
    for (let i = 0; i < size; i++) {
      const index = wide ? i >> 1 : i;
      const value = index < array.size ? array.get(index) : 0;
      bytes[i] = wide ? (value >> ((i & 1) * 8)) & 0xff : value;
    }
    return bytes;
  }
  const script = vm.memory.scriptSegment(regSegment(source));
  if (!script) return undefined;
  bytes.set(script.heap.subarray(regOffset(source), regOffset(source) + size));
  return bytes;
}

function stringBytes(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0) & 0xff);
}

// -------------------------------------------------------------------------------------------------------------------------------
// Fonction du noyau
// -------------------------------------------------------------------------------------------------------------------------------

function fileIO(vm: Vm, argv: Uint32Array): Reg {
  const files = gameFilesOf(vm);
  const args = argv.subarray(1);
  switch (argv[0]) {
    case FileOp.Open:
      return fromInt(files.openFile(vm.memory.getString(args[0]), args.length > 1 ? args[1] : FileMode.OpenOrCreate));
    case FileOp.Close:
      if (args[0] === SIGNAL_REG) return vm.acc;
      return files.close(args[0]) ? TRUE_REG : NULL_REG;
    case FileOp.ReadRaw: {
      const bytes = files.read(args[0], args[2]);
      if (bytes.length > 0 && !writeBytes(vm, args[1], bytes)) {
        vm.warn("FileIO(ReadRaw) : destination ni tableau ni heap");
        return NULL_REG;
      }
      return fromInt(bytes.length);
    }
    case FileOp.WriteRaw: {
      const bytes = readBytes(vm, args[1], args[2]);
      if (!bytes) {
        vm.warn("FileIO(WriteRaw) : source ni tableau ni heap");
        return SIGNAL_REG;
      }
      return fromInt(files.write(args[0], bytes));
    }
    case FileOp.Unlink:
      return files.unlink(vm.memory.getString(args[0])) ? TRUE_REG : NULL_REG;
    case FileOp.ReadString: {
      const line = files.readLine(args[2], args[1]);
      if (line === undefined) return NULL_REG;
      vm.memory.setString(args[0], line);
      return args[0];
    }
    case FileOp.WriteString:
      return fromInt(files.write(args[0], stringBytes(vm.memory.getString(args[1]))));
    case FileOp.Seek:
      return fromInt(files.seek(args[0], toSint16(args[1]), args[2]));
    case FileOp.FindFirst:
    case FileOp.FindNext: {
      const first = argv[0] === FileOp.FindFirst;
      const target = first ? args[1] : args[0];
      const name = first ? files.findFirst(vm.memory.getString(args[0])) : files.findNext();
      if (name === undefined) return NULL_REG;
      vm.memory.setString(target, name);
      return target;
    }
    case FileOp.Exists:
      return files.exists(vm.memory.getString(args[0])) ? TRUE_REG : NULL_REG;
    case FileOp.Rename:
      return files.rename(vm.memory.getString(args[0]), vm.memory.getString(args[1])) ? NULL_REG : SIGNAL_REG;
    default:
      vm.warn(`FileIO : sous-fonction ${argv[0]} inconnue`);
      return NULL_REG;
  }
}

export function registerFileKernel(kernel: Kernel): void {
  kernel.register("FileIO", fileIO);
}
