import type { GroupScript } from "../assemble";
import { endingMoves } from "./ending";
import { fightMoves, updateFight } from "./fight";
import { Room } from "./ids";

/**
 * Groupe 5 : la fin du jeu (`docs/fotaq/specials.md`, `specials-group-5.md`). Le combat final de la pièce 69 (`BamScene`, mouvements 9 à
 * 13 et animation de pièce), la fin de la partie (14), les mouvements 26 à 30 de `C69G` et l'éclair de `C75B` (28). Aucune pièce de ce
 * groupe n'a de cas dans `changeToSpecialRoom` ni dans `handleSpecialArea`.
 */
export const group5: GroupScript = {
  specialMoves: { ...fightMoves, ...endingMoves },
  roomUpdates: { [Room.FinalFight]: updateFight },
};
