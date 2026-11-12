/**
 * Texte dans une surface : `Surface::writeChar`, `writeString`, `writeSubstring`, `textWidth` et `wordWrap` (engines/lure/surface.cpp,
 * ScummVM, GPL v3+), réécrits sur `LureFont`.
 *
 * Les chaînes sont en codes du jeu (un code par caractère, comme `composeText` les rend). Le mode proportionnel (`varLength`) avance de la
 * largeur du dessin + 2 ; le mode fixe de 8.
 *
 * Écarts volontaires : un code sans glyphe (ScummVM lève une erreur) n'est pas dessiné et compte comme une espace ; `wordWrap` rend les
 * lignes au lieu de couper le tampon en place, avec la même découpe (y compris le cas d'un premier mot plus large que la ligne, où
 * ScummVM écrit avant le tampon : ici rien n'est coupé).
 */

import { FONT_HEIGHT, FONT_WIDTH, type LureFont } from "../data/font";
import type { Surface } from "./surface";

/** Couleurs du texte des boîtes en VGA (`VGA_DIALOG_TEXT_COLOR`, `VGA_DIALOG_WHITE_COLOR`). */
export const DIALOG_TEXT_COLOR = 0xe2;
export const DIALOG_WHITE_COLOR = 0xe3;

const SPACE = 32;

/** Code dessiné pour `code` : celui-ci s'il a un glyphe, sinon l'espace. */
function known(font: LureFont, code: number): number {
  return font.has(code) ? code : SPACE;
}

/** `Surface::writeChar` : dessine le glyphe et rend la largeur du dessin (colonne la plus à droite allumée + 1). */
export function drawChar(font: LureFont, s: Surface, x: number, y: number, code: number, transparent: boolean, color: number): number {
  const glyph = font.glyph(code);
  if (!glyph) return 0;
  let charWidth = 0;
  for (let y1 = 0; y1 < FONT_HEIGHT; y1++) {
    let v = glyph[y1]!;
    for (let x1 = 0; x1 < FONT_WIDTH; x1++) {
      const px = x + x1;
      const py = y + y1;
      const inside = px >= 0 && py >= 0 && px < s.width && py < s.height;
      if (v & 0x80) {
        if (inside) s.data[py * s.width + px] = color;
        if (x1 + 1 > charWidth) charWidth = x1 + 1;
      } else if (!transparent && inside) {
        s.data[py * s.width + px] = 0;
      }
      v = (v << 1) & 0xff;
    }
  }
  return charWidth;
}

/** `Surface::writeSubstring` : au plus `len` caractères de `line` ; s'arrête avant le bord droit de la surface. */
export function drawSubstring(
  font: LureFont,
  s: Surface,
  x: number,
  y: number,
  line: string,
  len: number,
  transparent: boolean,
  color = DIALOG_TEXT_COLOR,
  varLength = true,
): void {
  for (let index = 0; index < len && index < line.length; index++) {
    const code = known(font, line.charCodeAt(index));
    const charSize = varLength ? font.advance(code, true) : FONT_WIDTH;
    if (x + charSize >= s.width) break;
    drawChar(font, s, x, y, code, transparent, color);
    x += charSize;
  }
}

/** `Surface::writeString`. */
export function drawString(
  font: LureFont,
  s: Surface,
  x: number,
  y: number,
  line: string,
  transparent: boolean,
  color = DIALOG_TEXT_COLOR,
  varLength = true,
): void {
  drawSubstring(font, s, x, y, line, line.length, transparent, color, varLength);
}

/** `Surface::textWidth(s, numChars)` : somme des avances proportionnelles. */
export function textWidth(font: LureFont, text: string, numChars = text.length): number {
  let result = 0;
  for (let i = 0; i < numChars && i < text.length; i++) result += font.advance(known(font, text.charCodeAt(i)), true);
  return result;
}

/** `Surface::wordWrap(text, width, lines, numLines)` : lignes de `text` coupées aux espaces et aux retours à la ligne. */
export function wordWrap(font: LureFont, text: string, width: number): string[] {
  const buf: number[] = [...text].map((c) => c.charCodeAt(0));
  buf.push(0);
  const indexOf = (code: number, from: number): number => {
    for (let i = from; i < buf.length; i++) {
      if (buf[i] === code) return i;
      if (buf[i] === 0 && code !== 0) return -1;
    }
    return -1;
  };
  let numLines = 1;
  let lineWidth = 0;
  let s = 0;
  while (buf[s] !== 0) {
    let wordStart = s;
    while (buf[wordStart] === SPACE) wordStart++;
    let wordEnd = indexOf(SPACE, wordStart);
    const wordEnd2 = indexOf(10, wordStart);
    let newLine: boolean;
    if (wordEnd < 0 || (wordEnd2 >= 0 && wordEnd2 < wordEnd)) {
      wordEnd = wordEnd2;
      newLine = wordEnd2 >= 0;
    } else {
      newLine = false;
    }
    if (wordEnd >= 0) {
      if (buf[wordEnd] !== 0) wordEnd--;
    } else {
      wordEnd = buf.indexOf(0, wordStart) - 1;
    }
    const wordBytes = wordEnd - s + 1;
    let wordSize = 0;
    if (wordBytes !== 0) for (let i = s; i < s + wordBytes; i++) wordSize += font.advance(known(font, buf[i]!), true);
    if (lineWidth + wordSize > width) {
      if (wordStart - 1 >= 0) buf[wordStart - 1] = 0;
      numLines++;
      lineWidth = 0;
      wordEnd = wordStart - 1;
    } else if (newLine) {
      numLines++;
      buf[++wordEnd] = 0;
      lineWidth = 0;
    } else {
      lineWidth += wordSize;
    }
    s = wordEnd + 1;
  }
  const lines: string[] = [];
  let start = 0;
  for (let n = 0; n < numLines; n++) {
    let end = start;
    while (end < buf.length && buf[end] !== 0) end++;
    lines.push(String.fromCharCode(...buf.slice(start, end)));
    start = end + 1;
  }
  return lines;
}
