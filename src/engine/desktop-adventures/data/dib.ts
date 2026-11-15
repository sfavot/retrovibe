import { BinaryReader } from "../../../data/reader";
import type { Cursor } from "./resources";

/** Décodage des images DIB des ressources Windows (curseurs, icônes, bitmaps), communes aux exécutables NE (Indy) et PE (Yoda). */

const DIB_HEADER_SIZE = 40;

/**
 * Ressource CURSOR : un hotspot (2 × u16) suivi d'un DIB 1 bpp dont la hauteur couvre deux masques :
 * le XOR (couleur), puis le AND (transparence) — lignes de bas en haut, rangées de 4 octets.
 */
export function decodeCursor(data: Uint8Array, id: number): Cursor | null {
  const r = new BinaryReader(data);
  const hotspotX = r.u16();
  const hotspotY = r.u16();
  if (r.u32() !== DIB_HEADER_SIZE) return null;
  const width = r.i32();
  const height = r.i32() / 2;
  r.offset += 2; // plans
  if (r.u16() !== 1) return null; // seuls les curseurs 1 bpp sont gérés
  r.offset = 4 + DIB_HEADER_SIZE;
  const colors = [r.u32(), r.u32()]; // BGRx
  const stride = Math.ceil(width / 32) * 4;
  const masks = data.subarray(r.offset);
  if (masks.length < stride * height * 2) return null;

  const rgba = new Uint8ClampedArray(width * height * 4);
  const bit = (row: number, x: number) => (masks[row * stride + (x >> 3)] >> (7 - (x & 7))) & 1;
  for (let y = 0; y < height; y++) {
    const stored = height - 1 - y; // le DIB est stocké de bas en haut
    for (let x = 0; x < width; x++) {
      const and = bit(height + stored, x);
      const xor = bit(stored, x);
      // AND=1, XOR=0 : transparent. AND=1, XOR=1 : inversion de l'écran, rendue ici en transparent aussi.
      if (and) continue;
      const color = colors[xor];
      const o = (y * width + x) * 4;
      rgba[o] = (color >> 16) & 0xff;
      rgba[o + 1] = (color >> 8) & 0xff;
      rgba[o + 2] = color & 0xff;
      rgba[o + 3] = 0xff;
    }
  }
  return { id, width, height, hotspotX, hotspotY, rgba };
}

/** DIB 1, 4 ou 8 bpp avec sa palette ; `masked` : la hauteur de l'en-tête couvre aussi le masque AND 1 bpp (icônes), qui rend les pixels transparents. */
export function decodeDib(data: Uint8Array, masked: boolean): { width: number; height: number; rgba: Uint8ClampedArray } | null {
  const r = new BinaryReader(data);
  if (r.u32() !== DIB_HEADER_SIZE) return null;
  const width = r.i32();
  const height = masked ? r.i32() / 2 : r.i32();
  r.offset += 2; // plans
  const bpp = r.u16();
  if (bpp !== 1 && bpp !== 4 && bpp !== 8) return null;
  r.offset = 32;
  const used = r.u32();
  const count = used || 1 << bpp;
  r.offset = DIB_HEADER_SIZE;
  const colors = Array.from({ length: count }, () => r.u32()); // BGRx
  const stride = Math.ceil((width * bpp) / 32) * 4;
  const maskStride = Math.ceil(width / 32) * 4;
  const pixels = data.subarray(r.offset);
  const mask = pixels.subarray(stride * height);
  if (pixels.length < stride * height || (masked && mask.length < maskStride * height)) return null;

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const stored = height - 1 - y;
    for (let x = 0; x < width; x++) {
      if (masked && (mask[stored * maskStride + (x >> 3)] >> (7 - (x & 7))) & 1) continue;
      const at = stored * stride;
      const index =
        bpp === 8 ? pixels[at + x] : bpp === 4 ? (pixels[at + (x >> 1)] >> (x & 1 ? 0 : 4)) & 15 : (pixels[at + (x >> 3)] >> (7 - (x & 7))) & 1;
      const color = colors[index] ?? 0;
      const o = (y * width + x) * 4;
      rgba[o] = (color >> 16) & 0xff;
      rgba[o + 1] = (color >> 8) & 0xff;
      rgba[o + 2] = color & 0xff;
      rgba[o + 3] = 0xff;
    }
  }
  return { width, height, rgba };
}
