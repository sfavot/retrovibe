import type { GroupScript } from "../assemble";
import { flodaAreas } from "./areas";
import { flodaMoves } from "./moves";

/**
 * Groupe 2 : Floda (`docs/fotaq/specials.md`, `specials-group-2.md`). Mouvements 19, 21 à 23 et 25 ; zones éteintes des pièces
 * 22, 26, 30, 32 et 103. Aucune pièce spéciale ni animation de pièce : les cas de cinématique (`c41f`) sont dans le moteur.
 */
export const group2: GroupScript = {
  specialMoves: flodaMoves,
  specialAreas: flodaAreas,
};
