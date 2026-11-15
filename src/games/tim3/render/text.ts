/**
 * Texte dessiné avec les polices du jeu (FNT 1 bit ou PFT 8 bits, `data/font.ts`) : un glyphe est une image dont les pixels
 * non nuls sont de l'encre, teintée ici d'un seul index de palette. Les textes sont en Windows-1252 : on convertit le Unicode
 * des chaînes (les accents français passent par Latin-1, quelques signes par la plage 0x80 … 0x9F).
 */
import { type Font, glyphFor } from "../data/font";
import type { Surface } from "./surface";

const CP1252_HIGH: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

/** Code Windows-1252 d'un caractère (`?` si absent). */
export function cp1252(ch: string): number {
  const c = ch.codePointAt(0) ?? 0x3f;
  if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) return c;
  return CP1252_HIGH[c] ?? 0x3f;
}

/** Largeur d'avance d'un caractère (espace de la largeur de « n » si le glyphe manque). */
function advance(font: Font, ch: string): number {
  const g = glyphFor(font, cp1252(ch));
  if (g) return g.width;
  const n = glyphFor(font, 0x6e);
  return n ? n.width : Math.max(1, font.height >> 1);
}

export function measureText(font: Font, text: string): number {
  let w = 0;
  for (const ch of text) w += advance(font, ch);
  return w;
}

/** Texte sur une ligne, coin haut gauche en (x, y) ; renvoie la largeur dessinée. */
export function drawText(surface: Surface, font: Font, text: string, x: number, y: number, color: number): number {
  let cx = x;
  for (const ch of text) {
    const g = glyphFor(font, cp1252(ch));
    if (g) {
      for (let gy = 0; gy < g.height; gy++) for (let gx = 0; gx < g.width; gx++) if (g.pixels[gy * g.width + gx]) surface.plot(cx + gx, y + gy, color);
      cx += g.width;
    } else cx += advance(font, ch);
  }
  return cx - x;
}

/** Découpe un texte en lignes d'au plus `width` pixels (aux espaces ; `\n` force un saut de ligne). */
export function wrapText(font: Font, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measureText(font, candidate) > width) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

/** Paragraphe dans un rectangle ; renvoie le nombre de lignes dessinées (les lignes en trop sont coupées). */
export function drawParagraph(surface: Surface, font: Font, text: string, x: number, y: number, width: number, height: number, color: number): number {
  const lines = wrapText(font, text, width);
  const step = font.height + 1;
  let n = 0;
  for (const line of lines) {
    if ((n + 1) * step > height + 1) break;
    drawText(surface, font, line, x, y + n * step, color);
    n++;
  }
  return n;
}
