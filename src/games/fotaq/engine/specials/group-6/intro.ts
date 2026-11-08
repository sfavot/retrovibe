/**
 * L'introduction et le piton (groupe 6) : `LogicGame::changeToSpecialRoom` pour les pièces 95 (logo : `COPY`, `CLOGO`, `CDINT`, `CRED`
 * puis le hall de l'hôtel et `C70D`) et 7 (sommet du piton : `Logic::handlePinnacleRoom`, la destination se choisit à la souris).
 * Réécriture de ces deux fonctions (engines/queen/logic.cpp, ScummVM, GPL v3 ou ultérieure).
 *
 * Écarts :
 * - `CINTR` (option `alt_intro` de ScummVM, jamais activée ici) n'est pas jouée : l'introduction du CD est `CDINT` ; ses mouvements
 *   spéciaux (17, 18) existent néanmoins (`moves.ts`) ;
 * - `inventoryRefresh` n'a pas d'équivalent : l'inventaire est redessiné à chaque image ;
 * - le piton : ScummVM garde un clic donné avant le survol d'un objet ; c'est repris à l'identique (`mouseButton` n'est lu qu'à la
 *   sortie), de même que l'objet visé reste celui du dernier survol quand la souris quitte les objets.
 */

import type { Sequence } from "../../../../../engine/sequence";
import { Ink } from "../../../render/display";
import type { FotaqEngine } from "../../loop";
import { RoomDisplay, Verb } from "../../state";
import { bobOf, putCameraOnBob, setScroll, stageOf } from "../kit";
import { HOTEL_CUTAWAY, HOTEL_ENTRY_OBJECT, INTRO_CUTAWAYS, INTRO_PLAYED, PINNACLE_JOE_BOB, PINNACLE_MOUNTAIN_BOB, PINNACLE_SONGS, PINNACLE_TEXT_Y, Room } from "./ids";

/** Pièce 95 : tant que l'introduction n'a pas été jouée, elle se joue ; rend vrai quand elle a pris l'affichage de la pièce en charge. */
export function* introRoom(g: FotaqEngine): Sequence<boolean> {
  if (g.gameState(INTRO_PLAYED) !== 0) return false;
  yield* g.displayRoom(g.state.room, RoomDisplay.FadeNoJoe, 100, 2, true);
  for (const file of INTRO_CUTAWAYS) {
    yield* g.playCutaway(file);
    if (g.ended) return true;
  }
  // Le panneau retrouve ses couleurs, la scène est remise à zéro, Joe entre dans le hall de l'hôtel.
  stageOf(g).display.palette.useBasePanel();
  g.scene = 0;
  g.state.room = Room.HotelLobby;
  g.state.entryObject = HOTEL_ENTRY_OBJECT;
  yield* g.displayRoom(g.state.room, RoomDisplay.FadeJoe, 100, 2, true);
  yield* g.playCutaway(HOTEL_CUTAWAY);
  g.setGameState(INTRO_PLAYED, 1);
  return true;
}

/** Pièce 7 : le sommet du piton, où la souris choisit la destination ; le changement de pièce demandé est celui de l'objet visé. */
export function* pinnacleRoom(g: FotaqEngine): Sequence<boolean> {
  const stage = stageOf(g);
  const { display } = stage;
  const { input, state } = g;
  // La caméra ne suit plus Joe.
  putCameraOnBob(g, -1);
  yield* g.displayRoom(Room.Pinnacle, RoomDisplay.NoFadeJoe, 100, 2, true);

  const joe = bobOf(g, PINNACLE_JOE_BOB);
  const mountain = bobOf(g, PINNACLE_MOUNTAIN_BOB);
  // Le défilement suit la souris dès la première image ; les deux bobs ne s'animent plus (ils viennent d'objets animés).
  const follow = (): void => {
    setScroll(g, input.mouseX);
    joe.x = mountain.x = Math.trunc((3 * input.mouseX) / 4) + 200;
    joe.frameNum = Math.trunc(input.mouseX / 36) + 45;
  };
  follow();
  joe.animating = mountain.animating = false;
  yield* g.update();
  yield* stage.fadeIn(g);

  state.entryObject = 0;
  let previous = 0;
  while (!g.ended && (input.mouseButton === 0 || state.entryObject === 0)) {
    yield* g.update();
    follow();
    display.clearTexts(PINNACLE_TEXT_Y, PINNACLE_TEXT_Y);
    const zone = g.grid.findObjectUnderCursor(input.mouseX, input.mouseY, g.horizontalScroll);
    if (zone !== 0 && zone !== previous) {
      state.entryObject = 0;
      const object = zone + g.currentRoomData;
      const data = state.objects[object];
      if (data.name > 0) {
        state.entryObject = data.entryObject;
        display.textCurrentColor(Ink.PinnacleRoom);
        display.setTextCentered(PINNACLE_TEXT_Y, `${g.verbName(Verb.WalkTo)} ${g.objectName(data.name)}`);
      }
      previous = object;
    }
  }
  input.takeMouseButton();
  if (g.ended) return true;

  state.newRoom = state.objects[state.entryObject].room;
  // Aucune de ces commandes ne change d'objet, de zone ou d'état : seul le morceau compte.
  const song = PINNACLE_SONGS[previous];
  if (song !== undefined) g.host.playSong(song);

  joe.active = mountain.active = false;
  display.clearTexts(PINNACLE_TEXT_Y, PINNACLE_TEXT_Y);
  putCameraOnBob(g, 0);
  yield* stage.fadeOut(g);
  return true;
}


