import { HIT_MIN_X, LANE_BOTTOM, LANE_MIDDLE, POSE_STANDING, type PoissonsState } from "../../../src/games/asterix/scenes/minigames/m22";
import type { Launched } from "../game-helpers";
import { minigameState, type MinigamePlayer } from "./harness";

/**
 * Images entre le départ d'un poisson et l'appui qui met le joueur en l'air à sa première image dangereuse. Le choc est
 * jugé aux images où `k × vitesse` est dans la fenêtre, sur le sprite de l'image d'avant ; un saut lancé à l'image `p`
 * est « en l'air » de `p + 2` à `p + 6` : on le lance trois images avant la première image dangereuse.
 */
export function jumpFrame(state: PoissonsState): number {
  return Math.ceil((HIT_MIN_X + 1) / state.speed) - 3;
}

/** Image de l'appui qui évite le poisson en vol : le saut au bon moment ; se baisser protège onze images, donc tout de suite. */
export function pressFrame(state: PoissonsState): number {
  return state.lane === LANE_MIDDLE ? 1 : jumpFrame(state);
}

/** Touche qui évite le poisson en vol, `null` s'il faut le laisser passer (couloir du haut). */
export function dodgeKey(state: PoissonsState): string | null {
  if (state.lane === LANE_BOTTOM) return "ArrowUp";
  if (state.lane === LANE_MIDDLE) return "ArrowDown";
  return null;
}

/** Appuie sur `key` quand le poisson en vol est à `frame` images de son départ (à appeler à chaque image) ; rend vrai une fois la touche partie. */
export async function pressAt(run: Launched, state: PoissonsState, key: string, frame: number): Promise<boolean> {
  if (!state.fishActive || state.pose !== POSE_STANDING) return false;
  // La touche est lue à l'image de jeu suivante : `fishX / speed + 1` images après le départ.
  if (state.fishX / state.speed + 1 < frame) return false;
  await run.tap(key);
  return true;
}

/** Évite le poisson en vol au bon moment (à appeler à chaque image). */
export async function dodge(run: Launched, state: PoissonsState): Promise<boolean> {
  const key = dodgeKey(state);
  return key !== null && (await pressAt(run, state, key, pressFrame(state)));
}

/** Robot des Poissons : évite tout pour gagner, ne fait rien pour perdre (le premier poisson du milieu ou du bas touche). */
export const playM22: MinigamePlayer = async (run, win) => {
  const state = minigameState<PoissonsState>(run);
  while (run.screen === "minigame") {
    if (!win || !(await dodge(run, state))) await run.frame();
  }
};
