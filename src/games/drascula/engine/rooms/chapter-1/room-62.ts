import type { DrasculaEngine } from "../../loop";
import type { RoomPainter } from "../../../render/renderer";
import { type Sequence, pause } from "../../sequence";
import { Verb } from "../../state";
import { advanceInn, drawInn, InnAnim } from "../../inn-kit";
import { Flag, Inn } from "./ids";

/**
 * Pièce 62, l'auberge du chapitre 1. Réécriture de `room_62`, `update_62_pre` et `update_62` (engines/drascula/rooms.cpp, ScummVM),
 * de `animation_3_1` et `animation_4_1` (animation.cpp). Les verbes sans gestionnaire (regarder la tête de mort, l'affiche…) sont
 * dans `roomActions` de `drascula.dat`.
 *
 * Écarts à ScummVM :
 * - **l'avance des animations** (`update_62_pre` les avance en les dessinant, quand `getTime() - savedTime > 6`) est séparée du dessin :
 *   `tickInn` (accroche `tick`, à chaque tick de 10 ms) avance les bougies, le pianiste, l'ivrogne et le clignement ; `innPainter` ne
 *   fait que dessiner depuis `GameState.anim`. ScummVM n'avance qu'à chaque redessin de la pièce (toutes les 50 ms ou plus, jamais
 *   pendant un `pause` nu) : ici le rythme est de 70 ms, y compris pendant les répliques (l'ivrogne qui parle attend la fin de son
 *   geste, `talk_drunk`), à comparer au jeu d'origine ;
 * - `animation_4_1` : les deux images du pianiste qui se retourne sont dessinées par l'accroche (`anim.pianistTurn`), au lieu d'être
 *   copiées dans l'écran pour une zone.
 */

const Anim = InnAnim;

/** `room_62` : parler au barman, à l'ivrogne, au pianiste. */
export function* room62(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  if (g.picked !== Verb.Talk) return false;
  if (objectId === Inn.Drunk) {
    yield* g.dialogs.converse(13);
  } else if (objectId === Inn.Barman && g.flags[Flag.BarmanSpoke] === 0) {
    yield* barmanDialog(g);
  } else if (objectId === Inn.Barman) {
    yield* g.talk(109);
  } else if (objectId === Inn.Pianist) {
    yield* pianistDialog(g);
  } else {
    return false;
  }
  return true;
}

/** `animation_3_1` : le barman, sa feuille (`an11y13.alg`) dans `extra` le temps du scénario 3, qui lève le drapeau 0. */
export function* barmanDialog(g: DrasculaEngine): Sequence {
  g.gfx.loadPic("an11y13.alg", g.gfx.extra);
  yield* g.dialogs.play(3);
  g.gfx.loadPic(97, g.gfx.extra);
}

/**
 * `animation_4_1` : le pianiste se retourne (deux images de `an12.alg`), la musique s'arrête et il échange quatre répliques avec le
 * héros ; sa pose est celle du drapeau 11 (`innPainter`).
 */
export function* pianistDialog(g: DrasculaEngine): Sequence {
  const s = g.state;
  g.gfx.loadPic("an12.alg", g.gfx.extra);
  yield* g.talk(205);
  try {
    s.anim[Anim.PianistTurn] = 1;
    yield* pause(3);
    s.anim[Anim.PianistTurn] = 2;
    yield* pause(3);
    g.host.stopMusic();
    s.flags[Flag.PianistTalking] = 1;
    s.anim[Anim.PianistTurn] = 0;
    yield* g.talkers.pianist(1);
    yield* g.talk(206);
    yield* g.talkers.pianist(2);
    yield* g.talk(207);
    yield* g.talkers.pianist(3);
    yield* g.talk(208);
    yield* g.talkers.pianist(4);
    yield* g.talk(209);
    s.flags[Flag.PianistTalking] = 0;
  } finally {
    s.anim[Anim.PianistTurn] = 0;
  }
  g.gfx.loadPic(97, g.gfx.extra);
}

/** Partie « avance » de `update_62_pre` (`inn-kit.ts`). */
export const tickInn = (g: DrasculaEngine): void => advanceInn(g, 62);

/** `update_62_pre` (avant le héros) et `update_62` (après) : bougies, clignement, pianiste, ivrogne, et le premier plan (`2aux62.alg`). */
export const innPainter: RoomPainter = {
  pre: drawInn,
  post(r, s) {
    const { screen, draw2, draw3, dat } = r;
    screen.copyRect(draw2, 1, 1, 0, 0, 62, 142);
    if (s.hero.y + s.hero.height < 89) {
      screen.copyRect(draw3, 205, 1, 180, 9, 82, 80);
      screen.copyBackground(draw3, dat.drunkX[s.anim[Anim.Drunk] ?? 0], 82, 170, 50, 40, 53);
    }
  },
};
