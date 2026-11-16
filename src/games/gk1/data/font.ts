/**
 * Polices SCI (`docs/gk1/formats.md` § 7).
 *
 * Référence : `engines/sci/graphics/scifont.cpp` de ScummVM (`GfxFontFromResource`), GPL v3 ou ultérieure, lu puis réécrit.
 *
 * `u16 0 | u16 nombre de glyphes | u16 hauteur de ligne | u16 offset[n]` ; glyphe : `u8 largeur | u8 hauteur`, puis `hauteur`
 * lignes de `⌈largeur / 8⌉` octets, un bit par pixel, poids fort à gauche. Le code d'un caractère (CP850) est l'indice du glyphe.
 *
 * Écart volontaire : les glyphes sont dépliés en un octet par pixel dès la lecture (ScummVM lit les bits au dessin).
 */
import { BinaryReader } from "../../../data/reader";

const HEADER_SIZE = 6;

export interface FontGlyph {
  readonly width: number;
  readonly height: number;
  /** `width × height` valeurs : 1 = encre, 0 = fond. */
  readonly pixels: Uint8Array;
}

export interface Font {
  /** Hauteur de ligne (pas vertical du texte). */
  readonly lineHeight: number;
  /** Glyphes indexés par code de caractère. */
  readonly glyphs: readonly FontGlyph[];
  /** Fin du dernier octet lu (contrôle des restes). */
  readonly byteLength: number;
}

export function readFont(data: Uint8Array): Font {
  if (data.length < HEADER_SIZE) throw new Error("GK1 : police tronquée");
  const r = new BinaryReader(data);
  r.u16();
  const count = r.u16();
  const lineHeight = r.u16();
  if (HEADER_SIZE + 2 * count > data.length) throw new Error("GK1 : table des glyphes hors de la police");
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) offsets.push(r.u16());
  let byteLength = r.offset;
  const glyphs = offsets.map((offset): FontGlyph => {
    if (offset + 2 > data.length) throw new Error("GK1 : glyphe hors de la police");
    const width = data[offset];
    const height = data[offset + 1];
    const rowBytes = (width + 7) >> 3;
    const end = offset + 2 + rowBytes * height;
    if (end > data.length) throw new Error("GK1 : glyphe tronqué");
    byteLength = Math.max(byteLength, end);
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const row = offset + 2 + y * rowBytes;
      for (let x = 0; x < width; x++) pixels[y * width + x] = (data[row + (x >> 3)] >> (7 - (x & 7))) & 1;
    }
    return { width, height, pixels };
  });
  return { lineHeight, glyphs, byteLength };
}

/** Glyphe d'un code de caractère, ou `undefined` s'il est hors de la police. */
export function glyphFor(font: Font, code: number): FontGlyph | undefined {
  return font.glyphs[code];
}
