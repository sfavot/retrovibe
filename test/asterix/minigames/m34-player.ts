import { JUDGE_AGE, POSE_RUN, TYPE_FREE, TYPE_LOW, type IdefixObject, type IdefixState } from "../../../src/games/asterix/scenes/minigames/m34";
import type { Launched } from "../game-helpers";
import { minigameState, type MinigamePlayer } from "./harness";

/**
 * Âge de l'obstacle (images depuis son apparition) à partir duquel appuyer. Le saut n'est « en l'air » que de sa 7e à
 * sa 18e image et l'obstacle est jugé de sa 22e à sa 25e : la touche doit être lue entre les âges 7 et 15. Baissé,
 * Idéfix le reste 29 images : la touche peut partir dès que l'obstacle paraît.
 */
export const JUMP_AGE = 9;
export const DUCK_AGE = 3;

/** Prochain obstacle à franchir : le plus avancé de ceux qui ne sont pas encore jugés. */
export function nextObstacle(state: IdefixState): IdefixObject | null {
  const pending = state.objects.slice(0, 2).filter((object) => object.type !== TYPE_FREE && object.age <= JUDGE_AGE);
  return pending.sort((a, b) => b.age - a.age)[0] ?? null;
}

/** Touche qui franchit l'obstacle : sauter par-dessus ceux du sol, se baisser sous ceux du plafond. */
export function obstacleKey(object: IdefixObject): string {
  return object.type === TYPE_LOW ? "ArrowUp" : "ArrowDown";
}

/** Franchit le prochain obstacle au bon moment (à appeler à chaque image) ; rend vrai une fois la touche partie. */
export async function clear(run: Launched, state: IdefixState): Promise<boolean> {
  const object = nextObstacle(state);
  if (!object || state.pose !== POSE_RUN || state.hit) return false;
  if (object.age < (object.type === TYPE_LOW ? JUMP_AGE : DUCK_AGE)) return false;
  await run.tap(obstacleKey(object));
  return true;
}

/** Robot d'Idéfix : franchit tous les obstacles pour gagner, court sans rien faire pour perdre (le premier obstacle le touche). */
export const playM34: MinigamePlayer = async (run, win) => {
  const state = minigameState<IdefixState>(run);
  while (run.screen === "minigame") {
    if (!win || !(await clear(run, state))) await run.frame();
  }
};
