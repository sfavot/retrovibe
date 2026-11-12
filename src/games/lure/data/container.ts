/**
 * Conteneur `heywow` : `DISK1.VGA` à `DISK4.VGA` et chaque bloc de langue de `lure.dat` (`LURE-FR.DAT`) ont le même format.
 *
 * Source : `Disk::openFile`, `Disk::indexOf`, `Disk::getEntry`, `Disk::getEntrySize` (engines/lure/disk.cpp, ScummVM, GPL v3+) et `FileEntry`
 * (`res_struct.h`). Disposition : `"heywow"` (6 octets), numéro de disque sur 16 bits **grand-boutiste** (1 à 4 ; 0 pour `lure.dat`), puis
 * 191 entrées de 8 octets petit-boutistes (`id` u16, `unused` u8, `sizeExtension` u8, `size` u16, `offset` u16). La liste s'arrête au premier
 * `id = 0xFFFF`. Position d'une ressource = `offset * 32` ; taille = `size + (sizeExtension ? 0x10000 : 0)`.
 *
 * Écarts volontaires :
 * - ScummVM ouvre le disque d'après l'identifiant (`indexOf`) et lit au fil de l'eau ; ici `LureResources` reçoit les cinq fichiers en mémoire
 *   et applique la même règle de sélection (`diskOfId`) ;
 * - la substitution des écrans de remplacement (`0x008`, `0x120`, `0x311`, `0x410` quand `AREA_FLAG` est non nul) est un état du jeu : le
 *   lecteur reste pur, le moteur passe l'identifiant corrigé (`areaScreenId`) ;
 * - ScummVM ne contrôle pas qu'une ressource tient dans le fichier ; ici une entrée qui déborde est refusée.
 */

export const HEADER_IDENT = "heywow";
export const NUM_ENTRIES_IN_HEADER = 0xbf;
export const HEADER_ENTRY_UNUSED_ID = 0xffff;
const ENTRY_SIZE = 8;
const HEADER_SIZE = HEADER_IDENT.length + 2 + NUM_ENTRIES_IN_HEADER * ENTRY_SIZE;
const ALIGNMENT = 0x20;

/** Identifiants `0x3Fxx` : ressources de `lure.dat` (tables extraites de `LURE.EXE`). */
export const DAT_ID_HIGH_BYTE = 0x3f;

export interface ContainerEntry {
  readonly id: number;
  /** Rang dans l'en-tête. */
  readonly index: number;
  /** Position dans le fichier, en octets (`offset * 32`). */
  readonly offset: number;
  readonly size: number;
  /** Octet `unused` de l'en-tête (`0xFF` dans tous les fichiers du jeu). */
  readonly unused: number;
}

export class HeywowContainer {
  /** Numéro lu dans l'en-tête : 1 à 4 pour un disque, 0 pour un bloc de `lure.dat`. */
  readonly diskNumber: number;
  /** Entrées dans l'ordre de l'en-tête, jusqu'à la première entrée inutilisée. */
  readonly entries: readonly ContainerEntry[];
  /** Taille du fichier. */
  readonly byteLength: number;
  private readonly bytes: Uint8Array;
  private readonly byId = new Map<number, ContainerEntry>();

  constructor(bytes: Uint8Array) {
    if (bytes.length < HEADER_SIZE) throw new Error("conteneur heywow invalide : fichier trop court");
    for (let i = 0; i < HEADER_IDENT.length; i++) {
      if (bytes[i] !== HEADER_IDENT.charCodeAt(i)) throw new Error("conteneur heywow invalide : signature absente");
    }
    this.bytes = bytes;
    this.byteLength = bytes.length;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.diskNumber = view.getUint16(HEADER_IDENT.length, false);

    const entries: ContainerEntry[] = [];
    for (let index = 0; index < NUM_ENTRIES_IN_HEADER; index++) {
      const at = HEADER_IDENT.length + 2 + index * ENTRY_SIZE;
      const id = view.getUint16(at, true);
      if (id === HEADER_ENTRY_UNUSED_ID) break;
      const unused = bytes[at + 2]!;
      const extension = bytes[at + 3]!;
      const size = view.getUint16(at + 4, true) + (extension !== 0 ? 0x10000 : 0);
      const offset = view.getUint16(at + 6, true) * ALIGNMENT;
      if (offset + size > bytes.length) throw new Error(`conteneur heywow invalide : la ressource 0x${id.toString(16)} dépasse la fin du fichier`);
      if (this.byId.has(id)) throw new Error(`conteneur heywow invalide : identifiant 0x${id.toString(16)} en double`);
      const entry: ContainerEntry = { id, index, offset, size, unused };
      entries.push(entry);
      this.byId.set(id, entry);
    }
    this.entries = entries;
  }

  get ids(): number[] {
    return this.entries.map((entry) => entry.id);
  }

  has(id: number): boolean {
    return this.byId.has(id);
  }

  size(id: number): number {
    return this.entry(id).size;
  }

  entry(id: number): ContainerEntry {
    const entry = this.byId.get(id);
    if (!entry) throw new Error(`ressource 0x${id.toString(16)} absente du conteneur`);
    return entry;
  }

  /** Contenu d'une ressource : une vue du fichier, pas une copie. */
  get(id: number): Uint8Array {
    const entry = this.entry(id);
    return this.bytes.subarray(entry.offset, entry.offset + entry.size);
  }
}

/** Fichier qui porte la ressource : 0 pour `lure.dat` (`0x3Fxx`), sinon 1 à 4 (deux bits de poids fort de l'identifiant). */
export function diskOfId(id: number): number {
  return id >> 8 === DAT_ID_HIGH_BYTE ? 0 : ((id >> 14) & 3) + 1;
}

/** Noms des fichiers d'origine, dans `original/lure/`. */
export const DISK_FILE_NAMES = ["DISK1.VGA", "DISK2.VGA", "DISK3.VGA", "DISK4.VGA"] as const;
export const DAT_FILE_NAME = "LURE-FR.DAT";

/** Écrans de remplacement (`Disk::getEntry`) : quatre identifiants, aux deux bits hauts près. */
const AREA_SCREENS = new Set([0x008, 0x120, 0x311, 0x410]);

/** Identifiant à demander quand `AREA_FLAG` vaut `areaFlag` : le bit `0x8000` est inversé pour les quatre écrans de remplacement. */
export function areaScreenId(id: number, areaFlag: number): number {
  return areaFlag !== 0 && AREA_SCREENS.has(id & 0x3fff) ? id ^ 0x8000 : id;
}

export interface LureFiles {
  /** `DISK1.VGA` à `DISK4.VGA`, dans l'ordre. */
  disks: readonly [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
  /** `LURE-FR.DAT` : bloc français de `lure.dat`. */
  dat: Uint8Array;
}

/** Accès à une ressource par identifiant sur les quatre disques et le bloc de `lure.dat`. */
export class LureResources {
  readonly dat: HeywowContainer;
  readonly disks: readonly HeywowContainer[];

  constructor(files: LureFiles) {
    this.dat = new HeywowContainer(files.dat);
    if (this.dat.diskNumber !== 0) throw new Error(`bloc de lure.dat invalide : numéro de disque ${this.dat.diskNumber}`);
    this.disks = files.disks.map((bytes, i) => {
      const disk = new HeywowContainer(bytes);
      if (disk.diskNumber !== i + 1) throw new Error(`DISK${i + 1}.VGA invalide : numéro de disque ${disk.diskNumber}`);
      return disk;
    });
  }

  private containerOf(id: number): HeywowContainer {
    const disk = diskOfId(id);
    return disk === 0 ? this.dat : this.disks[disk - 1]!;
  }

  has(id: number): boolean {
    return this.containerOf(id).has(id);
  }

  size(id: number): number {
    return this.containerOf(id).size(id);
  }

  /** Contenu d'une ressource (vue, pas copie). Lève si l'identifiant est absent. */
  get(id: number): Uint8Array {
    return this.containerOf(id).get(id);
  }

  /** Tous les identifiants : `lure.dat` puis les disques 1 à 4. */
  allIds(): number[] {
    return [this.dat, ...this.disks].flatMap((container) => container.ids);
  }
}
