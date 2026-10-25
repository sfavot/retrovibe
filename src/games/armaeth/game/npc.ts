import type { HandlerRegistry } from "../engine/handlers";
import { registerCorpse } from "./hero";
import { registerCreatures } from "./npc-creatures";
import { registerDwarves } from "./npc-dwarves";
import { registerNpcEvents } from "./npc-events";
import { type NpcAnimations, NpcKit } from "./npc-kit";
import { registerMinas } from "./npc-minas";
import { registerPrytwen } from "./npc-prytwen";
import { registerThings } from "./npc-things";

/**
 * Personnages et objets animés d'*Armaeth* (`docs/armaeth/characters.md`) : procédures `Fct` de la famille 2 (toutes sauf le héros,
 * `Num 1`, dépouille comprise : `hero.ts`) et leurs événements différés (famille 8, clés 4, 101, 201, 303, 327). La famille 7 (interface) est enregistrée par le
 * noyau du moteur (`registerCoreBehaviors`).
 *
 * `animations` : service d'animations scénarisées (défaut `contextAnimations`, qui lit `ctx.sprites` et `ctx.ani`).
 */
export function registerNpcs(registry: HandlerRegistry, animations?: NpcAnimations): NpcKit {
  const kit = new NpcKit(animations);
  registerThings(registry, kit);
  registerCorpse(registry); // dépouille (`Num 2`) : version unique de `hero.ts`, `2405:0106`
  registerCreatures(registry, kit);
  registerDwarves(registry, kit);
  registerPrytwen(registry, kit);
  registerMinas(registry, kit);
  registerNpcEvents(registry, kit);
  return kit;
}

export { contextAnimations, createAnimations, instantAnimations, type NpcAnimations, NpcKit } from "./npc-kit";
export { type DuelGear, type DuelOutcome, dwarfType, resolveDuel } from "./npc-dwarves";
