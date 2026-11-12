/**
 * Curseurs de la souris : `Mouse::setCursorNum` (engines/lure/events.cpp, ScummVM, GPL v3+). 26 images de 16 x 16 (ressource 1), la couleur 0
 * est transparente ; le point chaud est (7, 7), sauf la flèche et le curseur de la barre de menus (0, 0).
 *
 * Écart : ScummVM confie le curseur au système (`CursorMan`) ; ici il est dessiné dans l'image, ou laissé à l'hôte (`cursor: false`).
 */

import { Cursor } from "../engine/ids";
import { CURSOR_HEIGHT, CURSOR_SIZE, CURSOR_WIDTH } from "../data/ids";

/** Point chaud d'un curseur. */
export function cursorHotspot(cursorNum: number): { x: number; y: number } {
  return cursorNum === Cursor.ARROW || cursorNum === Cursor.MENUBAR ? { x: 0, y: 0 } : { x: 7, y: 7 };
}

/** Dessine le curseur `cursorNum` (images concaténées dans `cursors`) à la position (`x`, `y`) du pointeur, rogné à l'écran. */
export function drawCursor(output: Uint8Array, width: number, height: number, cursors: Uint8Array, cursorNum: number, x: number, y: number): void {
  if ((cursorNum + 1) * CURSOR_SIZE > cursors.length) return;
  const hot = cursorHotspot(cursorNum);
  for (let cy = 0; cy < CURSOR_HEIGHT; cy++) {
    for (let cx = 0; cx < CURSOR_WIDTH; cx++) {
      const pixel = cursors[cursorNum * CURSOR_SIZE + cy * CURSOR_WIDTH + cx]!;
      if (pixel === 0) continue;
      const px = x - hot.x + cx;
      const py = y - hot.y + cy;
      if (px >= 0 && py >= 0 && px < width && py < height) output[py * width + px] = pixel;
    }
  }
}
