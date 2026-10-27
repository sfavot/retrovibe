import { armaeth } from "./armaeth";
import { indy } from "./indy";
import { lostInTime } from "./lost-in-time";
import { mathemagique } from "./mathemagique";
import { swiv3d } from "./swiv3d";
import { teleportaschtroumpf } from "./teleportaschtroumpf";
import type { GameDefinition } from "./types";

/** Jeux disponibles, dans l'ordre d'affichage. Pour en ajouter un : créer `src/games/<id>/index.ts` exportant une `GameDefinition` et l'ajouter ici. */
export const games: readonly GameDefinition[] = [indy, lostInTime, teleportaschtroumpf, mathemagique, armaeth, swiv3d];

export function findGame(id: string): GameDefinition | undefined {
  return games.find((g) => g.id === id);
}
