import type { DrasculaEngine } from "../../loop";
import type { Sequence } from "../../sequence";
import { Verb } from "../../state";
import { checkIngredients } from "./anim-kit";
import { Alley, Flag, Item } from "./ids";

/**
 * Pièce 8, l'impasse aux poubelles. Réécriture de `room_8` (engines/drascula/rooms.cpp, ScummVM) : fouiller la poubelle donne un
 * paquet de mouchoirs (un des cinq ingrédients), une fois.
 */

/** `room_8`. */
export function* room08(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  if (g.picked !== Verb.Look || objectId !== Alley.Bin) return false;
  if (g.flags[Flag.TissuesTaken] === 0) {
    yield* g.talk(58);
    g.pickObject(Item.Tissues);
    g.flags[Flag.TissuesTaken] = 1;
    checkIngredients(g);
  } else {
    yield* g.talk(59);
  }
  return true;
}
