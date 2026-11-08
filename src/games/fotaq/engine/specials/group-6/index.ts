import type { GroupScript } from "../assemble";
import { introRoom, pinnacleRoom } from "./intro";
import { introMoves } from "./moves";
import { Room } from "./ids";

/**
 * Groupe 6 : introduction, générique et piton (`docs/fotaq/specials.md`, `specials-group-6.md`). Pièce 95 (`COPY`, `CLOGO`, `CDINT`,
 * `CRED`, hall de l'hôtel, `C70D`) et pièce 7 (choix de la destination) par `changeToSpecialRoom` ; mouvements 15 à 18, 34, 36 à 39.
 */
export const group6: GroupScript = {
  specialMoves: introMoves,
  specialRooms: { [Room.Logo]: introRoom, [Room.Pinnacle]: pinnacleRoom },
};
