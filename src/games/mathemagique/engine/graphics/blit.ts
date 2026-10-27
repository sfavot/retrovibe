/**
 * Dessin des formes `SHAP` décodées (`src/data/mohawk/shap.ts`) dans une `Surface` (`docs/mathemagique/shap.md`, « Dessin, modes et transparence »).
 *
 * - **mode 0** : copie brute (`10d8:4438`, mode 0) ;
 * - **mode 8** : copie en sautant les pixels d'index 0, transparents (mode 8 de la même table ; le mode utilisé par les sprites) ;
 * - **masque 1 bit** (`10d8:494d`) : couleur unie `color` là où le bit vaut 1.
 *   Modes 1 à 7 (AND, OR, XOR, NOT…) : présents dans le code de l'original mais jamais utilisés, donc non gérés.
 *
 * Tout est découpé par le rectangle (et le masque) de la surface de destination.
 */
import type { Shape } from "../../../../data/mohawk/shap";
import type { Surface } from "./surface";

export type BlitMode = 0 | 8;

/** Dessine une forme 8 bits. Une forme 1 bit passée ici est dessinée avec `color` (voir `drawMask`). */
export function drawShape(dst: Surface, shape: Shape, x: number, y: number, mode: BlitMode = 8, color = 255): void {
  if (shape.bitsPerPixel === 1) {
    drawMask(dst, shape, x, y, color);
    return;
  }
  const transparent = mode === 8;
  for (let row = 0; row < shape.height; row++) {
    const dy = y + row;
    const { from, to } = dst.clipSpan(dy, x, shape.width);
    for (let dx = from; dx < to; dx++) {
      const v = shape.pixels[row * shape.width + (dx - x)]!;
      if (transparent && v === 0) continue;
      if (!dst.visible(dx, dy)) continue;
      dst.pixels[dy * dst.width + dx] = v;
    }
  }
}

/** Dessine un masque 1 bit en couleur unie (`color` : index de palette), là où le bit vaut 1. */
export function drawMask(dst: Surface, mask: Shape, x: number, y: number, color: number): void {
  for (let row = 0; row < mask.height; row++) {
    const dy = y + row;
    const { from, to } = dst.clipSpan(dy, x, mask.width);
    for (let dx = from; dx < to; dx++) {
      if (mask.pixels[row * mask.width + (dx - x)] === 0) continue;
      if (!dst.visible(dx, dy)) continue;
      dst.pixels[dy * dst.width + dx] = color;
    }
  }
}

/**
 * Le point `(px, py)`, relatif au coin haut-gauche de la forme, touche-t-il la forme ? Pixel opaque (index ≠ 0) pour une forme
 * 8 bits, bit à 1 pour un masque. Hors de la forme : faux. (Test de pixel de Sticklers, `docs/mathemagique/screens/sticklers.md`.)
 */
export function hitTestShape(shape: Shape, px: number, py: number): boolean {
  if (px < 0 || py < 0 || px >= shape.width || py >= shape.height) return false;
  return shape.pixels[py * shape.width + px] !== 0;
}
