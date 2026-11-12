/**
 * Séquences plein écran (groupe Q, `docs/lure/engine.md` § 8) : introduction, fin, chute, tonneau, capture. Elles sont jouées par le
 * moteur comme des séquences bloquantes (`ctx.block`), image de logique par image de logique ; le rendu lit l'écran qu'elles dessinent
 * (`SequenceScreen`).
 */

import type { MethodGroupTable } from "../methods/index";
import { endgameSequence } from "./ending";

export { endgameSequence } from "./ending";
export { barrelSequence, captureSequence, chuteSequence } from "./fullscreen";
export { introduction, playIntroduction } from "./intro";
export { SequenceScreen } from "./screen";
export type { SequencePort } from "./port";

/** Méthode native 14 `endgameSequence`. */
export const SEQUENCE_METHODS: MethodGroupTable = {
  14: (ctx) => ctx.block(endgameSequence(ctx)),
};
