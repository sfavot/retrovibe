import { armaeth } from "./armaeth";
import { bass } from "./bass";
import { croisiere } from "./croisiere";
import { drascula } from "./drascula";
import { fotaq } from "./fotaq";
import { gk1 } from "./gk1";
import { indy } from "./indy";
import { lostInTime } from "./lost-in-time";
import { lure } from "./lure";
import { mathemagique } from "./mathemagique";
import { swiv3d } from "./swiv3d";
import { teleportaschtroumpf } from "./teleportaschtroumpf";
import { tim3 } from "./tim3";
import { zoombinis } from "./zoombinis";
import type { GameDefinition } from "./types";
import { voyageurs } from "./voyageurs";
import { ween } from "./ween";
import { yoda } from "./yoda";

/** Jeux disponibles, dans l'ordre d'affichage. Pour en ajouter un : créer `src/games/<id>/index.ts` exportant une `GameDefinition` et l'ajouter ici. */
export const games: readonly GameDefinition[] = [indy, yoda, lostInTime, ween, teleportaschtroumpf, mathemagique, armaeth, swiv3d, zoombinis, drascula, fotaq, lure, bass, croisiere, voyageurs, tim3, gk1];

export function findGame(id: string): GameDefinition | undefined {
  return games.find((g) => g.id === id);
}
