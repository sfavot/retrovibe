import type { RoomPainter } from "../../../render/renderer";
import type { DrasculaEngine } from "../../loop";
import type { Sequence } from "../../sequence";
import { Verb } from "../../state";
import { checkIngredients, setLight } from "./anim-kit";
import { Flag, Item, Village } from "./ids";

/**
 * Pièce 4, le village. Réécriture de `room_4` et `update_4` (engines/drascula/rooms.cpp, ScummVM) : pousser le tonneau donne le
 * chewing-gum (un des cinq ingrédients) ; la lumière passe en « sombre » à droite de l'écran (x > 190).
 */

/** Abscisse du héros au-delà de laquelle la pièce est sombre (`curX > 190`). */
const DARK_FROM = 190;

/** `room_4`. */
export function* room04(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  if (g.picked !== Verb.Move || objectId !== Village.Barrel || g.flags[Flag.GumTaken] !== 0) return false;
  yield* g.talk(327);
  g.pickObject(Item.BubbleGum);
  g.flags[Flag.GumTaken] = 1;
  checkIngredients(g);
  return true;
}

/** `update_4` (après le héros). */
export const villagePainter: RoomPainter = {
  post(r, s) {
    setLight(r, s.hero.x > DARK_FROM ? "dark" : "bright");
  },
};
