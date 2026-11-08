/**
 * La fin du jeu et les mouvements de `C69G` et de `C75B` du groupe 5 : 14 (fin de la partie), 26 (panoramique), 27 (baiser), 28 (l'éclair
 * touche l'avion), 29 (le dirigeable grossit), 30 (l'écran de fin grossit, fondu au noir). Réécriture de `Logic::asmEndGame`,
 * `asmPanLeft320To144`, `asmSmooch` (version DOS), `asmMakeLightningHitPlane`, `asmScaleBlimp` et `asmScaleEnding` (engines/queen/logic.cpp,
 * ScummVM, GPL v3 ou ultérieure).
 *
 * Écarts : seule la version DOS est portée (`asmSmoochNoScroll`, `asmScaleBlimp` et `asmScaleEnding` ont des variantes Amiga, sans mise
 * à l'échelle) ; `asmEndGame` appelle `g.endGame()` (l'hôte quitte) au lieu de `quitGame()` ; `asmScaleBlimp` s'arrête aussi quand le jeu
 * se termine (`shouldQuit`). Le mouvement 32 (la secousse de `C75B`) est du groupe 4.
 */

import { type Sequence } from "../../../../../engine/sequence";
import type { SpecialMove } from "../../script";
import type { FotaqEngine } from "../../loop";
import { bobOf, frames, panTo, putCameraOnBob, setScroll, stageOf } from "../kit";
import { Bob, ROOM_BANK } from "./ids";

/** Largeur du défilement (le décor fait 640 pixels). */
const MAX_SCROLL = 320;

/** 14 (`C69G`) : quarante images, puis la partie est finie. */
function* endGame(g: FotaqEngine): Sequence {
  yield* frames(g, 40);
  g.endGame();
}

/** 26 (`C69G`) : panoramique vers la gauche de 320 à 144 par pas de 8, la caméra libre. */
function* panLeft320To144(g: FotaqEngine): Sequence {
  putCameraOnBob(g, -1);
  // ScummVM ne fait rien si le défilement est déjà en dessous de 144 (`panTo` irait y sauter).
  if (g.horizontalScroll > 144) yield* panTo(g, 144, -8);
}

/** 27 (`C69G`, DOS) : Azura (bob 5) et Joe (bob 6) avancent ensemble, le décor défile vers 320 par pas de 8 ; ils se rapprochent si l'écart dépasse 128. */
function* smooch(g: FotaqEngine): Sequence {
  putCameraOnBob(g, -1);
  const azura = bobOf(g, Bob.Azura);
  const joe = bobOf(g, Bob.Joe);
  let scroll = g.horizontalScroll;
  while (scroll < MAX_SCROLL) {
    scroll += 8;
    setScroll(g, scroll);
    if (joe.x - azura.x > 128) {
      azura.x += 10;
      joe.x += 6;
    } else {
      azura.x += 8;
      joe.x += 8;
    }
    yield* g.update();
  }
}

/**
 * 28 (`C75B`, DOS) : l'avion (bob 5) traverse l'écran de droite à gauche en tanguant et en grossissant, l'éclair (bob 20) le frappe, puis il
 * plonge dans la jungle derrière le décor, en flammes (bob 6).
 */
function* makeLightningHitPlane(g: FotaqEngine): Sequence {
  putCameraOnBob(g, -1);
  const stage = stageOf(g);
  const plane = bobOf(g, Bob.Plane);
  const lightning = bobOf(g, Bob.Lightning);
  const fire = bobOf(g, Bob.Fire);
  const { frames: table } = stage.bobs;

  plane.y = 135;
  plane.scale = 20;
  let wobble = 0;
  let wobbleDir = -1;
  for (let x = 660; x > 163; x -= 6) {
    plane.x = x;
    plane.y = 135 + wobble;
    wobble -= wobbleDir;
    if (wobble < -9 || wobble > 9) wobbleDir = -wobbleDir;
    plane.scale = Math.min(plane.scale + 1, 100);
    setScroll(g, Math.min(x - 163, MAX_SCROLL));
    yield* g.update();
  }

  plane.scale = 100;
  setScroll(g, 0);
  plane.x += 8;
  plane.y += 6;
  lightning.x = 160;
  lightning.y = 0;
  stage.playRoomSfx();
  table.unpack(18, lightning.frameNum, ROOM_BANK);
  table.unpack(4, plane.frameNum, ROOM_BANK);

  // L'avion plonge dans la jungle.
  fire.animating = true;
  fire.x = plane.x;
  fire.y = plane.y + 10;
  table.unpack(19, fire.frameNum, ROOM_BANK);
  yield* g.update();

  let fireFrame = 20;
  let planeFrame = 1;
  for (let x = 163; x > -30; x -= 10) {
    plane.y += 4;
    fire.y += 4;
    plane.x = fire.x = x;
    if (fireFrame < 40) {
      table.unpack(planeFrame, plane.frameNum, ROOM_BANK);
      table.unpack(fireFrame, fire.frameNum, ROOM_BANK);
      fireFrame++;
      planeFrame++;
      if (planeFrame === 4) planeFrame = 1;
    }
    yield* g.update();
  }
  putCameraOnBob(g, 0);
}

/** 29 (`C69G`) : le dirigeable (bob 7) s'éloigne vers le centre en rapetissant (profondeur `z` de 256 vers l'infini), jusqu'à l'abscisse 150. */
function* scaleBlimp(g: FotaqEngine): Sequence {
  const blimp = bobOf(g, Bob.Blimp);
  // `z` et `x` sont des `int16` en C++.
  let z = 256;
  let x = blimp.x;
  const y = blimp.y;
  blimp.scale = 100;
  while (blimp.x > 150 && !g.ended) {
    blimp.x = Math.trunc((x * 256) / z) + 150;
    blimp.y = Math.trunc((y * 256) / z) + 112;
    blimp.scale = Math.trunc((100 * 256) / z);
    z++;
    if (z % 6 === 0) x--;
    yield* g.update();
  }
}

/** 30 (`C69G`, DOS) : le dirigeable s'éteint, l'écran de fin (bob 20) grossit de 5 à 100 % au centre, cinquante images de pause, fondu au noir. */
function* scaleEnding(g: FotaqEngine): Sequence {
  const stage = stageOf(g);
  bobOf(g, Bob.Blimp).active = false;
  const ending = bobOf(g, Bob.Ending);
  ending.curPos(160, 100);
  for (let scale = 5; scale <= 100; scale += 5) {
    ending.scale = scale;
    yield* g.update();
  }
  yield* frames(g, 50);
  yield* stage.fadeOut(g);
}

export const endingMoves: Readonly<Record<number, SpecialMove>> = {
  14: endGame,
  26: panLeft320To144,
  27: smooch,
  28: makeLightningHitPlane,
  29: scaleBlimp,
  30: scaleEnding,
};
