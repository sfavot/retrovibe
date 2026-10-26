/**
 * Texte et aplats de l'interface dans l'image indexée 320×400 (docs/swiv3d/screens.md §4.1 et §6).
 *
 * Les pixels d'un glyphe ne sont pas des couleurs : ce sont des numéros de ligne de la table de mélange (bloc 800 de `GLOBAL.BD`) ;
 * la couleur écrite est `table[ligne << 8 | pixel déjà présent]`. Les aplats des menus (`gm_fill_blend`, `004360b0`) suivent la même règle.
 */
import { encodeCp437 } from "../../../data/cp437";
import { TRANSPARENT, type Font } from "../data/font";

export const UI_WIDTH = 320;
export const UI_HEIGHT = 400;

/** `b` : texte blanc ombré (`gm_blit_rle_glyph_a`) ; `g` : teinte divisée par deux, donc gris (`FUN_00415126`). */
export type TextStyle = "b" | "g";
/** `l` : `x` est le bord gauche ; `c` : centre ; `r` : bord droit. */
export type TextAlign = "l" | "c" | "r";

/** Largeur au-delà de laquelle une chaîne de briefing est coupée (`0x118`, §6). */
export const BRIEFING_TEXT_MAX_WIDTH = 280;

/** Ligne de la table de mélange d'un pixel de glyphe en style `g` : la teinte (4 bits bas) est divisée par deux. */
export const dimRow = (row: number): number => (row & 0xf0) | ((row & 0x0f) >> 1);

export class TextRenderer {
  /**
   * `blend` : table de mélange 256×256 (`table[ligne << 8 | pixel]`) calée sur la palette affichée : `GLOBAL.BD` 800 pour les vidéos et
   * les écrans fixes, la table 108 du niveau chargé pour les menus devant un niveau (le décor `DEMO.SLV`). Modifiable : l'application
   * la change avec le fond. `page` : page de glyphes de la langue (0 pour le français et l'anglais).
   */
  constructor(
    private readonly font: Font,
    public blend: Uint8Array,
    private readonly page = 0,
  ) {}

  /** Largeur en pixels (somme des avances), comme `gm_text_width`. */
  width(text: string): number {
    return this.font.measure(encodeCp437(text), this.page);
  }

  /** Coupe `text` pour qu'il tienne dans `maxWidth` pixels (la chaîne d'origine est tronquée par un NUL). */
  truncate(text: string, maxWidth: number): string {
    let out = "";
    for (const ch of text) {
      if (this.width(out + ch) > maxWidth) break;
      out += ch;
    }
    return out;
  }

  /** Dessine `text` au point `(x, y)` : `y` est le point de dessin des glyphes, pas leur sommet. */
  draw(fb: Uint8Array, text: string, x: number, y: number, align: TextAlign = "l", style: TextStyle = "b"): void {
    const bytes = encodeCp437(text);
    const total = this.font.measure(bytes, this.page);
    let pen = align === "c" ? x - Math.floor(total / 2) : align === "r" ? x - total : x;
    for (const code of bytes) {
      const glyph = this.font.glyphs[this.font.glyphIndex(code, this.page)]!;
      for (let gy = 0; gy < glyph.height; gy++) {
        const py = y + glyph.y + gy;
        if (py < 0 || py >= UI_HEIGHT) continue;
        for (let gx = 0; gx < glyph.width; gx++) {
          const px = pen + glyph.x + gx;
          if (px < 0 || px >= UI_WIDTH) continue;
          const row = glyph.rows[gy * glyph.width + gx]!;
          if (row === TRANSPARENT) continue;
          const at = py * UI_WIDTH + px;
          fb[at] = this.blend[((style === "g" ? dimRow(row) : row) << 8) | fb[at]!]!;
        }
      }
      pen += glyph.advance;
    }
  }

  /** `gm_fill_blend` : applique la ligne `row` de la table de mélange au rectangle `[x0, x1[ × [y0, y1[`. */
  fill(fb: Uint8Array, x0: number, y0: number, x1: number, y1: number, row: number): void {
    const left = Math.max(0, x0);
    const right = Math.min(UI_WIDTH, x1);
    for (let y = Math.max(0, y0); y < Math.min(UI_HEIGHT, y1); y++) {
      for (let x = left; x < right; x++) {
        const at = y * UI_WIDTH + x;
        fb[at] = this.blend[(row << 8) | fb[at]!]!;
      }
    }
  }
}
