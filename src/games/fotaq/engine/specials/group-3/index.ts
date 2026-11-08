import type { GroupScript } from "../assemble";
import { templeAreas } from "./areas";
import { templeMoves } from "./moves";

/**
 * Groupe 3 : temple et labyrinthe (`docs/fotaq/specials.md`, `specials-group-3.md`). Mouvements 20, 24 et 33 ; zones éteintes des
 * pièces 50, 53, 55, 100 et 101. Aucune pièce spéciale ni animation de pièce (la parallaxe et le bateau de la pièce 43 sont dans le
 * moteur).
 */
export const group3: GroupScript = {
  specialMoves: templeMoves,
  specialAreas: templeAreas,
};
