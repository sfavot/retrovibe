import type { RoomPainter } from "../../../render/renderer";
import { placeDrascula, placeIgor } from "../../../render/actors";
import type { DrasculaEngine } from "../../loop";
import { setDoor } from "../../room-kit";
import type { Sequence } from "../../../../../engine/sequence";
import { Verb } from "../../state";
import { Corridor, Flag } from "./ids";

/**
 * Pièce 58, le couloir où commence le chapitre 6 (Drascula y explique son plan, `animation_1_6`). Réécriture de `room_58`,
 * `update_58_pre` et `update_58` (engines/drascula/rooms.cpp, ScummVM) et de la partie de `updateVisible` qui concerne la porte
 * dérobée (objects.cpp). Regarder la porte (454) est dans `roomActions` de `drascula.dat`.
 *
 * Aucun écart notable : la pièce n'a pas d'animation propre (pas de `tick`), son dessin ne dépend que des drapeaux.
 */

/** `room_58` : pousser la torche (103) ouvre la porte dérobée (`updateVisible` : `isDoor[1] = 1`). Sans parole ni son. */
export function* room58(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  if (g.picked !== Verb.Move || objectId !== Corridor.Torch) return false;
  g.flags[Flag.TorchMoved] = 1;
  updateCorridorDoor(g);
  return true;
}

/** `updateVisible` pour la pièce 58 : la porte dérobée ne s'ouvre qu'une fois la torche poussée (drapeau 8). */
export function updateCorridorDoor(g: DrasculaEngine): void {
  setDoor(g, Corridor.SecretDoor, g.flags[Flag.TorchMoved] === 1);
}

/**
 * `update_58_pre` (avant le héros) et `update_58` (après). Les rectangles de `roomPreUpdates` (l'ombre au sol quand le héros est ligoté,
 * le héros ligoté vu de la pièce quand le drapeau 1 vaut 2) sont appliqués avant `pre` par le rendu.
 */
export const corridorPainter: RoomPainter = {
  pre(r, s) {
    const { screen, draw3 } = r;
    const { flags } = s;
    // Le héros ligoté, vu de loin, tant que le pendule n'est pas décroché.
    if (flags[Flag.Pendulum] === 0 && flags[Flag.Free] === 0) screen.copyRect(draw3, 278, 171, 173, 116, 25, 28);
    if (flags[Flag.CorridorEmpty] === 0) {
      placeIgor(r, s);
      placeDrascula(r, s);
    }
    // La chaîne du pendule, descendue par la manivelle (`animation_5_6`).
    if (flags[Flag.ChainLowered] === 1) screen.copyRect(draw3, 1, 29, 204, 0, 18, 125);
    // La porte dérobée ouverte.
    if (flags[Flag.TorchMoved] === 1) screen.copyBackground(draw3, 20, 60, 30, 64, 46, 95);
  },
  post(r, s) {
    if (s.hero.visible) r.screen.copyRect(r.draw3, 67, 139, 140, 147, 12, 16);
  },
};
