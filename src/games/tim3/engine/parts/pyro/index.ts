/**
 * Famille « pyro » (vague Φ2) : création et destruction de pièces en cours de pas, feu et explosions. Types 18, 19,
 * 36, 41, 45, 55, 70, 73, 74, 75, 78, 79, 80, 109, 138 (`docs/tim3/plan.md`, groupes de Φ2 ; notes dans
 * `docs/tim3/parts-pyro.md`).
 */
import type { HandlerRegistry } from "../registry";
import * as explosives from "./explosives";
import * as flames from "./flames";
import * as flyers from "./flyers";
import * as launchers from "./launchers";

export { flame, nearby } from "./kernel";
export { balloonPulled } from "./flyers";
export { matchPulled } from "./flames";

export function register(r: HandlerRegistry): void {
  explosives.register(r);
  flames.register(r);
  launchers.register(r);
  flyers.register(r);
}
