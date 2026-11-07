import { HALF_PAL } from "../../../render/palette";
import type { RoomPainter } from "../../../render/renderer";
import { TextColor } from "../../../render/palette";
import { centerText } from "../../../render/font";
import type { DrasculaEngine } from "../../loop";
import { type Sequence, pause, skippable, wait } from "../../sequence";
import { Verb } from "../../state";
import { drawInn, advanceInn } from "../../inn-kit";
import { restoreHeroSheets, updateAnim } from "./anim-kit";
import { freezeRoom } from "../../room-kit";
import { Anim, Flag, Inn, Item } from "./ids";

/**
 * Pièce 14, l'auberge (départ du chapitre 2). Réécriture de `room_14`, `update_14_pre` (la même mise à jour que `update_62_pre` du
 * chapitre 1 : bougies, clignement, pianiste, ivrogne) et des cinématiques `animation_11_2` (le barman), `animation_36_2` (le barman
 * après le départ du pianiste), `animation_13_2` (l'ivrogne), `animation_12_2` (le pianiste), `animation_26_2` (le livre au pianiste)
 * et `animation_16_2` (l'histoire de Von Braun racontée par l'ivrogne : appelée par une réponse du menu `OP_2`)
 * (engines/drascula/rooms.cpp, animation.cpp, ScummVM).
 *
 * Écarts :
 * - **l'avance des animations** est séparée du dessin comme au chapitre 1 (`docs/drascula/rooms.md` § 4) : `tickInn` avance les
 *   bougies, le pianiste, l'ivrogne et le clignement toutes les 70 ms (`getTime() - savedTime > 6`), `innPainter` ne fait que dessiner.
 *   L'ivrogne qui parle attend la chute du drapeau 12 que seul `tickInn` baisse (`talk_drunk`) ;
 * - `animation_12_2` et `animation_26_2` : les deux images du pianiste qui se retourne sont dessinées par le painter (`anim.pianistTurn`),
 *   comme au chapitre 1 ;
 * - `animation_16_2` : l'histoire est une suite de cinq écrans (`his1.alg` à `his4_2.alg`) sur l'image libre ; n'importe quelle touche
 *   la saute dans ScummVM, ici Échap seul (`skippable`). Le défilement final attend 2 ticks par ligne (`delay(10)`). Le texte est
 *   `texthis`, la musique la piste 32 (30 en espagnol).
 */

/** Pause avant l'image suivante de l'histoire : 6 s réelles. */
const STORY_SCREEN_TICKS = 600;
/** Piste de musique de l'histoire. */
const STORY_TRACK = 32;
/** Piste de musique de l'auberge une fois le livre donné. */
const INN_TRACK_AFTER_BOOK = 16;
/** Écrans de l'histoire (`his1.alg`, `his2.alg`, `his3.alg`, `his4_2.alg`). */
const STORY_SCREENS = ["his1.alg", "his2.alg", "his3.alg", "his4_2.alg"] as const;

/** `room_14`. */
export function* room14(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  const verb = g.picked;
  const flags = g.flags;
  if (verb === Verb.Talk && objectId === Inn.Pianist && flags[Flag.BookGiven] === 0) yield* talkToPianist(g);
  else if (verb === Verb.Talk && objectId === Inn.Pianist) yield* g.talk(109);
  else if (verb === Item.Book && objectId === Inn.Pianist) yield* giveBook(g);
  else if (verb === Verb.Talk && objectId === Inn.Barman && flags[Flag.PianistGone] === 0) yield* talkToBarman(g);
  else if (verb === Verb.Talk && objectId === Inn.Barman) yield* barmanAfterPianist(g);
  else if (verb === Verb.Talk && objectId === Inn.Drunk) yield* talkToDrunk(g);
  else return false;
  return true;
}

/** Le pianiste se retourne : deux images de `an12.alg` (`anim.pianistTurn`), la musique s'arrête et le drapeau 11 monte. */
function* turnPianist(g: DrasculaEngine): Sequence {
  const s = g.state;
  s.anim[Anim.PianistTurn] = 1;
  yield* pause(3);
  s.anim[Anim.PianistTurn] = 2;
  yield* pause(3);
  g.host.stopMusic();
  s.flags[Flag.PianistTalking] = 1;
  s.anim[Anim.PianistTurn] = 0;
}

/** `animation_12_2` : le pianiste, puis le menu `OP_1`. */
export function* talkToPianist(g: DrasculaEngine): Sequence {
  const s = g.state;
  g.gfx.loadPic("an12.alg", g.gfx.extra);
  yield* g.talk(356);
  try {
    yield* turnPianist(g);
    yield* g.talkers.pianist(5);
    yield* g.dialogs.converse(1);
  } finally {
    s.anim[Anim.PianistTurn] = 0;
    s.flags[Flag.PianistTalking] = 0;
  }
  restoreHeroSheets(g, "extra");
}

/**
 * `animation_26_2` : le livre de partitions donné au pianiste. Il se retourne, parle, puis ses images (`an26.alg`) : il lit, joue un
 * air (le son 9) et rend les bouchons d'oreilles (objet 11). Le drapeau 39 monte et la musique de la pièce change (piste 16).
 */
export function* giveBook(g: DrasculaEngine): Sequence {
  const { gfx } = g;
  const s = g.state;
  gfx.loadPic("an12.alg", gfx.extra);
  yield* g.talk(392);
  try {
    yield* turnPianist(g);
    yield* g.talkers.pianist(5);
    yield* g.talk(393);
    yield* g.talkers.pianist(17);
    yield* g.talkers.pianist(18);
    yield* g.talkers.pianist(19);
    // L'image qui reste à l'écran est celle de la dernière réplique ; les images du pianiste viennent par-dessus.
    freezeRoom(g);
    gfx.loadPic("an26.alg", gfx.extra);
    yield* updateAnim(g, gfx.extra, 1, 225, 113, 50, 59, 6);
    let x = 0;
    for (let n = 0; n < 6; n++) {
      x++;
      gfx.canvas.copyBackground(gfx.extra, x, 61, 225, 113, 50, 59);
      x += 50;
      if (n === 2) g.playEffect(9);
      yield* pause(3);
    }
    g.stopSound();
    yield* updateAnim(g, gfx.extra, 121, 225, 113, 50, 59, 6);
    g.pickObject(Item.Earplugs);
    g.removeObject(Item.Book);
    s.flags[Flag.BookGiven] = 1;
    s.roomMusic = INN_TRACK_AFTER_BOOK;
  } finally {
    s.flags[Flag.PianistTalking] = 0;
  }
  restoreHeroSheets(g, "extra");
  g.updateRoom();
}

/** `animation_11_2` : le barman (scénario 11), sa feuille (`an11y13.alg`) dans `extra`. */
export function* talkToBarman(g: DrasculaEngine): Sequence {
  g.gfx.loadPic("an11y13.alg", g.gfx.extra);
  yield* g.dialogs.play(11);
  restoreHeroSheets(g, "extra");
}

/** `animation_36_2` : le barman parle du pianiste parti. */
export function* barmanAfterPianist(g: DrasculaEngine): Sequence {
  g.gfx.loadPic("an11y13.alg", g.gfx.extra);
  yield* g.talk(404);
  yield* g.talkers.bartender(19, 0);
  yield* g.talkers.bartender(20, 0);
  yield* g.talkers.bartender(21, 0);
  yield* g.talk(355);
  yield* pause(40);
  yield* g.talkers.bartender(82, 0);
  restoreHeroSheets(g, "extra");
}

/** `animation_13_2` : l'ivrogne, sa feuille (`an11y13.alg`) dans `front` ; le scénario 13 la première fois, puis le menu `OP_2`. */
export function* talkToDrunk(g: DrasculaEngine): Sequence {
  g.gfx.loadPic("an11y13.alg", g.gfx.front);
  if (g.flags[Flag.DrunkSpoke] === 0) yield* g.dialogs.play(13);
  else yield* g.dialogs.converse(2);
  restoreHeroSheets(g, "front");
}

/** Remet la pièce après l'histoire (`asco`) : feuille annexe, décor, fondu depuis le noir, musique. */
function* backToRoom(g: DrasculaEngine): Sequence {
  const { gfx } = g;
  const s = g.state;
  gfx.loadPic(g.room.disk, gfx.draw3);
  gfx.loadPic(g.room.number, gfx.bg, HALF_PAL);
  g.black();
  g.updateRoom();
  yield* g.fadeFromBlack(0);
  if (s.roomMusic !== 0) g.host.playMusic(s.roomMusic);
  else g.host.stopMusic();
}

/** `animation_16_2` : l'ivrogne raconte l'histoire de Von Braun (réponse 16 du menu `OP_2`). */
export function* drunkStory(g: DrasculaEngine): Sequence {
  const { gfx } = g;
  yield* g.talkers.drunk(12);
  yield* g.talk(371);
  gfx.clearRoom();
  g.host.playMusic(STORY_TRACK);
  yield* skippable(story(g));
  yield* backToRoom(g);
}

function* story(g: DrasculaEngine): Sequence {
  const { gfx } = g;
  gfx.palette.setTextColor(TextColor.DarkGreen);
  for (let i = 0; i < STORY_SCREENS.length; i++) {
    gfx.loadPic(STORY_SCREENS[i], gfx.canvas, HALF_PAL);
    centerText(gfx.font, gfx.canvas, gfx.table, g.data.text("texthis", i + 1), 180, 180);
    yield* wait(STORY_SCREEN_TICKS);
    if (i < STORY_SCREENS.length - 1) {
      yield* g.fadeToBlack(1);
      gfx.clearRoom();
    }
  }
  gfx.loadPic("his4_1.alg", gfx.bg, HALF_PAL);
  gfx.loadPic("his4_2.alg", gfx.draw3);
  for (let l = 1; l < 200; l++) {
    gfx.canvas.copyBackground(gfx.draw3, 0, 0, 0, l, 320, 200 - l);
    gfx.canvas.copyBackground(gfx.bg, 0, 200 - l, 0, 0, 320, l);
    yield* wait(2);
  }
  yield* pause(5);
  yield* g.fadeToBlack(2);
  gfx.clearRoom();
}

/** Partie « avance » de `update_14_pre` (`inn-kit.ts`). */
export const tickInn = (g: DrasculaEngine): void => advanceInn(g, 14);

/** `update_14_pre` (avant le héros) : bougies, clignement, pianiste, ivrogne. */
export const innPainter: RoomPainter = {
  pre: drawInn,
};
