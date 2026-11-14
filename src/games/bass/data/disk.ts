/**
 * `sky.dnr` (index) et `sky.dsk` (conteneur) : chargement d'un fichier du jeu par son identifiant.
 *
 * Référence : ScummVM engines/sky/disk.cpp (`Disk::Disk`, `Disk::fileExists`, `Disk::loadFile`, `Disk::getFileInfo`), GPL v3 ou ultérieure.
 * Version visée : CD v0.0372 uniquement (positions alignées par `<< 4` ; le `<< 3` de la v0.0331 et le code iBass sont ignorés).
 *
 * Index : `u32` LE nombre d'entrées, puis des entrées de 8 octets : identifiant `u16`, position `u24` (bit 23 : position réelle =
 * `(v & 0x7FFFFF) << 4`), drapeaux `u24` (bits 0 à 21 : taille stockée ; bit 22 : l'en-tête n'est pas recopié devant la sortie décompressée ;
 * bit 23 : fichier non compressé).
 *
 * Écarts volontaires :
 * - ScummVM rend NULL pour un identifiant inconnu ; ici `load` lève une erreur (tester d'abord avec `has`) ;
 * - ScummVM tolère une lecture trop courte (avertissement) ; ici une entrée qui déborde de `sky.dsk` est refusée ;
 * - un flux RNC dont la signature est présente mais corrompu lève `RncError` (ScummVM rend alors un tampon incohérent) ;
 * - `load` rend toujours une copie : les appelants (grilles, compacts) modifient leurs données.
 */

import { DATA_FILE_HEADER_SIZE, decompressedSize, isCompressed, parseDataFileHeader } from "./header";
import { hasRnc1Signature, rnc1Unpack } from "./rnc";

const ENTRY_SIZE = 8;
const SIZE_MASK = 0x3fffff;
const ALIGNED_POSITION_BIT = 0x800000;
const POSITION_MASK = 0x7fffff;
const NO_HEADER_BIT = 1 << 22;
const UNCOMPRESSED_BIT = 1 << 23;
/** Décalage des positions alignées (v0.0372). */
const ALIGNED_SHIFT = 4;

export interface DiskEntry {
  readonly id: number;
  /** Position dans `sky.dsk`, décalage appliqué. */
  readonly offset: number;
  /** Octets stockés dans `sky.dsk`. */
  readonly storedSize: number;
  /** Bit 22 : l'en-tête n'est pas recopié devant le contenu décompressé. */
  readonly headerDropped: boolean;
  /** Bit 23 : le fichier est stocké tel quel (jamais décompressé, même avec une signature RNC). */
  readonly uncompressed: boolean;
}

/** Copie indépendante (`Buffer.slice` partagerait la mémoire). */
function copy(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

export class SkyDisk {
  /** Entrées dans l'ordre de l'index (ordre des positions, pas des identifiants). */
  readonly entries: readonly DiskEntry[];
  private readonly byId = new Map<number, DiskEntry>();
  private readonly dsk: Uint8Array;

  constructor(dnr: Uint8Array, dsk: Uint8Array) {
    if (dnr.length < 4) throw new Error("sky.dnr invalide : fichier trop court");
    const view = new DataView(dnr.buffer, dnr.byteOffset, dnr.byteLength);
    const count = view.getUint32(0, true);
    if (dnr.length < 4 + count * ENTRY_SIZE) throw new Error(`sky.dnr invalide : ${count} entrées annoncées, ${dnr.length} octets`);
    this.dsk = dsk;
    const entries: DiskEntry[] = [];
    for (let i = 0; i < count; i++) {
      const at = 4 + i * ENTRY_SIZE;
      const position = dnr[at + 2]! | (dnr[at + 3]! << 8) | (dnr[at + 4]! << 16);
      const flags = dnr[at + 5]! | (dnr[at + 6]! << 8) | (dnr[at + 7]! << 16);
      const entry: DiskEntry = {
        id: view.getUint16(at, true),
        offset: position & ALIGNED_POSITION_BIT ? (position & POSITION_MASK) << ALIGNED_SHIFT : position,
        storedSize: flags & SIZE_MASK,
        headerDropped: (flags & NO_HEADER_BIT) !== 0,
        uncompressed: (flags & UNCOMPRESSED_BIT) !== 0,
      };
      if (entry.offset + entry.storedSize > dsk.length) throw new Error(`sky.dsk invalide : le fichier ${entry.id} dépasse la fin du conteneur`);
      entries.push(entry);
      // `getFileInfo` cherche linéairement : la première entrée d'un identifiant l'emporte.
      if (!this.byId.has(entry.id)) this.byId.set(entry.id, entry);
    }
    this.entries = entries;
  }

  get fileCount(): number {
    return this.entries.length;
  }

  /** `Disk::fileExists`. */
  has(id: number): boolean {
    return this.byId.has(id);
  }

  entry(id: number): DiskEntry | undefined {
    return this.byId.get(id);
  }

  /** `Disk::loadFile` : contenu du fichier `id`, décompressé si besoin ; copie indépendante. */
  load(id: number): Uint8Array {
    const entry = this.byId.get(id);
    if (!entry) throw new Error(`fichier ${id} absent de sky.dnr`);
    const stored = this.dsk.subarray(entry.offset, entry.offset + entry.storedSize);

    // Compressé si le bit 23 de l'index est nul et le bit 7 de `flag` posé (un fichier de moins de 22 octets n'a pas d'en-tête : brut).
    if (entry.uncompressed || stored.length < DATA_FILE_HEADER_SIZE) return copy(stored);
    const header = parseDataFileHeader(stored);
    if (!isCompressed(header)) return copy(stored);

    const packed = stored.subarray(DATA_FILE_HEADER_SIZE);
    // « Pas de signature RNC » : le fichier n'était pas compressé malgré son drapeau, rendu tel quel.
    if (!hasRnc1Signature(packed)) return copy(stored);
    const unpacked = rnc1Unpack(packed);
    if (entry.headerDropped) return unpacked;
    const out = new Uint8Array(DATA_FILE_HEADER_SIZE + unpacked.length);
    out.set(stored.subarray(0, DATA_FILE_HEADER_SIZE));
    out.set(unpacked, DATA_FILE_HEADER_SIZE);
    return out;
  }

  /** Taille décompressée annoncée par l'en-tête (`_lastLoadedFileSize` de ScummVM pour un fichier RNC), ou la taille stockée sinon. */
  declaredSize(id: number): number {
    const entry = this.byId.get(id);
    if (!entry) throw new Error(`fichier ${id} absent de sky.dnr`);
    const stored = this.dsk.subarray(entry.offset, entry.offset + entry.storedSize);
    if (entry.uncompressed || stored.length < DATA_FILE_HEADER_SIZE) return entry.storedSize;
    const header = parseDataFileHeader(stored);
    if (!isCompressed(header) || !hasRnc1Signature(stored.subarray(DATA_FILE_HEADER_SIZE))) return entry.storedSize;
    return decompressedSize(header);
  }
}
