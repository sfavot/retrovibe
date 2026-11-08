import { showPicture } from "../../../cinematics/player";
import { HALF_PAL } from "../../../render/palette";
import type { DrasculaEngine } from "../../loop";
import { freezeRoom } from "../../room-kit";
import { type Sequence } from "../../../../../engine/sequence";
import { pause } from "../../cadence";
import { Track, Verb } from "../../state";
import { Flag, Item, Office } from "./ids";
import { updateVisible } from "./screen";

/**
 * Pièce 49, le bureau du loup-garou. Réécriture de `room_49`, de `animation_5_5` (engines/drascula/rooms.cpp et animation.cpp, ScummVM)
 * et de l'arrivée dans la pièce (fin d'`enterRoom` : `playTalkSequence(4)` tant que le drapeau 7 est bas). Pas de `update_49` : les
 * mises à jour de la pièce sont dans `roomPreUpdates` de `drascula.dat` (le carreau de la fenêtre tant que le drapeau 6 est bas).
 *
 * Écarts à ScummVM :
 * - `animation_5_5` dessine sur l'écran (`copyRect` dans `screenSurface`, `updateScreen` d'un rectangle) : ici la pièce gelée est l'image
 *   libre de la cinématique (`freezeRoom`), les feuilles `3an5_*.alg` sont lues sans toucher à `back`, `front` et `extra` (ScummVM les
 *   y charge puis remet `99.ALG` et `97.ALG`) ;
 * - le balayage du bas de l'écran (`for h … copyBackground(0, 53, 0, h, 320, 19, front, screen)`) n'est montré qu'à la fin de la
 *   boucle (un seul `updateScreen`) : on calcule directement l'image finale, qui répète la rangée 53 de `96.ALG`.
 */

/** Origines des 9 images d'une feuille `3an5_1` ou `3an5_2` (97 x 64 pixels). */
const BONE_X = [1, 99, 197, 1, 99, 197, 1, 99, 197];
const BONE_Y = [1, 1, 1, 66, 66, 66, 131, 131, 131];
/** Abscisses des 5 images d'une feuille `3an5_3` ou `3an5_4` (61 x 109 pixels). */
const FLY_X = [1, 63, 125, 187, 249];

/** `room_49` : parler au loup-garou (menu 9) ; lui donner l'os (sur lui ou sur la fenêtre) lance la cinématique. */
export function* room49(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  if (g.picked === Verb.Talk && objectId === Office.Werewolf) {
    yield* g.dialogs.converse(9);
    return true;
  }
  if (g.picked === Item.Bone && (objectId === Office.Werewolf || objectId === Office.Window)) {
    yield* boneThrow(g);
    return true;
  }
  return false;
}

/** Arrivée dans le bureau (`enterRoom`) : la première fois (drapeau 7 bas), le scénario 4 du chapitre 5, qui lève le drapeau. */
export function* arrival(g: DrasculaEngine): Sequence {
  if (g.flags[Flag.WerewolfMet] === 0) yield* g.dialogs.play(4);
}

/**
 * `animation_5_5` : le héros lance l'os (neuf images de `3an5_1.alg`, une 26 x 24 de `draw3`, neuf de `3an5_2.alg`), le loup-garou part
 * (drapeau 6 : la fenêtre, la porte du fond), l'écran se vide, l'image 101 de la pièce montre la mouche qui l'emporte (cinq images de
 * `3an5_3.alg`, cinq de `3an5_4.alg`) et le son 1 clôt la scène.
 */
export function* boneThrow(g: DrasculaEngine): Sequence {
  const gfx = g.gfx;
  const s = g.state;
  const hero = s.hero;
  const canvas = gfx.canvas;
  const pixelX = hero.x - 53;
  const pixelY = hero.y - 9;

  g.selectVerb(Verb.None);
  g.removeObject(Item.Bone);
  yield* g.walkToPoint(hero.x - 19, hero.y + hero.height);
  hero.track = Track.Right;
  freezeRoom(g, { advance: true });

  // Seul le rectangle du héros est rafraîchi à chaque image : le reste de l'écran garde la pièce gelée.
  const throwing = (sheet: string): Sequence => throwFrames(g, sheet, pixelX, pixelY);
  yield* throwing("3an5_1.alg");
  canvas.copyBackground(gfx.draw3, 52, 161, 198, 81, 26, 24);
  yield* throwing("3an5_2.alg");

  s.flags[Flag.WerewolfGone] = 1;
  updateVisible(g);
  yield* pause(12);

  // L'écran se vide : la rangée 53 de 96.ALG, répétée vers le bas par des bandes de 19 lignes.
  const strip = gfx.sheet(96);
  for (let h = 0; h < 200 - 18; h++) canvas.copyBackground(strip, 0, 53, 0, h, 320, 19);

  showPicture(g, 101, "half");
  yield* pause(9);
  yield* flyFrames(g, "3an5_3.alg");
  yield* flyFrames(g, "3an5_4.alg");
  showPicture(g, 101, "half");

  g.playEffect(1);
  yield* g.finishSound();
  gfx.clearRoom();
  gfx.loadPic(g.room.number, gfx.bg, HALF_PAL);
  g.updateRoom();
}

/** Les neuf images du lancer : `copyBackground()` puis `copyRect` du sprite, dans le seul rectangle du héros. */
function* throwFrames(g: DrasculaEngine, sheetName: string, pixelX: number, pixelY: number): Sequence {
  const gfx = g.gfx;
  const sheet = gfx.sheet(sheetName);
  for (let frame = 0; frame < 9; frame++) {
    yield* pause(3);
    gfx.canvas.copyBackground(gfx.bg, pixelX, pixelY, pixelX, pixelY, 97, 64);
    gfx.canvas.copyRect(sheet, BONE_X[frame], BONE_Y[frame], pixelX, pixelY, 97, 64);
  }
}

/** Les cinq images de la mouche (61 x 109 à (174, 79)), copiées telles quelles (`copyBackground`). */
function* flyFrames(g: DrasculaEngine, sheetName: string): Sequence {
  const gfx = g.gfx;
  const sheet = gfx.sheet(sheetName);
  for (let frame = 0; frame < 5; frame++) {
    yield* pause(3);
    gfx.canvas.copyBackground(sheet, FLY_X[frame], 1, 174, 79, 61, 109);
  }
}
