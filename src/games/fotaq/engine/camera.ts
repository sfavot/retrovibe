/**
 * Caméra défilante et parallaxe (`docs/fotaq/engine.md`, § 11). Réécriture de `Display::horizontalScrollUpdate` (display.cpp) et de
 * `Graphics::handleParallax` (graphics.cpp, ScummVM) : un décor de 640 pixels défile derrière l'écran de 320 ; la caméra suit un
 * bob (Joe par défaut) et le défilement (`g.horizontalScroll`) va de 0 à 320. Quelques pièces ont des décors qui bougent moins vite
 * que le fond (bobs de parallaxe) ou une animation propre de la pièce.
 *
 * Écarts : les animations de la course de voiture (pièce 74) et du combat final (pièce 69, `BamScene`) sont à la vague L : elles
 * s'enregistrent comme `RoomUpdate` du `GameStage` ; le défilement n'a pas de rafraîchissement à demander (le rendu redessine tout).
 */

import type { Bobs } from "./bobs";
import type { FotaqEngine } from "./loop";

/** Largeur d'un écran. */
export const SCREEN_WIDTH = 320;

/**
 * Défilement pour une caméra à l'abscisse `cameraX` (`Display::horizontalScrollUpdate`) : Joe au milieu de l'écran, entre les
 * deux bords du décor ; aucun défilement si le décor n'est pas plus large que l'écran.
 */
export function scrollFor(cameraX: number, width: number): number {
  if (width <= SCREEN_WIDTH) return 0;
  if (cameraX > 160 && cameraX < 480) return cameraX - 160;
  if (cameraX >= 480) return 320;
  return 0;
}

/** Pièces dont des bobs défilent plus lentement que le décor : numéro du bob et abscisse dans le décor (`handleParallax`). */
const PARALLAX: Record<number, { bob: number; x: number }[]> = {
  17: [{ bob: 8, x: 250 }],
  43: [{ bob: 5, x: 320 }],
  51: [{ bob: 5, x: 280 }],
  67: [{ bob: 5, x: 600 }],
  90: [
    { bob: 5, x: 340 },
    { bob: 6, x: 50 },
    { bob: 7, x: 79 },
  ],
  100: [
    { bob: 5, x: 410 },
    { bob: 6, x: 790 },
  ],
};

/** Animation propre à une pièce, appelée à chaque image après la caméra (course de voiture, combat final : vague L). */
export type RoomUpdate = (g: FotaqEngine, bobs: Bobs) => void;

/** Introduction, tête de Joe et de Rita (pièce 116) : le décor glisse et les deux personnages se rapprochent. */
const INTRO_HEADS_ROOM = 116;
/** Introduction, explosion (pièce 123). */
const INTRO_EXPLOSION_ROOM = 123;

/**
 * Parallaxe et animations de pièce d'une image (`Graphics::handleParallax`) ; `updates` : les animations des pièces portées par la
 * vague L.
 */
export function handleParallax(g: FotaqEngine, bobs: Bobs, room: number, updates: ReadonlyMap<number, RoomUpdate>): void {
  const scroll = g.horizontalScroll;
  for (const layer of PARALLAX[room] ?? []) bobs.bob(layer.bob).x = layer.x - Math.trunc(scroll / 2);
  if (room === INTRO_HEADS_ROOM) {
    bobs.cameraBob = -1;
    if (scroll < 80) {
      g.horizontalScroll = scroll + 4;
      // Joe (corps et tête), Rita (corps et tête).
      bobs.bob(1).x += 4;
      bobs.bob(20).x += 4;
      bobs.bob(2).x -= 2;
      bobs.bob(21).x -= 2;
    }
  } else if (room === INTRO_EXPLOSION_ROOM) {
    bobs.bob(21).x += 2;
    bobs.bob(21).y += 2;
  }
  updates.get(room)?.(g, bobs);
}
