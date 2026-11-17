import { registerMinigame } from "../minigame";
import * as m22 from "./m22";

/**
 * Inscription des mini-jeux portés (vague E) : une ligne par mini-jeu, dans l'ordre des modules. Un module absent de
 * cette liste garde l'écran provisoire de `scenes/minigame.ts`. Importé pour son effet par `scenes/start.ts`.
 */
registerMinigame(m22.MODULE, m22.poissons);
