import {
  CARPET_FLY,
  CARPET_MAX_X,
  CARPET_MAX_Y,
  CARPET_MIN_X,
  CARPET_MIN_Y,
  CARPET_TURN_BACK,
  CARPET_TURN_FORTH,
  JUMP_DX,
  LAND_LEFT,
  LAND_RIGHT,
  POSE_IDLE,
  TURN_FALL_RANK,
  type Carpet,
  type FakirState,
} from "../../../src/games/asterix/scenes/minigames/m31";
import type { Launched } from "../game-helpers";
import { minigameState, type MinigamePlayer } from "./harness";

/** Images de l'animation de vol d'un tapis, d'un demi-tour, et d'un saut vers l'étage suivant (de l'appui lu à la retombée). */
export const FLY_FRAMES = 6;
export const TURN_FRAMES = 12;
export const JUMP_FRAMES = 12;
/** Marge du robot sur la fenêtre de retombée, en pixels. */
const MARGIN = 4;

/** Le tapis une image plus tard (règle de `27ba:00df`). */
export function nextCarpet(carpet: Carpet): Carpet {
  const next = { ...carpet };
  if (next.mode === CARPET_FLY) {
    next.rank = (next.rank + 1) % FLY_FRAMES;
    next.x += next.dir * 2;
    next.y += next.dir;
    const out = next.dir === -1 ? next.x < CARPET_MIN_X || next.y < CARPET_MIN_Y : next.x > CARPET_MAX_X || next.y > CARPET_MAX_Y;
    if (out) {
      next.mode = next.dir === -1 ? CARPET_TURN_FORTH : CARPET_TURN_BACK;
      next.dir = -next.dir;
      next.rank = 0;
    }
  } else {
    next.rank = (next.rank + 1) % TURN_FRAMES;
    if (next.rank === 0) {
      next.mode = CARPET_FLY;
      next.x += next.dir * 2;
      next.y += next.dir;
    }
  }
  return next;
}

export function carpetAfter(carpet: Carpet, frames: number): Carpet {
  let result = carpet;
  for (let i = 0; i < frames; i++) result = nextCarpet(result);
  return result;
}

/** Tapis sur lequel le joueur est posé, `null` au sol et au sommet. */
export function ownCarpet(state: FakirState): Carpet | null {
  return state.climbed > 0 && state.climbed <= state.count ? state.carpets[state.count - state.climbed] : null;
}

/** Vrai si un saut demandé maintenant retombe sur le tapis du dessus (ou au sommet), sans demi-tour à l'arrivée. */
export function jumpLands(state: FakirState, margin = MARGIN): boolean {
  if (state.climbed === state.count) return true;
  const target = carpetAfter(state.carpets[state.count - state.climbed - 1], JUMP_FRAMES);
  const x = state.x + JUMP_DX;
  if (!(target.x - LAND_LEFT + margin < x && x < target.x + LAND_RIGHT - margin)) return false;
  return target.mode === CARPET_FLY || target.rank >= TURN_FALL_RANK;
}

/** Vrai si le tapis du joueur se retourne et va le faire tomber : il faut sauter sur place. */
export function mustHop(state: FakirState): boolean {
  const carpet = ownCarpet(state);
  return carpet !== null && carpet.mode !== CARPET_FLY && carpet.rank < TURN_FALL_RANK;
}

/** Avance jusqu'à l'image de jeu suivante (ou la fin de la phase jouable). */
export async function nextFrame(run: Launched, state: FakirState): Promise<void> {
  const frames = state.frames;
  while (state.frames === frames && run.screen === "minigame") await run.frame();
}

/** Robot du Fakir : grimpe de tapis en tapis en sautant sur place aux demi-tours ; pour perdre, reste au sol. */
export const playM31: MinigamePlayer = async (run, win) => {
  const state = minigameState<FakirState>(run);
  while (run.screen === "minigame") {
    if (win && state.pose === POSE_IDLE && !state.timeUp && !state.won && !state.over) {
      if (mustHop(state)) await run.tap("Space");
      else if (jumpLands(state)) await run.tap("ArrowUp");
    }
    await nextFrame(run, state);
  }
};
