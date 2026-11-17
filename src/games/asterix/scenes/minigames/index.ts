import { registerMinigame } from "../minigame";
import * as m22 from "./m22";
import * as m23 from "./m23";
import * as m24 from "./m24";
import * as m25 from "./m25";
import * as m26 from "./m26";
import * as m27 from "./m27";
import * as m28 from "./m28";
import * as m30 from "./m30";
import * as m31 from "./m31";
import * as m32 from "./m32";
import * as m33 from "./m33";
import * as m34 from "./m34";
import * as m35 from "./m35";
import * as m36 from "./m36";

/**
 * Inscription des mini-jeux portés (vague E) : une ligne par mini-jeu, dans l'ordre des modules. Un module absent de
 * cette liste garde l'écran provisoire de `scenes/minigame.ts`. Importé pour son effet par `scenes/start.ts`.
 */
registerMinigame(m22.MODULE, m22.poissons);
registerMinigame(m23.MODULE, m23.barde);
registerMinigame(m24.MODULE, m24.loupe);
registerMinigame(m25.MODULE, m25.anachronismes);
registerMinigame(m26.MODULE, m26.brouillard);
registerMinigame(m27.MODULE, m27.tempete);
// Sangliers (28) et Pirates (29) : un seul segment, `24e3:0406`, appelé avec l'argument 0 ou 1.
registerMinigame(m28.MODULE_SANGLIERS, m28.script);
registerMinigame(m28.MODULE_PIRATES, m28.script);
registerMinigame(m30.MODULE, m30.olympiques);
registerMinigame(m31.MODULE, m31.fakir);
registerMinigame(m32.MODULE, m32.bagarre);
registerMinigame(m33.MODULE, m33.hieroglyphes);
registerMinigame(m34.MODULE, m34.script);
registerMinigame(m35.MODULE, m35.coloriages);
registerMinigame(m36.MODULE, m36.ciel);
