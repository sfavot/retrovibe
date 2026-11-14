/**
 * En-tête `DataFileHeader` des fichiers de `sky.dsk` (sprites, voix, textes…).
 *
 * Référence : ScummVM engines/sky/struc.h (`DataFileHeader`) et `Disk::loadFile` pour la taille décompressée (engines/sky/disk.cpp,
 * GPL v3 ou ultérieure). 22 octets = 11 mots `u16` petit-boutistes.
 */

export const DATA_FILE_HEADER_SIZE = 22;

/** Bit 2 de `flag` : 32 couleurs (sinon 16). */
export const HEADER_FLAG_32_COLORS = 1 << 2;
/** Bit 7 de `flag` : les octets qui suivent l'en-tête sont compressés en RNC. */
export const HEADER_FLAG_COMPRESSED = 1 << 7;

export interface DataFileHeader {
  /** Bit 7 : compressé RNC ; bit 2 : 32 couleurs ; bits 8 à 15 : poids fort de la taille décompressée. */
  readonly flag: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Octets par image (`s_sp_size`). */
  readonly spriteSize: number;
  /** Poids faible de la taille décompressée (`s_tot_size`). */
  readonly totalSize: number;
  readonly numSprites: number;
  /** Signé. */
  readonly offsetX: number;
  /** Signé. */
  readonly offsetY: number;
  readonly compressedSize: number;
}

export function parseDataFileHeader(bytes: Uint8Array, at = 0): DataFileHeader {
  if (at < 0 || at + DATA_FILE_HEADER_SIZE > bytes.length) throw new Error("en-tête de fichier invalide : fichier trop court");
  const view = new DataView(bytes.buffer, bytes.byteOffset + at, DATA_FILE_HEADER_SIZE);
  return {
    flag: view.getUint16(0, true),
    x: view.getUint16(2, true),
    y: view.getUint16(4, true),
    width: view.getUint16(6, true),
    height: view.getUint16(8, true),
    spriteSize: view.getUint16(10, true),
    totalSize: view.getUint16(12, true),
    numSprites: view.getUint16(14, true),
    offsetX: view.getInt16(16, true),
    offsetY: view.getInt16(18, true),
    compressedSize: view.getUint16(20, true),
  };
}

export function isCompressed(header: DataFileHeader): boolean {
  return (header.flag & HEADER_FLAG_COMPRESSED) !== 0;
}

/** `((flag & ~0xFF) << 8) | s_tot_size` (disk.cpp:246) : taille du fichier décompressé, en-tête compris. */
export function decompressedSize(header: DataFileHeader): number {
  return (((header.flag & 0xff00) << 8) | header.totalSize) >>> 0;
}
