/** Famille « misc » (vague Φ2) : voir `docs/tim3/plan.md`, groupes de Φ2 ; notes dans `docs/tim3/parts-misc.md`. */
import type { HandlerRegistry } from "../registry";
import { registerObjects } from "./objects";
import { registerPipes } from "./pipes";
import { registerPlay } from "./play";
import { registerTools } from "./tools";

export function register(r: HandlerRegistry): void {
  registerPipes(r);
  registerTools(r);
  registerPlay(r);
  registerObjects(r);
}
