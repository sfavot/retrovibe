import { indy } from "./indy";
import type { GameDefinition } from "./types";

/** Jeux disponibles, dans l'ordre d'affichage. Pour en ajouter un : créer `src/games/<id>.ts` et l'ajouter ici. */
export const games: readonly GameDefinition[] = [indy];

export function findGame(id: string): GameDefinition | undefined {
  return games.find((g) => g.id === id);
}
