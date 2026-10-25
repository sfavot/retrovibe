import { FAMILY, type HandlerRegistry, type ReactionHandler } from "../engine/handlers";

/**
 * Disponibilité du héros pour la réaction « trop loin » (famille 9, `docs/armaeth/objects.md` § 1.5 et § 7). L'armement
 * (`2363:000c`, `ctx.react`), la marche (`2363:0154`) et le rejeu à l'arrivée (`2363:01ea`) sont ceux du moteur (`engine.ts`,
 * `engine/handlers.ts` : `HandlerReaction`) ; ce module ne porte que la table des gestionnaires de la famille 9.
 */

/** Clés de la famille 9 et `Ego` qui laissent le héros partir vers l'objet (`objects.md` § 7). */
export const REACTION_TABLE: ReadonlyArray<{ keys: readonly number[]; egos: readonly number[] }> = [
  { keys: [1], egos: [0, 1, 8] }, // Killian `2683:0000`
  { keys: [3], egos: [0, 1, 3, 4] }, // pie `2774:045c`
  { keys: [4], egos: [0, 1] }, // ours `26da:0444`
  { keys: [101], egos: [0, 4] }, // Prytwen `28b1:1482`
  { keys: [201, 202, 203, 204, 301], egos: [0, 4] }, // nains `2a44:13fa`
  { keys: [302], egos: [0] }, // Sarhûl `2cdf:0706`
  { keys: [303], egos: [0, 7] }, // Minas Thyl `2dd9:1570`
  { keys: [327], egos: [0, 7] }, // crapaud `2d52:0838`
];

/** Gestionnaire de famille 9 : vrai si l'`Ego` du héros est dans la liste, sinon `V093` « Pas maintenant ! » immédiat et faux. */
export function availableWhen(egos: readonly number[]): ReactionHandler {
  return (hero, ctx) => {
    if (egos.includes(hero.ego)) return true;
    ctx.messages.say("V", 93);
    return false;
  };
}

/** Enregistre les 8 gestionnaires de réaction (12 clés). */
export function registerReactions(registry: HandlerRegistry): void {
  for (const { keys, egos } of REACTION_TABLE) registry.register(FAMILY.reaction, keys, availableWhen(egos));
}
