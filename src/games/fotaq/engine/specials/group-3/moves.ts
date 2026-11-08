/**
 * Mouvements spéciaux du temple (groupe 3) : 20 (panoramique vers la droite, depuis Joe), 24 (panoramique vers Joe), 33 (la
 * pièce 102 se plaint de Joe qui tâtonne). Réécriture de `Logic::asmPanRightFromJoe`, `asmPanToJoe` et `asmAttemptPuzzle`
 * (engines/queen/logic.cpp, ScummVM, GPL v3 ou ultérieure). Cinématiques : 20 et 24 par `C100C` et `C100D` (la mort de Ian), 33 par
 * `C102C` et `C102D` (une inscription de la pièce 102 posée dans le mauvais ordre).
 *
 * Écarts : aucun dans la logique. Le compteur d'essais du puzzle (`_puzzleAttemptCount`) est `state.puzzleAttemptCount`, enregistré avec
 * la partie. Comme `asmPanToJoe`, le mouvement 24 joue une image de plus quand le défilement va vers la droite (ou ne bouge pas).
 */

import type { Sequence } from "../../../../../engine/sequence";
import type { SpecialMove } from "../../script";
import type { FotaqEngine } from "../../loop";
import { bobOf, panTo, putCameraOnBob } from "../kit";
import { JoeSays, PAN_STEP, PUZZLE_ATTEMPTS, SCREEN_HALF, SCROLL_MAX } from "./ids";

/** 20 : la caméra quitte Joe, le décor défile jusqu'à 320 par pas de 16. */
function* panRightFromJoe(g: FotaqEngine): Sequence {
  putCameraOnBob(g, -1);
  yield* panTo(g, SCROLL_MAX, PAN_STEP);
}

/** 24 : le décor défile jusqu'à centrer Joe (son abscisse moins 160, entre 0 et 320) par pas de 16, puis la caméra le suit de nouveau. */
function* panToJoe(g: FotaqEngine): Sequence {
  const target = Math.min(SCROLL_MAX, Math.max(0, bobOf(g, 0).x - SCREEN_HALF));
  putCameraOnBob(g, -1);
  const toLeft = target < g.horizontalScroll;
  yield* panTo(g, target, toLeft ? -PAN_STEP : PAN_STEP);
  if (!toLeft) yield* g.update();
  putCameraOnBob(g, 0);
}

/** 33 : à la quatrième tentative, Joe dit sa réplique d'agacement (description d'objet 226) et le compteur repart de zéro. */
function* attemptPuzzle(g: FotaqEngine): Sequence {
  g.state.puzzleAttemptCount++;
  if (g.state.puzzleAttemptCount === PUZZLE_ATTEMPTS) {
    yield* g.makeJoeSpeak(JoeSays.PuzzleHint, true);
    g.state.puzzleAttemptCount = 0;
  }
}

export const templeMoves: Partial<Record<number, SpecialMove>> = {
  20: panRightFromJoe,
  24: panToJoe,
  33: attemptPuzzle,
};
