import { unpackLzss } from "./lzss";

export type SpriteFormat = "raw8" | "lz8" | "rle4";

export interface Sprite {
  format: SpriteFormat;
  width: number;
  height: number;
  /** width * height indices de palette. */
  pixels: Uint8Array;
}

/**
 * Décode un sprite : `01 02 02` = 8 bpp brut, `01 02 01` = 8 bpp LZSS,
 * sinon RLE 4 bpp (Video::drawPacked).
 */
export function decodeSprite(data: Uint8Array, width: number, height: number): Sprite {
  const count = width * height;
  if (data[0] === 1 && data[1] === 2 && data[2] === 2) {
    const pixels = new Uint8Array(count);
    pixels.set(data.subarray(3, 3 + count));
    return { format: "raw8", width, height, pixels };
  }
  if (data[0] === 1 && data[1] === 2 && data[2] === 1) {
    return { format: "lz8", width, height, pixels: unpackLzss(data, 7, count) };
  }

  const pixels = new Uint8Array(count);
  let p = 0;
  let o = 0;
  while (o < count && p < data.length) {
    let v = data[p++];
    let repeat = v & 7;
    v &= 0xf8;
    if (!(v & 8)) repeat = (repeat << 8) | data[p++];
    repeat++;
    pixels.fill(v >> 4, o, Math.min(o + repeat, count));
    o += repeat;
  }
  return { format: "rle4", width, height, pixels };
}
