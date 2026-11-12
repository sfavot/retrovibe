/**
 * Gestionnaires de tick des hotspots : les 39 numéros de `HotspotTickHandlers::getHandler` (1 à 39) et les 32 fonctions qu'ils
 * désignent, avec leur groupe de portage (`docs/lure/engine.md`, § 8). Toutes viennent de `engines/lure/hotspots.cpp` (ScummVM, GPL v3+).
 *
 * Groupes : `L1` génériques (portés en G1, `group-1/`), `G1` le joueur hors marche (`player.ts`), `G2` mouvement et autonomie,
 * `L2` cellule, `L3` village, `L4` Goewin, moines, château, `T` dialogues, `F` combats.
 */

export type HandlerGroup = "L1" | "G1" | "G2" | "L2" | "L3" | "L4" | "T" | "F";

export interface HandlerInfo {
  name: string;
  group: HandlerGroup;
  /** Numéros de gestionnaire (`tickProcId`) qui désignent cette fonction. */
  ids: readonly number[];
}

export const HANDLER_CATALOG: readonly HandlerInfo[] = [
  { name: "defaultHandler", group: "L1", ids: [1] },
  { name: "standardCharacterAnimHandler", group: "G2", ids: [2] },
  { name: "playerAnimHandler", group: "G1", ids: [3] },
  { name: "voiceBubbleAnimHandler", group: "L1", ids: [4] },
  { name: "puzzledAnimHandler", group: "L1", ids: [5] },
  { name: "roomExitAnimHandler", group: "L1", ids: [6] },
  { name: "followerAnimHandler", group: "G2", ids: [7, 8] },
  { name: "jailorAnimHandler", group: "L2", ids: [9, 10] },
  { name: "standardAnimHandler2", group: "L1", ids: [11] },
  { name: "standardAnimHandler", group: "L1", ids: [12] },
  { name: "sonicRatAnimHandler", group: "L2", ids: [13] },
  { name: "droppingTorchAnimHandler", group: "L2", ids: [14] },
  { name: "playerSewerExitAnimHandler", group: "L2", ids: [15] },
  { name: "fireAnimHandler", group: "L1", ids: [16] },
  { name: "sparkleAnimHandler", group: "L1", ids: [17] },
  { name: "teaAnimHandler", group: "L3", ids: [18] },
  { name: "goewinCaptiveAnimHandler", group: "L4", ids: [19] },
  { name: "prisonerAnimHandler", group: "L2", ids: [20] },
  { name: "catrionaAnimHandler", group: "L4", ids: [21] },
  { name: "morkusAnimHandler", group: "L4", ids: [22] },
  { name: "grubAnimHandler", group: "L3", ids: [23] },
  { name: "barmanAnimHandler", group: "L3", ids: [24] },
  { name: "skorlAnimHandler", group: "L3", ids: [25] },
  { name: "gargoyleAnimHandler", group: "L4", ids: [26] },
  { name: "goewinShopAnimHandler", group: "L3", ids: [27] },
  { name: "skullAnimHandler", group: "L4", ids: [28, 29, 30, 31, 32, 33] },
  { name: "dragonFireAnimHandler", group: "L4", ids: [34] },
  { name: "castleSkorlAnimHandler", group: "L4", ids: [35] },
  { name: "rackSerfAnimHandler", group: "L4", ids: [36] },
  { name: "talkAnimHandler", group: "T", ids: [37] },
  { name: "fighterAnimHandler", group: "F", ids: [38] },
  { name: "playerFightAnimHandler", group: "F", ids: [39] },
];

/** Fonction désignée par un numéro de gestionnaire. */
export function handlerInfo(id: number): HandlerInfo | undefined {
  return HANDLER_CATALOG.find((h) => h.ids.includes(id));
}
