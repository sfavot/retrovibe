/**
 * Texte 8 x 8 de *Flight of the Amazon Queen* : largeurs de glyphes, largeur d'un texte, tracé d'un caractère et d'un texte (avec
 * contour). Réécriture de `Display::initFont` (calcul de `_charWidth`), `textWidth`, `drawChar` et `drawText`
 * (engines/queen/display.cpp, ScummVM, GPL v3 ou ultérieure) ; les glyphes sont dans `font-data.ts`.
 *
 * Écarts :
 * - les textes du jeu sont des chaînes JavaScript (les lecteurs de la vague D ont décodé le Latin-1 / Windows-1252 de
 *   `QUEEN2.JAS` et le CP850 ou Latin-1 des `.DOG` et `.CUT`) ; `glyphIndex` les ramène à l'index du glyphe, la **position
 *   Latin-1** pour tout ce que la police dessine, qui contient toutes les lettres du français (la police a aussi les positions
 *   du CP850, mêmes dessins) ;
 * - les caractères de Windows-1252 que la police n'a pas (`œ`, `Œ`, apostrophe et guillemets typographiques, tirets, points de
 *   suspension) sont remplacés par leur forme ASCII (`oe`, `OE`, `'`, `"`, `-`, `...`) ; ScummVM ne les rencontre jamais (la
 *   police recevait les octets d'origine) ; un autre caractère donne `?` ;
 * - ScummVM écrit sans contrôle hors de l'écran (`drawChar` ne rogne pas) ; ici le tracé est rogné au plan.
 */

import { FONT_REGULAR } from "./font-data";

/** Largeur de l'écran (pitch du plan de tracé). */
const PITCH = 320;
/** Largeur de l'espace, imposée après le calcul (`_charWidth[0x20] = 4`). */
const SPACE = 0x20;

/** `_charWidth` : colonne de pixel la plus à droite du glyphe + 2 ; l'espace vaut 4 ; l'accent circonflexe (0x5E) perd 1. */
export const CHAR_WIDTH: Uint8Array = (() => {
  const widths = new Uint8Array(256);
  for (let glyph = 0; glyph < 256; glyph++) {
    let width = 0;
    for (let y = 0; y < 8; y++) {
      const row = FONT_REGULAR[glyph * 8 + y];
      for (let x = 0; x < 8; x++) if (row & (0x80 >> x) && x > width) width = x;
    }
    widths[glyph] = width + 2;
  }
  widths[SPACE] = 4;
  widths[0x5e]--;
  return widths;
})();

/** Caractères de Windows-1252 sans glyphe, et leur remplacement. */
const SUBSTITUTES: Record<string, string> = {
  "œ": "oe",
  "Œ": "OE",
  "’": "'",
  "‘": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "…": "...",
  "€": "E",
};

/** Index du glyphe d'un caractère (0 à 255) : son code Latin-1 s'il tient dans un octet, `?` sinon. */
export function glyphIndex(char: string): number {
  const code = char.charCodeAt(0);
  return code < 256 ? code : 0x3f;
}

/** Texte prêt à être tracé : remplacements ASCII des caractères que la police n'a pas. */
export function toGlyphText(text: string): string {
  let out = "";
  for (const char of text) out += SUBSTITUTES[char] ?? char;
  return out;
}

/** `textWidth` : somme des largeurs de glyphes. */
export function textWidth(text: string): number {
  let width = 0;
  for (const char of toGlyphText(text)) width += CHAR_WIDTH[glyphIndex(char)];
  return width;
}

/** `drawChar` : les pixels allumés du glyphe, dans la couleur `color`, au coin haut gauche `(x, y)` du plan de 320 pixels de large. */
export function drawChar(screen: Uint8Array, x: number, y: number, color: number, glyph: number): void {
  const height = screen.length / PITCH;
  for (let j = 0; j < 8; j++) {
    const row = FONT_REGULAR[glyph * 8 + j];
    const py = y + j;
    if (row === 0 || py < 0 || py >= height) continue;
    for (let i = 0; i < 8; i++) {
      const px = x + i;
      if (row & (0x80 >> i) && px >= 0 && px < PITCH) screen[py * PITCH + px] = color;
    }
  }
}

/** Décalages des 8 passes du contour (`dx`, `dy` de `drawText`). */
const OUTLINE_DX = [-1, 0, 1, 1, 1, 0, -1, -1];
const OUTLINE_DY = [-1, -1, -1, 0, 1, 1, 1, 0];

/**
 * `drawText` : trace `text` à `(x, y)` ; avec `outline`, chaque glyphe est d'abord tracé huit fois décalé d'un pixel dans la
 * couleur de contour `outlineColor` (`INK_OUTLINED_TEXT`). Le tracé s'arrête quand x atteint la largeur de l'écran.
 */
export function drawText(screen: Uint8Array, x: number, y: number, color: number, text: string, outline: boolean, outlineColor: number): void {
  for (const char of toGlyphText(text)) {
    if (x >= PITCH) break;
    const glyph = glyphIndex(char);
    if (outline) for (let i = 0; i < 8; i++) drawChar(screen, x + OUTLINE_DX[i], y + OUTLINE_DY[i], outlineColor, glyph);
    drawChar(screen, x, y, color, glyph);
    x += CHAR_WIDTH[glyph];
  }
}
