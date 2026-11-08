/**
 * Cadence du moteur de *Drascula* (`docs/drascula/engine.md`, « Cadence »), d'après engines/drascula/drascula.cpp (ScummVM).
 *
 * ScummVM compte le temps en millisecondes réelles : `delay(ms)` attend **2 x ms** (« originally was 1 », commentaire de
 * ScummVM), `pause(n)` vaut `delay(15 x n)`, `getTime()` rend des centièmes de seconde (`getMillis() / 10`) et la boucle
 * principale attend `delay(25)` entre deux images. Le moteur du portage avance en **ticks fixes de 10 ms** (l'unité de
 * `getTime()`) : toutes ces durées sont alors des nombres entiers de ticks, et les séquences comptent en `pause` / `delay`.
 *
 * Écart : ScummVM ajoute au `delay(25)` le temps de dessin de l'image ; ici une image de la boucle principale dure exactement
 * `FRAME_TICKS`. La cadence de l'exécutable d'origine (DOS) n'est pas connue : à confirmer sous ScummVM (`plan.md`, « Cadence »).
 */

import { type Sequence, wait } from "../../../engine/sequence";

/** Durée d'un tick du moteur (ms) : l'unité de `getTime()` de ScummVM. Seule constante de temps du moteur. */
export const TICK_MS = 10;

/** Ticks rattrapés au plus en une image d'écran (250 ms) : au-delà (onglet gelé, machine lente), le temps perdu est abandonné. */
export const MAX_CATCH_UP_TICKS = 25;

/** Ticks de `delay(ms)` de ScummVM, qui attend deux fois `ms` millisecondes. */
export function delayTicks(ms: number): number {
  return Math.round((ms * 2) / TICK_MS);
}

/** Ticks de `pause(n)` de ScummVM (`delay(15 x n)`) : 3 ticks par unité. */
export function pauseTicks(units: number): number {
  return delayTicks(units * 15);
}

/** Une image de la boucle principale (`delay(25)` de `runCurrentChapter`) : 5 ticks, soit 20 images par seconde. */
export const FRAME_TICKS = delayTicks(25);

/** Attente après un clic traité par la boucle principale (`delay(50)` après `verify1` / `verify2`). */
export const CLICK_DELAY_TICKS = delayTicks(50);

/** Le héros fait un pas quand `getTime()` a avancé d'au moins 6 depuis le pas précédent (`increaseFrameNum`). */
export const WALK_STEP_TICKS = 6;

/** `pause(n)` de ScummVM en séquence : attend `pauseTicks(n)` ticks (n x 30 ms). */
export function pause(units: number): Sequence {
  return wait(pauseTicks(units));
}

/** `delay(ms)` de ScummVM en séquence : attend `delayTicks(ms)` ticks (2 x ms). */
export function delay(ms: number): Sequence {
  return wait(delayTicks(ms));
}
