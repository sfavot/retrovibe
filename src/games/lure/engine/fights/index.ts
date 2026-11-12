/**
 * Groupe F : les combats (`docs/lure/engine.md`, § 8). Méthodes 15 `setupPigFight` et 17 `setupSkorlFight`, gestionnaires 38
 * `fighterAnimHandler` et 39 `playerFightAnimHandler` ; le service `Fights` est `FightsManager` (`manager.ts`).
 *
 * Source (ScummVM, GPL v3+) : `Script::setupPigFight`, `Script::setupSkorlFight` (engines/lure/scripts.cpp),
 * `HotspotTickHandlers::fighterAnimHandler` et `playerFightAnimHandler` (hotspots.cpp), qui délèguent à `FightsManager` (fights.cpp).
 *
 * Écarts : voir `manager.ts`. Un moteur dont le service `Fights` n'est pas un `FightsManager` (doublure de test) journalise l'appel.
 */

import type { LureContext } from "../context";
import type { HandlerGroupTable } from "../handlers/index";
import type { MethodGroupTable } from "../methods/index";
import { FightsManager } from "./manager";

export { FightsManager, type FighterRecord, type FightsSave } from "./manager";

/** Le `FightsManager` du contexte, ou `null` (journalisé) si le service est une autre implémentation. */
function manager(ctx: LureContext, what: string): FightsManager | null {
  if (ctx.fights instanceof FightsManager) return ctx.fights;
  ctx.journal.log(`${what} : le service de combat n'est pas un FightsManager`);
  return null;
}

export const FIGHT_METHODS: MethodGroupTable = {
  15: (ctx) => manager(ctx, "setupPigFight")?.setupPigFight(),
  17: (ctx) => manager(ctx, "setupSkorlFight")?.setupSkorlFight(),
};

export const FIGHT_HANDLERS: HandlerGroupTable = {
  fighterAnimHandler: (ctx, h) => manager(ctx, "fighterAnimHandler")?.fighterAnimHandler(h),
  playerFightAnimHandler: (ctx, h) => manager(ctx, "playerFightAnimHandler")?.playerAnimHandler(h),
};
