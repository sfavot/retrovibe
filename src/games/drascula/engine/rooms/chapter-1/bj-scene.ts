import { animate, clearScreen, showPicture } from "../../../cinematics/player";
import { HALF_PAL, TextColor } from "../../../render/palette";
import type { RoomPainter } from "../../../render/renderer";
import { hiccup } from "../../room-kit";
import type { DrasculaEngine } from "../../loop";
import { type Sequence, skippable } from "../../../../../engine/sequence";
import { pause } from "../../cadence";
import { Track } from "../../state";
import { Inn } from "./ids";

/**
 * `animation_2_1` (engines/drascula/animation.cpp, ScummVM) : la cinématique de la porte du fond de l'auberge, qui finit le chapitre 1.
 * Le héros entre, le barman le fait trinquer (`ag.bin`), le hoquet, puis le héros s'évanouit ; il rêve de B.J. (`bj.alg`), la retrouve
 * dans sa chambre (`lev.bin`, scénario 2), elle est enlevée par Drascula (`bes.bin`, `rap.bin`) et le héros reste seul.
 *
 * Réécriture en séquence. Échap saute toute la cinématique (`term_int` / `kActionSkip` : le chapitre finit quand même, c'est
 * `leaving` qui l'ordonne). Écarts :
 * - la chambre de B.J. est la « pièce 16 » de ScummVM (`_roomNumber = 16`, `factor_red` à 99) : on remplace la pièce chargée par une
 *   pièce de ce numéro, sans objets, au héros de taille fixe ; ses mises à jour (`roomPreUpdates`, `roomUpdates` de la pièce 16) sont vides ;
 * - B.J. debout dans sa chambre est `update_16_pre` du chapitre 1 (`bedroomPainter`, rangé sous la pièce 16 du chapitre 1) : elle reste
 *   dessinée par chaque `updateRoom` (marche et répliques du héros) jusqu'à `rap.bin` ;
 * - le « numéro de pièce inexistant » posé après `rap.bin` (pour que B.J. ne soit plus dessinée) est `gfx.roomSprites = false` ;
 * - le texte écrit par `talk_solo` ne reste pas à l'écran après la réplique (écart déjà documenté dans `cinematics/sequences.ts`).
 */

/** Taille de réduction du héros dans la chambre (`factor_red[l] = 99`). */
const BEDROOM_FACTOR = 99;
/** `update_16_pre`, chapitre 1 : B.J. debout (`copyRect(37, 99, 170, 90, 26, 76)` depuis `auxbj.alg`, couleur 255 transparente). */
export const bedroomPainter: RoomPainter = {
  pre(r) {
    r.screen.copyRect(r.draw3, 37, 99, 170, 90, 26, 76);
  },
};
/** Nombre de sursauts du hoquet. */
const HICCUPS = 18;

/** `animation_2_1`. */
export function* barmanAndBj(g: DrasculaEngine): Sequence {
  yield* g.walkToPoint(231, 91);
  g.state.hero.visible = false;
  yield* skippable(scene(g));
}

function* scene(g: DrasculaEngine): Sequence {
  const s = g.state;
  const hero = s.hero;
  const gfx = g.gfx;
  const text = (section: "text" | "textbj", index: number) => g.data.text(section, index);

  // Le barman ressert, le héros boit et a le hoquet.
  if (yield* animate(g, "ag.bin", 14)) return;
  gfx.loadPic("an11y13.alg", gfx.extra);
  yield* g.talkers.bartender(22, 0);
  gfx.loadPic(97, gfx.extra);
  yield* pause(4);
  g.playEffect(1);
  yield* hiccup(g, HICCUPS);
  yield* g.finishSound();

  // Le noir : la voix de B.J., puis son image.
  clearScreen(g);
  g.host.stopMusic();
  s.musicStopped = true;
  s.colorSolo = TextColor.White;
  yield* pause(80);
  yield* g.talkers.solo(text("textbj", 1), "BJ1.als");
  clearScreen(g);
  showPicture(g, "bj.alg", "half");
  g.black();
  yield* g.fadeFromBlack(1);
  s.colorSolo = TextColor.Yellow;
  yield* g.talkers.solo(text("text", 214), "214.als");
  clearScreen(g);

  // La chambre de B.J.
  gfx.loadPic(16, gfx.bg, HALF_PAL);
  gfx.loadPic("auxbj.alg", gfx.draw3);
  const inn = g.room;
  s.room = { ...inn, number: 16, objects: [], factors: new Array<number>(202).fill(BEDROOM_FACTOR) };
  hero.x = 91;
  hero.y = 95;
  hero.track = Track.Right;
  hero.visible = true;
  gfx.loadPic("97g.alg", gfx.extra);
  if (yield* animate(g, "lev.bin", 15)) return;
  yield* g.walkToPoint(100 + Math.trunc(hero.width / 2), 99 + hero.height);
  hero.track = Track.Right;
  hero.x = 100;
  hero.y = 95;
  yield* g.dialogs.play(2);
  if (yield* animate(g, "gaf.bin", 15)) return;
  if (yield* animate(g, "bjb.bin", 14)) return;
  g.host.playMusic(9);
  gfx.loadPic(97, gfx.extra);
  g.updateRoom();
  yield* pause(120);
  yield* g.talkers.solo(text("text", 223), "223.als");
  s.colorSolo = TextColor.White;
  g.updateRoom();
  yield* pause(110);
  yield* g.talkers.solo(text("textbj", 11), "BJ11.als");
  g.updateRoom();
  yield* pause(118);
  yield* g.walkToPoint(132, 97 + hero.height);
  yield* pause(60);
  yield* g.talk(224);
  yield* g.talkers.bj(12);
  yield* g.walkToPoint(157, 98 + hero.height);
  if (yield* animate(g, "bes.bin", 16)) return;
  g.host.playMusic(11);
  if (yield* animate(g, "rap.bin", 16)) return;

  // B.J. n'est plus là : le héros reste seul.
  hero.track = Track.Down;
  gfx.roomSprites = false;
  yield* pause(8);
  g.updateRoom();
  yield* g.talk(225);
  yield* pause(76);
  hero.track = Track.Right;
  g.updateRoom();
  yield* g.talk(226);
  g.updateRoom();
  yield* pause(30);
  yield* g.talk(227);
  yield* g.fadeToBlack(0);
}

/** Porte du fond de l'auberge ? (`objectNum[doorNumber] == 105`) */
export const isBackDoor = (g: DrasculaEngine, index: number): boolean => g.room.objects[index]?.id === Inn.Back;
