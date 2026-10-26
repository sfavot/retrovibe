/**
 * Tracés dans l'image indexée 320×400 : sprites RLE et images « numéros de ligne » à travers une table de mélange
 * (`dst' = table[ligne << 8 | dst]`), comme `gm_blit_rle_glyph` (`00414c7e`) et sa variante demi-teinte (`004151c3`).
 * Tout est découpé à l'écran : aucune écriture hors de l'image, quelles que soient les positions.
 */
import { TRANSPARENT, type RleSprite } from "../../data/font";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../view";

/** Trace `sprite` avec son point de dessin en (x, y). `half` : teinte divisée par 2 (icônes d'armes non sélectionnées). */
export function blitSprite(fb: Uint8Array, table: Uint8Array, sprite: RleSprite, x: number, y: number, half = false): void {
  const x0 = Math.trunc(x) + sprite.x;
  const y0 = Math.trunc(y) + sprite.y;
  for (let row = 0; row < sprite.height; row++) {
    const py = y0 + row;
    if (py < 0 || py >= SCREEN_HEIGHT) continue;
    for (let col = 0; col < sprite.width; col++) {
      const px = x0 + col;
      if (px < 0 || px >= SCREEN_WIDTH) continue;
      let line = sprite.rows[row * sprite.width + col]!;
      if (line === TRANSPARENT) continue;
      if (half) line = (line & 0xf0) + ((line & 0x0f) >> 1);
      const at = py * SCREEN_WIDTH + px;
      fb[at] = table[(line << 8) | fb[at]!]!;
    }
  }
}

/** Trace une image `width × height` de numéros de ligne, coin haut-gauche en (x, y) ; `columns` limite le nombre de colonnes lues. */
export function blitRows(
  fb: Uint8Array,
  table: Uint8Array,
  rows: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  columns = width,
): void {
  for (let row = 0; row < height; row++) {
    const py = y + row;
    if (py < 0 || py >= SCREEN_HEIGHT) continue;
    for (let col = 0; col < columns; col++) {
      const px = x + col;
      if (px < 0 || px >= SCREEN_WIDTH) continue;
      const at = py * SCREEN_WIDTH + px;
      fb[at] = table[(rows[row * width + col]! << 8) | fb[at]!]!;
    }
  }
}

/** Écrit un indice de palette brut (points du radar), découpé à l'écran. */
export function putPixel(fb: Uint8Array, x: number, y: number, value: number): void {
  if (x < 0 || x >= SCREEN_WIDTH || y < 0 || y >= SCREEN_HEIGHT) return;
  fb[y * SCREEN_WIDTH + x] = value;
}
