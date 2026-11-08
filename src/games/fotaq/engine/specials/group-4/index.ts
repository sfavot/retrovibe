import type { GroupScript } from "../assemble";
import { stageOf } from "../kit";
import { hotelDownstairsArea, hotelLobbyArea } from "./areas";
import { CAR_DATA } from "./car-data";
import { Room } from "./ids";
import { hotelMoves } from "./moves";

/**
 * Groupe 4 : vallée, hôtel et course de voiture (`docs/fotaq/specials.md`, `specials-group-4.md`). Mouvements 2 à 8, 31 et 32 ; zones
 * éteintes des pièces 71 et 73 ; la course de voiture de la pièce 74 (`BamScene`, table `car-data.ts`). Les pièces 64 à 68, 70, 72 et
 * 76 n'ont pas de logique codée en dur : elles suivent les données.
 */
export const group4: GroupScript = {
  specialMoves: hotelMoves,
  specialAreas: { [Room.HotelDownstairs]: hotelDownstairsArea, [Room.HotelLobby]: hotelLobbyArea },
  roomUpdates: { [Room.CarChase]: (g) => stageOf(g).bam.updateCar(g, CAR_DATA) },
};
