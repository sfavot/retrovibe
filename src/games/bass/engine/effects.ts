/**
 * Effets bloquants des mcodes : fondus, défilement, attente de `fnLookAt`, fin d'une séquence « swing ».
 *
 * Référence : ScummVM engines/sky/screen.cpp (`fnFadeDown`, `fnFadeUp`, `paletteFadeUp`, `fnDrawScreen`, `waitForTick`, `waitForSequence`),
 * mouse.cpp (`waitMouseNotPressed`) et logic.cpp (`fnLookAt`) (GPL v3 ou ultérieure).
 *
 * Dans ScummVM, ces boucles tournent **au milieu** de `Logic::engine`, à l'intérieur du mcode : aucune autre logique ne tourne pendant le
 * fondu. Ici, un mcode demande l'effet (`EffectQueue.block`) et rend la main tout de suite ; le tour de logique (`Logic.engine`, un
 * générateur) joue les effets demandés **après le compact en cours** puis reprend au compact suivant (`engine.md` § 13). Un effet est une
 * séquence (`src/engine/sequence.ts`) dont l'unité de temps est le tick de 20 ms de l'hôte.
 */

import { type Sequence, wait } from "../../../engine/sequence";
import { SF } from "./ids";
import type { BassScreen } from "./services";

/** Pas d'un fondu (`fnFadeDown`, `paletteFadeUp`) : 32 pas de 20 ms. */
export const FADE_STEPS = 32;
/** Pas d'un défilement (`GAME_SCREEN_WIDTH / SCROLL_JUMP - 1`), un par tick de 20 ms (`waitForTick`). */
export const SCROLL_STEPS = 19;
/** Durée minimale de `fnLookAt` (`waitMouseNotPressed(800)`), en ticks de 20 ms. */
export const LOOK_AT_TICKS = 40;

/** File des effets demandés pendant l'exécution d'un compact. */
export class EffectQueue {
  private readonly queue: Sequence[] = [];

  /** Demande un effet bloquant, joué après le compact en cours (dans l'ordre des demandes). */
  block(effect: Sequence): void {
    this.queue.push(effect);
  }

  get pending(): boolean {
    return this.queue.length > 0;
  }

  /** Joue les effets en attente, y compris ceux qu'un effet demanderait lui-même. */
  *flush(): Sequence {
    while (this.queue.length) yield* this.queue.shift()!;
  }

  clear(): void {
    this.queue.length = 0;
  }
}

/** `scroll` normalisé comme `fnFadeUp` : 123 (vers la droite), 321 (vers la gauche) ou 0 (fondu). */
function scrollKind(scroll: number, systemFlags: number): number {
  if (scroll !== 123 && scroll !== 321) return 0;
  return systemFlags & SF.NO_SCROLL ? 0 : scroll;
}

/** `Screen::fnFadeDown(scroll)`. */
export function* fadeDown(screen: BassScreen, scroll: number, systemFlags: number): Sequence {
  screen.fadeDown(scroll);
  if (scrollKind(scroll, systemFlags)) return; // défilement : seulement préparé ici, joué par `fadeUp`
  for (let step = 0; step < FADE_STEPS; step++) {
    screen.effectStep("fadeDown", step, FADE_STEPS);
    yield* wait(1);
  }
}

/** `Screen::fnFadeUp(palette, scroll)`. */
export function* fadeUp(screen: BassScreen, palette: number, scroll: number, systemFlags: number): Sequence {
  screen.fadeUp(palette, scroll);
  const kind = scrollKind(scroll, systemFlags);
  const name = kind === 0 ? "fadeUp" : kind === 123 ? "scrollLeft" : "scrollRight";
  const steps = kind === 0 ? FADE_STEPS : SCROLL_STEPS;
  for (let step = 0; step < steps; step++) {
    screen.effectStep(name, step, steps);
    yield* wait(1);
  }
}

/** `Screen::fnDrawScreen(palette, scroll)` : fondu au noir, nouveau décor, fondu depuis le noir (ou défilement). */
export function* drawScreen(screen: BassScreen, palette: number, scroll: number, systemFlags: number): Sequence {
  yield* fadeDown(screen, scroll, systemFlags);
  screen.drawNewScreen();
  yield* fadeUp(screen, palette, scroll, systemFlags);
}

/**
 * `fnLookAt` : l'image est composée (logic.cpp:2469, le texte formé est à l'écran), puis le texte reste au moins 800 ms **et** tant qu'un
 * bouton est enfoncé (`waitMouseNotPressed(800)`) ; `skipped()` jette les entrées reçues et rend vrai si Échap en faisait partie, ce qui
 * abrège l'attente (durée minimale et bouton compris). `buttonHeld()` : boutons enfoncés (`Mouse.held`, `getButtonState`).
 */
export function* lookAtWait(screen: BassScreen, skipped: () => boolean, buttonHeld: () => boolean): Sequence {
  screen.compose(); // `recreate`, `spriteEngine`, `flip` : le texte s'affiche avant l'attente
  for (let t = 0; t < LOOK_AT_TICKS || buttonHeld(); t++) {
    if (skipped()) return;
    yield* wait(1);
  }
}

/** `waitForSequence` (`fnWaitSwingEnd`) : la séquence avance toutes les 20 ms jusqu'à sa fin ; les entrées reçues sont jetées (`drain`). */
export function* waitSequenceEnd(screen: BassScreen, nowMs: () => number, drain: () => void): Sequence {
  while (screen.sequenceRunning()) {
    screen.processSequence(nowMs());
    yield* wait(1);
    drain();
  }
}
