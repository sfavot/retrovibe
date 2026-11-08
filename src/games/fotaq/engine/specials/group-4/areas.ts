/**
 * Zones éteintes de l'hôtel (`Logic::handleSpecialArea`, engines/queen/logic.cpp, ScummVM, GPL v3 ou ultérieure) : la pièce 71 (couloir,
 * `ROOM_HOTEL_DOWNSTAIRS`) fait dire à Joe qu'il ne veut pas descendre ; le hall (pièce 73, `ROOM_HOTEL_LOBBY`) fait intervenir les
 * hommes de Rico à la sortie, selon `GameVar.HotelEscapeState` : 0 `C73A` (Joe se retrouve en sous-vêtements), 1 `C73B`, 2 `C73C`,
 * puis plus rien.
 *
 * Écart : ScummVM joue ces cinématiques sans récupérer la suivante (`playCutaway` sans `nextCut`) ; ici elles ne rendent aucune suite
 * non plus (`""`).
 */

import type { Sequence } from "../../../../../engine/sequence";
import type { FotaqEngine } from "../../loop";
import { GameVar } from "../../state";
import type { SpecialAreaHandler } from "../assemble";
import { stageOf } from "../kit";
import { HOTEL_DOWNSTAIRS_SPEECH, HOTEL_ESCAPE_CUTAWAYS } from "./ids";

/** Pièce 71 : Joe refuse de passer. */
export const hotelDownstairsArea: SpecialAreaHandler = function* (g: FotaqEngine): Sequence<string> {
  yield* g.makeJoeSpeak(HOTEL_DOWNSTAIRS_SPEECH);
  return "";
};

/** Pièce 73 : les gardes du hall, une cinématique par état. */
export const hotelLobbyArea: SpecialAreaHandler = function* (g: FotaqEngine): Sequence<string> {
  const state = g.gameState(GameVar.HotelEscapeState);
  if (state < 0 || state >= HOTEL_ESCAPE_CUTAWAYS.length) return "";
  yield* g.playCutaway(HOTEL_ESCAPE_CUTAWAYS[state]);
  if (state === 0) {
    g.joeUseUnderwear();
    yield* stageOf(g).joeFace(g);
  }
  if (state < 2) g.setGameState(GameVar.HotelEscapeState, state + 1);
  return "";
};
