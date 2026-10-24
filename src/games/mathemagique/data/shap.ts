/**
 * Ressource `SHAP` : image indexée (palette de l'écran, voir `palette.ts`). Format détaillé dans `docs/mathemagique/shap.md`.
 *
 * Big-endian. Entête de 8 octets : largeur u16, hauteur u16, pas u16 (octets par ligne du bitmap décompressé, aligné sur 4 pour
 * les images brutes), drapeaux u16 :
 *   - bits 0-2 : profondeur (0 = 1 bit/pixel, 2 = 8 bits/pixel) ;
 *   - 0x010 : lignes en RLE (un compteur u16 par ligne, voir `decodeRle`) ;
 *   - 0x100 : données compressées en LZ (anneau de 1024 octets, voir `unpackLz`), précédées de 10 octets :
 *     taille décompressée u32, taille compressée u32, taille d'anneau u16 (toujours 0x400).
 * Les données suivent (octet 18 si 0x100, sinon octet 8). Le LZ s'applique d'abord, puis le RLE.
 */
import { BinaryReader } from "../../../data/reader";

export const FLAG_DEPTH_MASK = 0x07;
export const FLAG_RLE = 0x010;
export const FLAG_LZ = 0x100;

const RING_SIZE = 0x400;
const RING_START = 0x3be;

export interface Shape {
  width: number;
  height: number;
  /** Octets par ligne du bitmap source (avant RLE : incluant le bourrage). */
  pitch: number;
  flags: number;
  /** 8 : un octet = un index de palette ; 1 : un octet = 0 ou 1 (masque, 1 = bit allumé). */
  bitsPerPixel: 1 | 8;
  /** `width * height` octets, ligne par ligne, du haut vers le bas. */
  pixels: Uint8Array;
  /** Octets de la ressource réellement lus (entête compris) ; le reste est du bourrage. */
  consumed: number;
  /** Fin déclarée des données : 18 + taille compressée pour un SHAP en LZ, sinon `consumed`. */
  declaredEnd: number;
}

/** Décompression LZSS de Broderbund : anneau de 1024 octets initialisé à 0, position d'écriture initiale 0x3be, drapeaux LSB d'abord (1 = littéral). */
export function unpackLz(src: Uint8Array, start: number, end: number, outSize: number): { data: Uint8Array; end: number } {
  const out = new Uint8Array(outSize);
  const ring = new Uint8Array(RING_SIZE);
  let ringPos = RING_START;
  let o = 0;
  let i = start;
  let flags = 0;
  while (o < outSize) {
    if ((flags & 0xff00) === 0) {
      if (i >= end) throw new Error("SHAP : données LZ tronquées");
      flags = src[i++]! | 0xff00;
    }
    const literal = flags & 1;
    flags >>= 1;
    if (literal) {
      if (i >= end) throw new Error("SHAP : données LZ tronquées");
      const b = src[i++]!;
      out[o++] = b;
      ring[ringPos] = b;
      ringPos = (ringPos + 1) & (RING_SIZE - 1);
    } else {
      if (i + 2 > end) throw new Error("SHAP : données LZ tronquées");
      const hi = src[i++]!;
      const lo = src[i++]!;
      let from = (hi << 8 | lo) & (RING_SIZE - 1);
      let length = (hi >> 2) + 3;
      while (length-- > 0 && o < outSize) {
        const b = ring[from]!;
        from = (from + 1) & (RING_SIZE - 1);
        out[o++] = b;
        ring[ringPos] = b;
        ringPos = (ringPos + 1) & (RING_SIZE - 1);
      }
    }
  }
  return { data: out, end: i };
}

/** RLE par ligne : u16 BE = nombre d'octets de la ligne ; puis codes : bit 7 = répétition (1 octet de valeur), sinon copie ; longueur = (code & 0x7f) + 1. */
function decodeRle(src: Uint8Array, start: number, width: number, height: number): { pixels: Uint8Array; end: number } {
  const pixels = new Uint8Array(width * height);
  let i = start;
  for (let y = 0; y < height; y++) {
    if (i + 2 > src.length) throw new Error("SHAP : RLE tronqué");
    const rowBytes = (src[i]! << 8) | src[i + 1]!;
    i += 2;
    const rowEnd = i + rowBytes;
    if (rowEnd > src.length) throw new Error("SHAP : RLE tronqué");
    let x = 0;
    while (x < width) {
      if (i >= rowEnd) throw new Error("SHAP : ligne RLE trop courte");
      const code = src[i++]!;
      const run = Math.min((code & 0x7f) + 1, width - x);
      const row = y * width + x;
      if (code & 0x80) {
        pixels.fill(src[i++]!, row, row + run);
      } else {
        pixels.set(src.subarray(i, i + run), row);
        i += (code & 0x7f) + 1;
      }
      x += run;
    }
    if (i > rowEnd) throw new Error("SHAP : ligne RLE trop longue");
    i = rowEnd;
  }
  return { pixels, end: i };
}

function unpackBits(src: Uint8Array, start: number, width: number, height: number, pitch: number): Uint8Array {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const byte = src[start + y * pitch + (x >> 3)] ?? 0;
      pixels[y * width + x] = (byte >> (7 - (x & 7))) & 1;
    }
  }
  return pixels;
}

export function decodeShap(bytes: Uint8Array): Shape {
  const r = new BinaryReader(bytes);
  const width = r.u16be();
  const height = r.u16be();
  const pitch = r.u16be();
  const flags = r.u16be();
  const bitsPerPixel = (flags & FLAG_DEPTH_MASK) === 0 ? 1 : 8;
  if ((flags & FLAG_DEPTH_MASK) !== 0 && (flags & FLAG_DEPTH_MASK) !== 2) throw new Error(`SHAP : profondeur inconnue (drapeaux ${flags.toString(16)})`);

  let data = bytes;
  let start = 8;
  let consumed = 0;
  let declaredEnd = 0;
  if (flags & FLAG_LZ) {
    const unpackedSize = r.u32be();
    const packedSize = r.u32be();
    const ring = r.u16be();
    if (ring !== RING_SIZE) throw new Error(`SHAP : taille d'anneau LZ inattendue (${ring})`);
    const lz = unpackLz(bytes, 18, Math.min(bytes.length, 18 + packedSize), unpackedSize);
    data = lz.data;
    start = 0;
    consumed = lz.end;
    declaredEnd = 18 + packedSize;
  }

  let pixels: Uint8Array;
  let used: number;
  if (flags & FLAG_RLE) {
    if (bitsPerPixel !== 8) throw new Error("SHAP : RLE sur une image 1 bit non géré");
    const rle = decodeRle(data, start, width, height);
    pixels = rle.pixels;
    used = rle.end;
  } else {
    used = start + pitch * height;
    if (used > data.length) throw new Error("SHAP : bitmap tronqué");
    if (bitsPerPixel === 1) {
      pixels = unpackBits(data, start, width, height, pitch);
    } else {
      pixels = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) pixels.set(data.subarray(start + y * pitch, start + y * pitch + width), y * width);
    }
  }
  if (!(flags & FLAG_LZ)) {
    consumed = used;
    declaredEnd = used;
  }
  return { width, height, pitch, flags, bitsPerPixel, pixels, consumed, declaredEnd };
}
