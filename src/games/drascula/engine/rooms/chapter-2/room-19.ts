import type { DrasculaEngine } from "../../loop";
import { type Sequence, pause } from "../../sequence";
import { bareHiccup, showBackground, updateAnim } from "./anim-kit";
import { freezeRoom } from "../../room-kit";

/**
 * Pièce 19, le puits (pas de `room_19` ni de mise à jour). Réécriture de `animation_35_2` (engines/drascula/animation.cpp, ScummVM),
 * jouée par `exitRoom` quand le héros franchit le puits (porte 173, ouverte par la potion) : il avale la potion, s'évanouit dans le
 * puits (`an35_1.alg`, `an35_2.alg`, 46 x 80 en (70, 90)), le hoquet sur le décor nu, fondu au noir. Le chapitre 2 est fini.
 */

/** `animation_35_2`. */
export function* intoTheWell(g: DrasculaEngine): Sequence {
  const { gfx } = g;
  yield* g.walkToPoint(96, 165);
  yield* g.walkToPoint(79, 165);
  g.updateRoom();
  freezeRoom(g);
  gfx.loadPic("an35_1.alg", gfx.back);
  gfx.loadPic("an35_2.alg", gfx.front);
  const frames = (sheet: typeof gfx.back, y: number, count = 6) => updateAnim(g, sheet, y, 70, 90, 46, 80, count);
  yield* frames(gfx.back, 1);
  yield* frames(gfx.back, 82);
  yield* frames(gfx.front, 1);
  yield* frames(gfx.front, 82, 2);
  showBackground(g);
  yield* pause(19);
  g.playEffect(1);
  yield* bareHiccup(g, 18);
  yield* g.finishSound();
  yield* pause(10);
  yield* g.fadeToBlack(2);
}
