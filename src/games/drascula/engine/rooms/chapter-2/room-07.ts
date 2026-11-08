import type { DrasculaEngine } from "../../loop";
import { type Sequence } from "../../../../../engine/sequence";
import { setVisible } from "../../room-kit";
import { Verb } from "../../state";
import { checkIngredients } from "./anim-kit";
import { Chapel, Flag, Item } from "./ids";

/**
 * Pièce 7, la chapelle. Réécriture de `room_7` (engines/drascula/rooms.cpp, ScummVM) : prendre la bougie, un des cinq ingrédients.
 * Le rectangle de la bougie (`roomPreUpdates`, drapeau 35) est dans `drascula.dat`.
 */

/** `room_7`. */
export function* room07(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  if (g.picked !== Verb.Pick || objectId !== Chapel.Candle) return false;
  g.pickObject(Item.Candle);
  g.flags[Flag.CandleTaken] = 1;
  setVisible(g, Chapel.Candle, false);
  checkIngredients(g);
  return true;
}
