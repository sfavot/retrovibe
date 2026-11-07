import type { RoomPainter } from "../../../render/renderer";
import type { DrasculaEngine } from "../../loop";
import { type Sequence, pause } from "../../sequence";
import { Verb } from "../../state";
import { checkIngredients, restoreHeroSheets, showBackground, updateAnim } from "./anim-kit";
import { freezeRoom, pose } from "../../room-kit";
import { Cemetery, Flag, Item } from "./ids";

/**
 * Pièce 3, le cimetière. Réécriture de `room_3`, `update_3` et `animation_7_2` (la faucille sur la plante : engines/drascula/rooms.cpp,
 * animation.cpp, ScummVM). Le rectangle du barreau (`roomPreUpdates`, drapeau 3) est dans `drascula.dat`.
 *
 * Écarts : le rattrapage de position de `runCurrentChapter` (la pièce 3 à (279, 101), `frame` de `index.ts`) est dans `index.ts` ;
 * la pose du héros qui prend le barreau (un rectangle de `pts.alg` à la place de son image) est composée à la main et figée le
 * temps du `pause(4)` (`freezeRoom`).
 */

/** `room_3`. */
export function* room03(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  const verb = g.picked;
  const flags = g.flags;
  if (verb === Verb.Talk && objectId === Cemetery.Tomb) {
    yield* g.talk(23);
    yield* pause(6);
    yield* g.talkers.heroSync(g.data.text("text", 50), "50.als", "11111111111144432554433");
  } else if (verb === Verb.Talk && objectId === Cemetery.Pantheon) {
    yield* g.talkers.heroSync(g.data.text("text", 322), "322.als", "13333334125433333333");
    g.updateRoom();
    yield* pause(25);
    yield* g.talk(33);
  } else if (verb === Verb.Look && objectId === Cemetery.Bars) {
    yield* g.talk(149);
    yield* g.talk(150);
  } else if (verb === Verb.Pick && objectId === Cemetery.Bars) {
    freezeRoom(g, { hero: pose(g, g.gfx.draw2, 44, 1, 0, 0, 41, 70) });
    yield* pause(4);
    g.pickObject(Item.Spike);
    flags[Flag.BarsTaken] = 1;
    const bars = g.room.objects.find((object) => object.id === Cemetery.Bars);
    if (bars) bars.visible = false;
    g.updateRoom();
  } else if (verb === Item.Sickle && objectId === Cemetery.Plant && flags[Flag.LeavesTaken] === 0) {
    yield* sickleOnPlant(g);
    g.pickObject(Item.Leaves);
  } else if (verb === Item.Sickle && objectId === Cemetery.Plant && flags[Flag.LeavesTaken] === 1) {
    yield* g.talk(323);
  } else if (verb === Verb.Talk && objectId === Cemetery.Critters) {
    yield* g.talk(185);
    yield* g.talk(186);
  } else {
    return false;
  }
  return true;
}

/** `update_3` (après le héros) : le premier plan (une partie du décor repeinte) quand le héros est en haut, et la tombe du bas. */
export const cemeteryPainter: RoomPainter = {
  post(r, s) {
    if (s.hero.y + s.hero.height < 118) r.screen.copyRect(r.draw3, 129, 110, 194, 36, 126, 88);
    r.screen.copyRect(r.draw3, 47, 57, 277, 143, 43, 50);
  },
};

/**
 * `animation_7_2` : le héros coupe la plante avec la faucille, en trois séries d'images de `an7_1.alg` à `an7_9.alg` jouées sur le
 * décor nu (le héros fait partie des images). Le drapeau 37 monte et les ingrédients sont recomptés.
 */
export function* sickleOnPlant(g: DrasculaEngine): Sequence {
  const { gfx } = g;
  gfx.loadPic("an7_1.alg", gfx.back);
  gfx.loadPic("an7_2.alg", gfx.extra);
  gfx.loadPic("an7_3.alg", gfx.front);
  // Le barreau déjà pris est peint dans le décor lui-même (`copyBackground(…, drawSurface3, bgSurface)`).
  if (g.flags[Flag.BarsTaken] === 1) gfx.bg.copyBackground(gfx.draw3, 258, 110, 85, 44, 23, 53);
  showBackground(g);
  const frames = (sheet: typeof gfx.back, y: number, count = 6) => updateAnim(g, sheet, y, 80, 64, 51, 73, count, 3, true);
  yield* frames(gfx.back, 1);
  yield* frames(gfx.back, 75);
  yield* frames(gfx.extra, 1);
  yield* frames(gfx.extra, 75);
  yield* frames(gfx.front, 1);

  gfx.loadPic("an7_4.alg", gfx.back);
  gfx.loadPic("an7_5.alg", gfx.extra);
  gfx.loadPic("an7_6.alg", gfx.front);
  gfx.loadPic("an7_7.alg", gfx.draw3);
  yield* frames(gfx.back, 1);
  yield* frames(gfx.back, 75);
  yield* frames(gfx.extra, 1);
  yield* frames(gfx.extra, 75);
  yield* frames(gfx.front, 1);
  yield* frames(gfx.extra, 75);
  yield* frames(gfx.front, 1);
  yield* frames(gfx.front, 75);
  yield* frames(gfx.draw3, 1);
  yield* frames(gfx.draw3, 75, 2);

  gfx.loadPic("an7_8.alg", gfx.back);
  gfx.loadPic("an7_9.alg", gfx.extra);
  yield* frames(gfx.back, 1);
  yield* frames(gfx.back, 75);
  yield* frames(gfx.extra, 1);
  gfx.canvas.copyBackground(gfx.bg, 80, 64, 80, 64, 51, 73);
  gfx.canvas.copyRect(gfx.extra, 1, 75, 80, 64, 51, 73);

  g.flags[Flag.LeavesTaken] = 1;
  checkIngredients(g);
  restoreHeroSheets(g);
  gfx.loadPic(g.room.disk, gfx.draw3);
  g.updateRoom();
}
