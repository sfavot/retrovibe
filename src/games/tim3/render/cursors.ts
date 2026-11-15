/**
 * Curseurs : 47 images de `CURSORS.BMP`, avec le point chaud de chacune dans `CURSOR.RES` (« x,y » par ligne, une par image).
 * Le sens des images n'est établi que pour la première (flèche, 24×24, point chaud 0,0) ; les trois suivantes (32×42, point
 * chaud 13,20) sont des mains (supposé : libre, saisie, …).
 */
import { parseLines } from "../data/text";
import type { RenderAssets } from "./assets";
import type { IndexedImage, Surface } from "./surface";

export interface Cursor {
  image: IndexedImage;
  hotX: number;
  hotY: number;
}

export const CURSOR_ARROW = 0;
export const CURSOR_HAND = 1;

/** Curseur numéro `i` de CURSORS.BMP, `null` s'il n'existe pas. */
export function cursorAt(assets: RenderAssets, i: number): Cursor | null {
  const image = assets.bitmap("CURSORS.BMP")?.frames[i];
  if (!image) return null;
  const line = assets.index.has("CURSOR.RES") ? parseLines(assets.index.get("CURSOR.RES"))[i] : undefined;
  const [hx, hy] = (line ?? "0,0").split(",").map((v) => Number.parseInt(v, 10) || 0);
  return { image, hotX: hx ?? 0, hotY: hy ?? 0 };
}

/** Dessine un curseur dont le point chaud est en (x, y). */
export function drawCursor(surface: Surface, cursor: Cursor, x: number, y: number): void {
  surface.blit(cursor.image, x - cursor.hotX, y - cursor.hotY);
}
