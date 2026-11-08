/**
 * Aides communes aux mouvements spéciaux et aux cas de pièce (`docs/fotaq/specials.md`, § 3). Elles reprennent ce que le code de
 * ScummVM (`Logic::asm*`, `handlePinnacleRoom`…) fait par `_vm->graphics()`, `_vm->display()` et `_vm->input()` : l'accès aux bobs, la
 * caméra, le défilement, le mode rapide, la secousse de l'écran, l'éclair blanc. **Ne pas modifier sans le signaler** : tous les
 * groupes en dépendent ; une aide qui manque se décrit dans `docs/fotaq/specials-group-N.md` (§ « Aides manquantes »).
 */

import { type Sequence, wait } from "../../../../engine/sequence";
import type { BobSlot } from "../bobs";
import type { FotaqEngine } from "../loop";
import { type GameStage, requireGameStage } from "../stage";

export type { RoomUpdate } from "../camera";
export type { BamDataBlock } from "./bam";

/** La scène réelle (bobs, écran, marche) : les mouvements spéciaux n'ont pas de sens sans elle. */
export const stageOf = (g: FotaqEngine): GameStage => requireGameStage(g);

/** Le bob `n` (0 Joe, 1 à 3 les personnes, 5 et suivants les bobs animés, 20 et suivants les bobs fixes : `engine.md` § 11). */
export const bobOf = (g: FotaqEngine, n: number): BobSlot => requireGameStage(g).bobs.bob(n);

/** `Graphics::putCameraOnBob` : la caméra suit le bob `n` ; -1 : aucun (le défilement est alors à régler à la main). */
export function putCameraOnBob(g: FotaqEngine, n: number): void {
  requireGameStage(g).bobs.cameraBob = n;
}

/** `Display::horizontalScroll(x)` : le défilement du décor (0 à 320). */
export function setScroll(g: FotaqEngine, x: number): void {
  g.horizontalScroll = x;
}

/** `Input::fastMode(on)` : le mode rapide (une image de logique dure `DELAY_SHORT` : voir `cadence.ts`). */
export function fastMode(g: FotaqEngine, on: boolean): void {
  g.input.fastMode = on;
}

/** `Display::shake(reset)` : l'écran remonté de 3 lignes (`on`) ou remis en place. */
export function shake(g: FotaqEngine, on: boolean): void {
  requireGameStage(g).display.shakeY = on ? 3 : 0;
}

/**
 * `Display::palCustomFlash` : un éclair blanc d'une image (palette blanche, noire de 17 à 66, puis la palette de l'écran).
 * Écart : ScummVM rétablit la palette tout de suite après l'avoir affichée ; ici l'éclair dure une image de jeu (100 ms).
 */
export function* flash(g: FotaqEngine): Sequence {
  const { palette } = requireGameStage(g).display;
  palette.flash(true);
  yield* wait(1);
  palette.flash(false);
}

/**
 * Panoramique : le défilement va de sa valeur actuelle à `target` par pas de `step` (signé, borné à `target`), une image de jeu par
 * pas (`g.update()`), la caméra libérée. `quit` : une demande de passage de la cinématique (`cutawayQuit`) arrête la boucle, comme
 * `!_vm->input()->cutawayQuit()` des mouvements 17, 18, 36, 38 et 39. `from` : valeur de départ si ce n'est pas le défilement actuel (la variable locale de `asmPanRightToHugh`). `each` est appelé à chaque pas, après le défilement et avant
 * l'image (les bobs qui bougent avec le décor).
 */
export function* panTo(g: FotaqEngine, target: number, step: number, options: { quit?: boolean; from?: number; each?: (scroll: number) => void } = {}): Sequence {
  let scroll = options.from ?? g.horizontalScroll;
  while (scroll !== target && !(options.quit && g.input.cutawayQuit)) {
    scroll += step;
    if ((step > 0 && scroll > target) || (step < 0 && scroll < target)) scroll = target;
    g.horizontalScroll = scroll;
    options.each?.(scroll);
    yield* g.update();
  }
}

/** Joue `count` images de jeu (`while (n--) _vm->update()`). */
export function* frames(g: FotaqEngine, count: number): Sequence {
  for (let i = 0; i < count; i++) yield* g.update();
}
