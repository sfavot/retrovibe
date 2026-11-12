/**
 * Cadence du moteur de *Lure of the Temptress* (`docs/lure/plan.md`, « Cadence », D6), d'après `Game::execute` (engines/lure/game.cpp)
 * et `SequenceDelayList::tick` (res_struct.cpp) de ScummVM.
 *
 * ScummVM avance par **images de logique** : `nextFrame` (tick de chaque hotspot actif, pièce, curseur) puis la liste des séquences
 * différées, dès que `getMillis() > timerVal + GAME_FRAME_DELAY` (80 ms) ; à côté, `tickCheck` (horloge de la boutique) dès que 1 000 ms
 * se sont écoulées. Le portage prend **un tick = une image = 80 ms** ; l'horloge de la boutique compte ses 1 000 ms en ticks.
 *
 * Écarts : ScummVM compare avec `>` et ne teste l'horloge qu'à chaque tour de 10 ms, une image dure donc au moins 81 ms ; ici exactement
 * 80 ms (plan, « Cadence »). L'horloge de la boutique reçoit 80 ms par tick et part dès qu'elle atteint 1 000 ms (12,5 ticks en moyenne,
 * reste conservé) au lieu d'une horloge réelle indépendante.
 */

/** Durée d'un tick du moteur = une image de logique (`GAME_FRAME_DELAY`). */
export const TICK_MS = 80;

/** Période de `tickCheck` (`GAME_TICK_DELAY`). */
export const SHOP_TICK_MS = 1000;

/** Ticks rattrapés au plus en une image d'écran (320 ms) : au-delà (onglet gelé), le temps perdu est abandonné. */
export const MAX_CATCH_UP_TICKS = 4;

/** Durée d'une séquence différée : `SequenceDelayData` compte en millisecondes (`delay * 1000`) et retire 80 ms par image. */
export function delaySecondsToMs(seconds: number): number {
  return seconds * 1000;
}
