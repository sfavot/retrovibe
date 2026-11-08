import type { RoomPainter } from "../../../render/renderer";
import type { DrasculaEngine } from "../../loop";
import { type Sequence } from "../../../../../engine/sequence";
import { pause } from "../../cadence";
import { Verb } from "../../state";
import { setLight } from "./anim-kit";
import { Church, Flag } from "./ids";

/**
 * Pièce 1, l'église. Réécriture de `room_1` et `update_1_pre` (engines/drascula/rooms.cpp, ScummVM). Les verbes sans gestionnaire
 * sont dans `roomActions` de `drascula.dat`.
 *
 * `update_1_pre` : la lumière de la pièce passe en « sombre » quand le héros est devant la porte (98 < x < 153) ; la fenêtre
 * de droite est bouchée tant que le drapeau 8 est bas (rectangle de `AUX1.ALG`). Rien n'avance : c'est du dessin pur.
 */

/** Intervalle d'abscisses du héros où la pièce est sombre (`curX > 98 && curX < 153`). */
const DARK_FROM = 98;
const DARK_TO = 153;

/** `room_1` : regarder la porte (118) et la fenêtre de droite (120) tant que la fenêtre de la chapelle est bloquée. */
export function* room01(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  if (g.picked !== Verb.Look) return false;
  if (objectId === Church.Door) {
    yield* g.talk(1);
    yield* pause(10);
    yield* g.talk(2);
    return true;
  }
  if (objectId === Church.WindowRight && g.flags[Flag.ChapelWindowOpen] === 0) {
    yield* g.talk(14);
    return true;
  }
  return false;
}

/** `update_1_pre`. */
export const churchPainter: RoomPainter = {
  pre(r, s) {
    setLight(r, s.hero.x > DARK_FROM && s.hero.x < DARK_TO ? "dark" : "bright");
    if (s.flags[Flag.ChapelWindowOpen] === 0) r.screen.copyBackground(r.draw3, 2, 158, 208, 67, 27, 40);
  },
};
