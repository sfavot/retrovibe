import type { MinigamePlayer } from "./harness";
import { playM22 } from "./m22-player";

/**
 * Robots des mini-jeux portés, par module : une ligne par mini-jeu. Le robot du parcours (`playthrough/robot.ts`) s'en
 * sert à l'écran `"minigame"` ; un module absent est encore l'écran provisoire.
 */
export const MINIGAME_PLAYERS: Readonly<Record<number, MinigamePlayer>> = {
  22: playM22,
};
