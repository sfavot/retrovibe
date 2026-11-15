/**
 * Famille « creatures » (vague Φ2) : chat Curie (12), diable en boîte (13), mandrill (31), chauve-souris Boris (32),
 * Cupidon (33), Père Noël (34), souris de Newton (42), fromage (52), Mel Schlemming (54) et sa maison (58), alligator
 * (61), leprechaun (65), trou de souris (66), grille-pain (81). Voir `docs/tim3/parts-creatures.md`.
 */
import type { HandlerRegistry } from "../registry";
import { register as registerCatMouse } from "./cat-mouse";
import { register as registerMelFlyers } from "./mel-flyers";
import { register as registerBoxes } from "./boxes";
import { registerBoxHooks } from "./kernel";

export function register(r: HandlerRegistry): void {
  registerCatMouse(r);
  registerMelFlyers(r);
  registerBoxes(r);
  registerBoxHooks(r);
}
