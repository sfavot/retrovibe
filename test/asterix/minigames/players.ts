import type { MinigamePlayer } from "./harness";
import { playM22 } from "./m22-player";
import { playM23 } from "./m23-player";
import { playM24 } from "./m24-player";
import { playM25 } from "./m25-player";
import { playM26 } from "./m26-player";
import { playM27 } from "./m27-player";
import { playM28, playM29 } from "./m28-player";
import { playM30 } from "./m30-player";
import { playM31 } from "./m31-player";
import { playM32 } from "./m32-player";
import { playM33 } from "./m33-player";
import { playM34 } from "./m34-player";
import { playM35 } from "./m35-player";
import { playM36 } from "./m36-player";

/**
 * Robots des mini-jeux portés, par module : une ligne par mini-jeu. Le robot du parcours (`playthrough/robot.ts`) s'en
 * sert à l'écran `"minigame"` ; un module absent est encore l'écran provisoire.
 */
export const MINIGAME_PLAYERS: Readonly<Record<number, MinigamePlayer>> = {
  22: playM22,
  23: playM23,
  24: playM24,
  25: playM25,
  26: playM26,
  27: playM27,
  28: playM28,
  29: playM29,
  30: playM30,
  31: playM31,
  32: playM32,
  33: playM33,
  34: playM34,
  35: playM35,
  36: playM36,
};
