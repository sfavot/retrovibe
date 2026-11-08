/**
 * Mouvements spéciaux de l'introduction (groupe 6) : 15 et 16 (caméra sur le dinosaure, sur Joe), 17 et 18 (panoramiques de `CINTR`,
 * l'introduction alternative), 34 (le titre de `CRED`), 36 à 39 (`CDINT` : vers Hugh, éclair blanc, vers Joe et Rita, vers la
 * bombe). Réécriture de `Logic::asmPutCameraOnDino`, `asmPutCameraOnJoe`, `asmAltIntroPanRight`, `asmAltIntroPanLeft`,
 * `asmScaleTitle` (version DOS ; `asmScrollTitle` est celle des autres versions), `asmPanRightToHugh`, `asmMakeWhiteFlash`,
 * `asmPanRightToJoeAndRita` et `asmPanLeftToBomb` (engines/queen/logic.cpp, ScummVM, GPL v3 ou ultérieure).
 *
 * Écarts : le mode rapide (`Input::fastMode`) est celui de `cadence.ts` (une image toutes les 10 ms de ScummVM, dix par tick) ; l'éclair
 * blanc de 37 dure une image de jeu (`kit.flash`).
 */

import { type Sequence } from "../../../../../engine/sequence";
import type { SpecialMove } from "../../script";
import type { FotaqEngine } from "../../loop";
import { bobOf, fastMode, flash, panTo, putCameraOnBob } from "../kit";
import { TITLE_BOB } from "./ids";

/** 15 : la caméra quitte Joe, le décor défile jusqu'à 320 (le dinosaure) puis suit le bob 1. */
function* putCameraOnDino(g: FotaqEngine): Sequence {
  putCameraOnBob(g, -1);
  yield* panTo(g, 320, 16);
  putCameraOnBob(g, 1);
}

/** 16 : la caméra suit Joe. */
function* putCameraOnJoe(g: FotaqEngine): Sequence {
  putCameraOnBob(g, 0);
}

/** 17 (`CINTR`) : panoramique vers la droite jusqu'à 285, en mode rapide. */
function* altIntroPanRight(g: FotaqEngine): Sequence {
  putCameraOnBob(g, -1);
  fastMode(g, true);
  yield* g.update();
  yield* panTo(g, 285, 1, { quit: true });
  fastMode(g, false);
}

/** 18 (`CINTR`) : panoramique vers la gauche jusqu'à 0, en mode rapide. */
function* altIntroPanLeft(g: FotaqEngine): Sequence {
  putCameraOnBob(g, -1);
  fastMode(g, true);
  yield* panTo(g, 0, -4, { quit: true });
  fastMode(g, false);
}

/** 34 (`CRED`, version DOS) : le titre monte du bas de l'écran en grossissant (échelle de 5 à 100 %, quatre lignes par image). */
function* scaleTitle(g: FotaqEngine): Sequence {
  const bob = bobOf(g, TITLE_BOB);
  bob.animating = false;
  bob.x = 161;
  bob.y = 200;
  bob.scale = 100;
  for (let scale = 5; scale <= 100; scale += 5) {
    bob.scale = scale;
    bob.y -= 4;
    yield* g.update();
  }
}

/** 36 (`CDINT`) : panoramique vers la droite jusqu'à 160, les gardes, Hugh et les autres glissent à des vitesses différentes. */
function* panRightToHugh(g: FotaqEngine): Sequence {
  const thugA = [bobOf(g, 20), bobOf(g, 21), bobOf(g, 22)];
  const hugh = [bobOf(g, 1), bobOf(g, 23), bobOf(g, 24)];
  const thugB = [bobOf(g, 25), bobOf(g, 26)];
  putCameraOnBob(g, -1);
  fastMode(g, true);
  yield* g.update();
  // Le fusil du premier garde est décalé pour rejoindre le reste de son corps.
  thugA[0].x += 160 - 45;
  thugA[1].x += 160;
  thugA[2].x += 160;
  for (const bob of hugh) bob.x += 160 * 2;
  for (const bob of thugB) bob.x += 160 * 3;
  yield* panTo(g, 160, 8, {
    quit: true,
    from: 0,
    each: () => {
      for (const bob of thugA) bob.x -= 16;
      for (const bob of hugh) bob.x -= 24;
      for (const bob of thugB) bob.x -= 32;
    },
  });
  fastMode(g, false);
}

/** 37 (`CDINT`) : éclair blanc. */
function* makeWhiteFlash(g: FotaqEngine): Sequence {
  yield* flash(g);
}

/** 38 (`CDINT`) : panoramique vers Joe et Rita, jusqu'à 290, un pixel par image. */
function* panRightToJoeAndRita(g: FotaqEngine): Sequence {
  const box = bobOf(g, 20);
  const beam = bobOf(g, 21);
  const crate = bobOf(g, 22);
  const clock = bobOf(g, 23);
  const hands = bobOf(g, 24);
  putCameraOnBob(g, -1);
  fastMode(g, true);
  yield* g.update();
  box.x += 280 * 2;
  beam.x += 30;
  crate.x += 180 * 3;
  yield* panTo(g, 290, 1, {
    quit: true,
    each: () => {
      box.x -= 2;
      beam.x -= 1;
      crate.x -= 3;
      clock.x -= 2;
      hands.x -= 2;
    },
  });
  fastMode(g, false);
}

/** 39 (`CDINT`) : panoramique vers la gauche jusqu'à la bombe (le décor recule de cinq pixels, les deux bobs avancent). */
function* panLeftToBomb(g: FotaqEngine): Sequence {
  const bob21 = bobOf(g, 21);
  const bob22 = bobOf(g, 22);
  putCameraOnBob(g, -1);
  fastMode(g, true);
  let scroll = g.horizontalScroll;
  while ((scroll > 0 || bob21.x < 136) && !g.input.cutawayQuit) {
    scroll = Math.max(0, scroll - 5);
    g.horizontalScroll = scroll;
    if (scroll < 272 && bob21.x < 136) bob21.x += 2;
    bob22.x += 5;
    yield* g.update();
  }
  fastMode(g, false);
}

export const introMoves: Readonly<Record<number, SpecialMove>> = {
  15: putCameraOnDino,
  16: putCameraOnJoe,
  17: altIntroPanRight,
  18: altIntroPanLeft,
  34: scaleTitle,
  36: panRightToHugh,
  37: makeWhiteFlash,
  38: panRightToJoeAndRita,
  39: panLeftToBomb,
};
