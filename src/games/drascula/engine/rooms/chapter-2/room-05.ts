import type { DrasculaEngine } from "../../loop";
import { type Sequence, pause } from "../../sequence";
import { Track, Verb } from "../../state";
import { bareHiccup, restoreHeroSheets, showBackground, updateAnim } from "./anim-kit";
import { freezeRoom } from "../../room-kit";
import { ChapelWall, Flag, Item } from "./ids";

/**
 * Pièce 5, le mur de la chapelle. Réécriture de `room_5`, `animation_5_2` (le piton dans la fenêtre) et `animation_2_2` (le héros
 * qui passe par la fenêtre ouverte : appelée par `exitRoom` pour la porte 136, `leaving` de `index.ts`) (engines/drascula/rooms.cpp,
 * animation.cpp, ScummVM). Les rectangles de la fenêtre et du mur (`roomPreUpdates`, `roomUpdates`) sont dans `drascula.dat`.
 */

/** `room_5` : regarder la fenêtre tant qu'elle est bloquée ; le piton (10) sur la fenêtre. */
export function* room05(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  if (g.picked === Verb.Look && objectId === ChapelWall.Window && g.flags[Flag.ChapelWindowOpen] === 0) {
    yield* g.talk(14);
    return true;
  }
  if (g.picked === Item.Spike && objectId === ChapelWall.Window) {
    yield* spikeOnWindow(g);
    g.removeObject(Item.Spike);
    return true;
  }
  return false;
}

/**
 * `animation_5_2` : le héros force la fenêtre avec le piton (`an5_1.alg` à `an5_4.alg`, 52 x 84 en (213, 66)). Le drapeau 8 monte,
 * la fenêtre devient une porte (`doors`), le héros rit (`talk_sync`).
 */
export function* spikeOnWindow(g: DrasculaEngine): Sequence {
  const { gfx } = g;
  const hero = g.state.hero;
  hero.track = Track.Left;
  g.updateRoom();
  // L'image de la pièce est figée avant que les feuilles du héros ne soient remplacées par celles de la cinématique.
  freezeRoom(g);
  gfx.loadPic("an5_1.alg", gfx.back);
  gfx.loadPic("an5_2.alg", gfx.extra);
  gfx.loadPic("an5_3.alg", gfx.front);
  gfx.loadPic("an5_4.alg", gfx.draw3);
  gfx.canvas.copyBackground(gfx.back, 1, 1, 213, 66, 53, 84);
  const frames = (sheet: typeof gfx.back, y: number) => updateAnim(g, sheet, y, 213, 66, 52, 84, 6);
  yield* frames(gfx.back, 1);
  yield* frames(gfx.back, 86);
  yield* frames(gfx.extra, 1);
  yield* frames(gfx.extra, 1);
  yield* frames(gfx.extra, 86);
  yield* frames(gfx.front, 1);
  g.playEffect(1);
  yield* frames(gfx.front, 86);
  g.stopSound();
  yield* frames(gfx.draw3, 1);

  restoreHeroSheets(g);
  gfx.loadPic(g.room.disk, gfx.draw3);
  g.flags[Flag.ChapelWindowOpen] = 1;
  hero.x -= 4;
  g.updateRoom();
  yield* g.talkers.heroSync(g.data.text("text", 46), "46.als", "4442444244244");
  g.selectVerb(Verb.None);
}

/**
 * `animation_2_2` : le héros escalade la fenêtre (`an2_1.alg`, `an2_2.alg`, 50 x 52 en (201, 87)) et disparaît ; le hoquet sur le
 * décor nu. La pièce suivante (6) est chargée ensuite par `exitRoom`, qui recharge les feuilles du héros.
 */
export function* climbWindow(g: DrasculaEngine): Sequence {
  const { gfx } = g;
  g.state.hero.track = Track.Left;
  g.updateRoom();
  gfx.loadPic("an2_1.alg", gfx.front);
  gfx.loadPic("an2_2.alg", gfx.extra);
  showBackground(g);
  gfx.canvas.copyBackground(gfx.front, 1, 1, 201, 87, 50, 52);
  const frames = (sheet: typeof gfx.front, y: number, count = 6) => updateAnim(g, sheet, y, 201, 87, 50, 52, count);
  yield* frames(gfx.front, 1);
  yield* frames(gfx.front, 55);
  yield* frames(gfx.front, 109);
  g.playEffect(2);
  yield* frames(gfx.extra, 1);
  yield* frames(gfx.extra, 55);
  yield* frames(gfx.extra, 109, 2);
  showBackground(g);
  yield* g.finishSound();
  yield* pause(4);
  g.playEffect(1);
  yield* bareHiccup(g, 12);
  yield* g.finishSound();
}
