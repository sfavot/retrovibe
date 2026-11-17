import { PHASE_APPEARING, PHASE_WAITING, targetBox, type SangliersState } from "../../../src/games/asterix/scenes/minigames/m28";
import type { Launched } from "../game-helpers";
import { minigameState, type MinigamePlayer } from "./harness";

/** Vrai tant que la cible peut être touchée (elle sort ou elle attend). */
export function targetUp(state: SangliersState): boolean {
  return state.phase === PHASE_APPEARING || state.phase === PHASE_WAITING;
}

/** Milieu de la zone de tir de la cible courante. */
export function aim(state: SangliersState): { x: number; y: number } {
  const box = targetBox(state);
  return { x: Math.floor((box.x1 + box.x2) / 2), y: Math.floor((box.y1 + Math.min(box.y2, 200)) / 2) };
}

/** Clique au milieu de la cible sortie et attend que le tir soit jugé ; rend faux s'il n'y a rien à viser. */
export async function shootTarget(run: Launched, state: SangliersState): Promise<boolean> {
  if (!targetUp(state)) return false;
  const { x, y } = aim(state);
  await run.click(x, y);
  await run.until(() => !targetUp(state) || run.screen !== "minigame", 1_000);
  return true;
}

/**
 * Robot des Sangliers et des Pirates (même code, `24e3`) : touche chaque cible dès qu'elle sort pour gagner ; ne fait
 * rien pour perdre (la première cible repart sans avoir été touchée).
 */
export const playM28: MinigamePlayer = async (run, win) => {
  const state = minigameState<SangliersState>(run);
  while (run.screen === "minigame") {
    if (!win || !(await shootTarget(run, state))) await run.frame();
  }
};

export const playM29: MinigamePlayer = playM28;
