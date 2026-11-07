import type { DrasculaEngine } from "../../loop";
import type { RoomPainter } from "../../../render/renderer";
import { Anim } from "./ids";

/**
 * Pièce 2, le carrefour (pas de `room_2`). Réécriture de `update_2` (engines/drascula/rooms.cpp, ScummVM) : une chauve-souris
 * qui bat des ailes derrière le clocher (41 images dans `AUX2.ALG`), un morceau du décor repeint par-dessus, et `showMap()`.
 *
 * Écarts :
 * - l'avance de la chauve-souris (`difference >= 6`) est séparée du dessin : `tickCrossroads` (accroche `tick`) l'avance, le
 *   painter dessine depuis `anim.bat` (`docs/drascula/rooms.md` § 4) ;
 * - `showMap()` (le nom des objets visibles survolés, portes comprises, sans verbe en main) est celui du moteur : la pièce 2 est
 *   dans `MAP_ROOMS` de `loop.ts`, comme les cartes 10 et 45.
 */

/** Ticks entre deux images de la chauve-souris (`getTime() - savedTime >= 6`). */
const BAT_TICKS = 6;
/** Nombre d'images (la 41e est la première). */
const BAT_FRAMES = 41;

const BAT_X = [0, 38, 76, 114, 152, 190, 228, 266, 0, 38, 76, 114, 152, 190, 228, 266, 0, 38, 76, 114, 152, 190, 0, 48, 96, 144, 192, 240, 30, 88, 146, 204, 262, 88, 146, 204, 262, 88, 146, 204, 262];
const BAT_Y = [179, 179, 179, 179, 179, 179, 179, 179, 158, 158, 158, 158, 158, 158, 158, 158, 137, 137, 137, 137, 137, 137, 115, 115, 115, 115, 115, 115, 78, 78, 78, 78, 78, 41, 41, 41, 41, 4, 4, 4, 4];

/** Taille de l'image de la chauve-souris selon son rang : 37 x 21, 47 x 22 (images 22 à 27), 57 x 36 (28 et suivantes). */
function batSize(frame: number): { w: number; h: number } {
  if (frame < 22) return { w: 37, h: 21 };
  if (frame > 27) return { w: 57, h: 36 };
  return { w: 47, h: 22 };
}

/** Partie « avance » de `update_2`. */
export function tickCrossroads(g: DrasculaEngine): void {
  const s = g.state;
  if (s.room?.number !== 2 || !g.gfx.roomSprites || g.gfx.owner !== "room") return;
  if (g.ticks - s.savedTime >= BAT_TICKS) {
    s.anim[Anim.Bat] = ((s.anim[Anim.Bat] ?? 0) + 1) % BAT_FRAMES;
    s.savedTime = g.ticks;
  }
}

/** `update_2` (après le héros). */
export const crossroadsPainter: RoomPainter = {
  post(r, s) {
    const frame = s.anim[Anim.Bat] ?? 0;
    const { w, h } = batSize(frame);
    r.screen.copyRect(r.draw3, BAT_X[frame], BAT_Y[frame], 239, 19, w, h);
    r.screen.copyRect(r.draw3, 29, 37, 58, 114, 57, 39);
  },
};
