/**
 * Famille « electric » (vague Φ2) : interrupteurs, prises, lampes, lasers, miroirs, minuteur, ordinateur, détecteur.
 * Voir `docs/tim3/parts-electric.md` pour l'état du portage et les besoins de noyau.
 */
import type { HandlerRegistry } from "../registry";
import * as lamps from "./lamps";
import * as lasers from "./lasers";
import * as switches from "./switches";

export function register(r: HandlerRegistry): void {
  switches.register(r);
  lamps.register(r);
  lasers.register(r);
}
