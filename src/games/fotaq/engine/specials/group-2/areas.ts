/**
 * Zones éteintes de Floda (groupe 2) : ce que `Logic::handleSpecialArea` (engines/queen/logic.cpp, ScummVM, GPL v3 ou ultérieure)
 * fait dans les pièces 22, 26, 30, 32 et 103. Le moteur (`FotaqEngine.handleSpecialArea`) a déjà tourné Joe, annulé la pièce
 * demandée et enchaînera les cinématiques que ces fonctions rendent (la boucle `while (nextCut est une .CUT)` de ScummVM).
 *
 * Écarts : à la réception, l'état 35 est posé avant la cinématique `C103B` (ScummVM le pose après) ; elle ne le lit pas. La zone 3
 * seule réagit.
 */

import type { Sequence } from "../../../../../engine/sequence";
import type { FotaqEngine } from "../../loop";
import type { SpecialAreaHandler } from "../assemble";
import { BYPASS_FLODA_RECEPTIONIST, RECEPTIONIST_AREA } from "./ids";

/** Une zone éteinte qui lance toujours la même cinématique. */
const always =
  (cutaway: string): SpecialAreaHandler =>
  function* () {
    return cutaway;
  };

/** Réception : la secrétaire arrête Joe (`C103B`, une fois), puis le rappelle à l'ordre (`C103E`). */
function* receptionistArea(g: FotaqEngine, _facing: unknown, area: number): Sequence<string> {
  if (area !== RECEPTIONIST_AREA) return "";
  switch (g.gameState(BYPASS_FLODA_RECEPTIONIST)) {
    case 0:
      g.setGameState(BYPASS_FLODA_RECEPTIONIST, 1);
      return "C103B.CUT";
    case 1:
      return "C103E.CUT";
    default:
      return "";
  }
}

export const flodaAreas: Readonly<Record<number, SpecialAreaHandler>> = {
  22: always("C22A.CUT"),
  26: always("C26B.CUT"),
  30: always("C30A.CUT"),
  32: always("C32C.CUT"),
  103: receptionistArea,
};
