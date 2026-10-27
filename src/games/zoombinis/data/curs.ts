/**
 * Ressource `CURS` : curseur monochrome 16 × 16 de `ZOOMBINI.MHK` (ids 1 à 5), converti en curseur Windows par `11e8:851e`
 * (`docs/zoombinis/engine.md` §4.4). 68 octets, big-endian :
 *
 * | Octets | Contenu |
 * |---|---|
 * | 0x00 | 16 × u16 plan « image » : 1 = pixel noir (bit 15 = pixel de gauche, une ligne par mot) |
 * | 0x20 | 16 × u16 plan « masque » : 1 = pixel opaque |
 * | 0x40 | u16 point chaud, première valeur |
 * | 0x42 | u16 point chaud, seconde valeur |
 *
 * Rendu : noir si image = 1 et masque = 1, blanc si image = 0 et masque = 1, transparent si masque = 0. L'ordre du point chaud
 * n'est pas confirmé (le code lit +0x42 avant +0x40) : on suppose `x = +0x40`, `y = +0x42` (point ouvert 12 d'`engine.md`).
 */
import { BinaryReader } from "../../../data/reader";

export const CURSOR_SIZE = 16;
const CURSOR_BYTES = 0x44;

export interface Cursor {
  width: 16;
  height: 16;
  /** 256 valeurs 0 ou 1, ligne par ligne : 1 = noir (si opaque). */
  image: Uint8Array;
  /** 256 valeurs 0 ou 1 : 1 = opaque. */
  mask: Uint8Array;
  hotspot: { x: number; y: number };
}

function readPlane(r: BinaryReader): Uint8Array {
  const plane = new Uint8Array(CURSOR_SIZE * CURSOR_SIZE);
  for (let y = 0; y < CURSOR_SIZE; y++) {
    const row = r.u16be();
    for (let x = 0; x < CURSOR_SIZE; x++) plane[y * CURSOR_SIZE + x] = (row >> (15 - x)) & 1;
  }
  return plane;
}

export function parseCurs(bytes: Uint8Array): Cursor {
  if (bytes.length < CURSOR_BYTES) throw new Error("CURS : ressource trop courte");
  const r = new BinaryReader(bytes);
  const image = readPlane(r);
  const mask = readPlane(r);
  const x = r.u16be();
  const y = r.u16be();
  return { width: CURSOR_SIZE, height: CURSOR_SIZE, image, mask, hotspot: { x, y } };
}

/** Pixels RGBA (noir, blanc ou transparent) du curseur. */
export function cursorToRgba(cursor: Cursor): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(CURSOR_SIZE * CURSOR_SIZE * 4);
  for (let i = 0; i < cursor.mask.length; i++) {
    if (!cursor.mask[i]) continue;
    const value = cursor.image[i] ? 0 : 255;
    rgba.set([value, value, value, 255], i * 4);
  }
  return rgba;
}
