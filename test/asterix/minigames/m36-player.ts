import { MOVE_NONE, type CielState } from "../../../src/games/asterix/scenes/minigames/m36";
import type { Launched } from "../game-helpers";
import { minigameState, type MinigamePlayer } from "./harness";

/** Vrai si un rocher tombe dans le couloir du joueur (il n'y a jamais qu'un rocher à la fois). */
export function threatened(state: CielState): boolean {
  return state.falling && !state.crashed && state.lane === state.pos;
}

/** Touche qui sort le joueur de son couloir : à gauche s'il peut, sinon à droite. */
export function escapeKey(state: CielState): string {
  return state.pos > 0 ? "ArrowLeft" : "ArrowRight";
}

/** S'écarte du rocher qui vise le joueur (à appeler à chaque image) ; rend vrai une fois la touche partie. */
export async function dodge(run: Launched, state: CielState): Promise<boolean> {
  if (!threatened(state) || state.move !== MOVE_NONE || state.hit) return false;
  await run.tap(escapeKey(state));
  return true;
}

/** Robot du Ciel sur la tête : s'écarte de chaque rocher pour gagner, ne bouge pas pour perdre (un rocher sur deux le vise). */
export const playM36: MinigamePlayer = async (run, win) => {
  const state = minigameState<CielState>(run);
  while (run.screen === "minigame") {
    if (!win || !(await dodge(run, state))) await run.frame();
  }
};
