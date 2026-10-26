/** Texte 2D du HUD : `gm_draw_text` (`004229c8`), police 507/508, alignement 0 centré, 1 gauche, 2 droite, largeur max 0x118. */
import type { Font } from "../../data/font";
import { blitSprite } from "./blit";

export type Align = "center" | "left" | "right";

/** Largeur maximale d'une ligne : le jeu coupe la chaîne dès que 0x118 pixels sont atteints. */
export const MAX_TEXT_WIDTH = 0x118;

/** Octets d'une chaîne ASCII. */
export const ascii = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);

/** Coupe comme le jeu : le caractère qui atteint 0x118 pixels est gardé, les suivants non. */
export function clipText(font: Font, text: Uint8Array, page: number): Uint8Array {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    width += font.glyphs[font.glyphIndex(text[i]!, page)]!.advance;
    if (width >= MAX_TEXT_WIDTH) return text.subarray(0, i + 1);
  }
  return text;
}

/** Dessine `text` ; `x` est le bord choisi par `align`, `y` le haut de la ligne. Retourne la largeur tracée. */
export function drawText(
  fb: Uint8Array,
  table: Uint8Array,
  font: Font,
  page: number,
  text: Uint8Array,
  align: Align,
  x: number,
  y: number,
): number {
  const clipped = clipText(font, text, page);
  const width = font.measure(clipped, page);
  let pen = align === "center" ? x - (width >> 1) : align === "right" ? x - width : x;
  for (const code of clipped) {
    const glyph = font.glyphs[font.glyphIndex(code, page)]!;
    blitSprite(fb, table, glyph, pen, y);
    pen += glyph.advance;
  }
  return width;
}
