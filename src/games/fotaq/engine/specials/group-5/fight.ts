/**
 * Le combat final de la pièce 69 (groupe 5) : l'animation (`BamScene`, tables de `fight-data.ts`) et les mouvements 9 à 13 des
 * cinématiques `C69Z`, `C69E`, `C69F` et `C69G`. Réécriture de `Logic::asmStartFightAnimation`, `asmWaitForFrankPosition`,
 * `asmMakeFrankGrowing`, `asmMakeRobotGrowing` et `asmShrinkRobot` (engines/queen/logic.cpp, ScummVM, GPL v3 ou ultérieure), et de
 * l'appel de `BamScene::updateFightAnimation` par `Graphics::update` (graphics.cpp) pour la pièce 69.
 *
 * Écarts : seule la version DOS est portée (Frank et le robot grandissent par l'échelle du bob 5, pas par un défilement vertical comme
 * sur Amiga) ; `asmWaitForFrankPosition` s'arrête aussi si le jeu se termine (ScummVM n'a pas ce cas : `update` ne revient pas).
 */

import { type Sequence } from "../../../../../engine/sequence";
import type { FotaqEngine } from "../../loop";
import type { RoomUpdate } from "../kit";
import type { SpecialMove } from "../../script";
import { BamFlag } from "../bam";
import { bobOf, stageOf } from "../kit";
import { FIGHT_TABLES } from "./fight-data";
import { Bob, FIGHT_STARTED, FightObject, GROWER_FRAME, NO_MORE_IRONSTEIN, ROOM_BANK } from "./ids";

/** `Graphics::update`, pièce 69 : une ligne de la table du combat par image. */
export const updateFight: RoomUpdate = (g) => stageOf(g).bam.updateFight(g, FIGHT_TABLES);

/** 9 (`C69Z`, `C69E`, `C69F`, `C69G`) : le combat repart (les trois bobs sont remis à zéro, la table à sa première ligne). */
function* startFightAnimation(g: FotaqEngine): Sequence {
  const { bam } = stageOf(g);
  bam.flag = BamFlag.Play;
  bam.prepare(g);
  g.setGameState(FIGHT_STARTED, 1);
}

/** 10 : le combat s'arrête à la fin de son cycle (Frank est alors à sa place) ; les images passent en attendant. */
function* waitForFrankPosition(g: FotaqEngine): Sequence {
  const stage = stageOf(g);
  stage.bam.flag = BamFlag.RequestStop;
  while (stage.bam.flag !== (BamFlag.Stop as BamFlag) && !g.ended) yield* g.update();
}

/** Frank (11) ou le robot (12) apparaît : l'image 38 prend la première de la banque de la pièce, l'échelle monte de 10 à 98 % par 4, puis 21 images de pause. */
function* grow(g: FotaqEngine): Sequence {
  const { bobs } = stageOf(g);
  bobs.frames.unpack(1, GROWER_FRAME, ROOM_BANK);
  const bob = bobOf(g, Bob.Grower);
  bob.frameNum = GROWER_FRAME;
  bob.curPos(160, 200);
  for (let scale = 10; scale <= 100; scale += 4) {
    bob.scale = scale;
    yield* g.update();
  }
  for (let i = 0; i <= 20; i++) yield* g.update();
}

/** Allume (`on`) ou éteint le nom d'un objet de la pièce (`objectData(n)->name = ±ABS(name)`). */
function showObject(g: FotaqEngine, object: number, on: boolean): void {
  const data = g.state.objects[object];
  data.name = on ? Math.abs(data.name) : -Math.abs(data.name);
}

/** 11 (`C69Z`) : Frank grandit ; le pistolet et l'objet de Frank apparaissent, les gardes, Sparky et le reste de la scène précédente disparaissent. */
function* makeFrankGrowing(g: FotaqEngine): Sequence {
  yield* grow(g);
  showObject(g, FightObject.Dinoray, true);
  showObject(g, FightObject.Frank, true);
  showObject(g, FightObject.Tmpd, false);
  showObject(g, FightObject.FlodaGuards, false);
  showObject(g, FightObject.Sparky, false);
  g.setGameState(NO_MORE_IRONSTEIN, 1);
}

/** 12 (`C69Z`) : le robot grandit ; Azura et l'objet de Frank disparaissent. */
function* makeRobotGrowing(g: FotaqEngine): Sequence {
  yield* grow(g);
  showObject(g, FightObject.Azura, false);
  showObject(g, FightObject.Frank, false);
}

/** 13 (`C69G`, version DOS) : le robot (bob 6) rapetisse de 100 à 35 % par 5. */
function* shrinkRobot(g: FotaqEngine): Sequence {
  const robot = bobOf(g, Bob.Robot);
  for (let scale = 100; scale >= 35; scale -= 5) {
    robot.scale = scale;
    yield* g.update();
  }
}

export const fightMoves: Readonly<Record<number, SpecialMove>> = {
  9: startFightAnimation,
  10: waitForFrankPosition,
  11: makeFrankGrowing,
  12: makeRobotGrowing,
  13: shrinkRobot,
};
