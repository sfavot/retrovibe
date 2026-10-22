import { LETTER_SPACING, SPACE_WIDTH, measureText, type PfnFont } from "../data/font";
import type { Hy8, Hy8Frame, Hy8Image } from "../data/hy8";
import { SCREEN_HEIGHT, SCREEN_WIDTH, type Mcg } from "../data/mcg";
import { SPRITE_INDEX_MASK, SPRITE_MIRROR_X, placeSprite } from "./sprites";

export const SCREEN_PIXELS = SCREEN_WIDTH * SCREEN_HEIGHT;

export interface BlitOptions {
  /** Miroir horizontal (le contenu de l'image est retourné, la position reste le coin haut-gauche). */
  mirrorX?: boolean;
  /** Mode opaque (bit 0x4000 de `317b:01cc`) : les pixels transparents (0) sont écrits aussi. */
  opaque?: boolean;
}

export type TextAlign = "left" | "center" | "right";

export interface TextOptions {
  /** Couleur de contour : le texte est d'abord dessiné 8 fois décalé de ±1 px dans cette couleur (`154c:0214`). */
  outline?: number;
  /**
   * `left` (défaut) : `x` = bord gauche ; `center` : `x` = centre (le jeu centre sur 320 px avec `(320 − largeur) / 2`,
   * soit `x = 160`) ; `right` : `x` = bord droit.
   */
  align?: TextAlign;
}

/**
 * Surface de dessin 320×200 en 8 bits indexés, avec les trois tampons de l'original (engine.md §3.1) :
 *
 * - **A** `work` : tampon de travail, ce qui est présenté à l'écran ;
 * - **B** `background` : fond propre de la scène ; `restoreBackground()` (B → A) efface les sprites ;
 * - **C** `saved` : sauvegarde temporaire (pause, aide).
 *
 * Toutes les opérations de dessin écrivent dans A et sont clippées à l'écran. L'index 0 est la clé de transparence
 * des sprites ; la couleur réelle des indices vient de la palette (`engine/palette.ts`).
 */
export class Surface {
  readonly work = new Uint8Array(SCREEN_PIXELS);
  readonly background = new Uint8Array(SCREEN_PIXELS);
  readonly saved = new Uint8Array(SCREEN_PIXELS);

  /** B → A (`13fc:0411`). */
  restoreBackground(): void {
    this.work.set(this.background);
  }

  /** A → B : l'écran courant devient le fond de la scène (flag 0x200 de `13fc:0150`). */
  commitBackground(): void {
    this.background.set(this.work);
  }

  /** A → C. */
  save(): void {
    this.saved.set(this.work);
  }

  /** C → A. */
  restoreSaved(): void {
    this.work.set(this.saved);
  }

  clear(color = 0): void {
    this.work.fill(color);
  }

  /** Copie les pixels d'un MCG dans A ; la palette (`mcg.palette`) se charge à part avec `Palette.load`. */
  drawMcg(mcg: Mcg, options: { asBackground?: boolean } = {}): void {
    this.work.set(mcg.pixels);
    if (options.asBackground) this.commitBackground();
  }

  /** Copie une image pleine 320×200 (une image de vidéo, par exemple) dans A. */
  drawFullScreen(pixels: Uint8Array): void {
    this.work.set(pixels.subarray(0, SCREEN_PIXELS));
  }

  /**
   * Pose une image HY8 dont le coin **haut-gauche** est en (x, y). Les sprites du jeu s'ancrent par leur
   * ligne du bas (voir `drawSprite`). L'index 0 est transparent sauf en mode `opaque`.
   */
  blitImage(image: Hy8Image, x: number, y: number, options: BlitOptions = {}): void {
    const { width, height, pixels } = image;
    const { mirrorX = false, opaque = false } = options;
    const work = this.work;
    const y0 = Math.max(0, -y);
    const y1 = Math.min(height, SCREEN_HEIGHT - y);
    const x0 = Math.max(0, -x);
    const x1 = Math.min(width, SCREEN_WIDTH - x);
    for (let row = y0; row < y1; row++) {
      const src = row * width;
      const dst = (y + row) * SCREEN_WIDTH + x;
      for (let col = x0; col < x1; col++) {
        const value = pixels[src + (mirrorX ? width - 1 - col : col)];
        if (value !== 0 || opaque) work[dst + col] = value;
      }
    }
  }

  /**
   * Dessine le sprite composé `index` de `hy8` (`31fe:0481`) : 12 bits bas = numéro de sprite, 0x8000 = miroir.
   * Ancrage : x = bord gauche, y = ligne du bas (en miroir, le point est le bord droit). `options.mirrorX`
   * s'ajoute au bit 0x8000 de l'indice.
   */
  drawSprite(hy8: Hy8, index: number, x: number, y: number, options: { mirrorX?: boolean; opaque?: boolean } = {}): void {
    const mirror = (index & SPRITE_MIRROR_X) !== 0 !== (options.mirrorX ?? false);
    for (const placed of placeSprite(hy8, index & SPRITE_INDEX_MASK, mirror)) {
      this.blitImage(placed.image, x + placed.left, y + placed.top, { mirrorX: placed.mirror, opaque: options.opaque });
    }
  }

  /** Dessine une frame d'animation (sprite + miroir de la frame). */
  drawFrame(hy8: Hy8, frame: Hy8Frame, x: number, y: number): void {
    this.drawSprite(hy8, frame.sprite | (frame.flags & SPRITE_MIRROR_X), x, y);
  }

  /**
   * Dessine un texte CP437 (octets, arrêt au premier 0) avec une police PFN et renvoie sa largeur en pixels
   * (`measureText`). Le glyphe est un masque 0/1 peint dans l'index `color` ; (x, y) est le coin haut-gauche.
   * Avance : largeur + 1, un glyphe vide ou absent avance de `SPACE_WIDTH + 1` sans rien dessiner.
   */
  drawText(font: PfnFont, text: Uint8Array, x: number, y: number, color: number, options: TextOptions = {}): number {
    const width = measureText(font, text);
    const align = options.align ?? "left";
    // `(320 − largeur) / 2` de l'original = 160 − ceil(largeur / 2) pour un centre en 160.
    const left = align === "center" ? x - Math.ceil(width / 2) : align === "right" ? x - width : x;
    if (options.outline !== undefined) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx !== 0 || dy !== 0) this.drawGlyphs(font, text, left + dx, y + dy, options.outline);
        }
      }
    }
    this.drawGlyphs(font, text, left, y, color);
    return width;
  }

  private drawGlyphs(font: PfnFont, text: Uint8Array, x: number, y: number, color: number): void {
    const work = this.work;
    let pen = x;
    for (const code of text) {
      if (code === 0) break;
      const glyph = font.glyphs.get(code);
      const width = glyph?.width ?? 0;
      if (glyph && width > 0) {
        for (let row = 0; row < font.height; row++) {
          const py = y + row;
          if (py < 0 || py >= SCREEN_HEIGHT) continue;
          for (let col = 0; col < width; col++) {
            const px = pen + col;
            if (px >= 0 && px < SCREEN_WIDTH && glyph.bitmap[row * width + col]) work[py * SCREEN_WIDTH + px] = color;
          }
        }
      }
      pen += (width === 0 ? SPACE_WIDTH : width) + LETTER_SPACING;
    }
  }
}
