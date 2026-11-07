import type { DrasculaEngine } from "../../loop";
import { toggleDoor } from "../../room-kit";
import type { Sequence } from "../../sequence";
import { Verb } from "../../state";
import { DoorIndex, Flag, Kitchen } from "./ids";

/**
 * Pièce 29, la cuisine. Réécriture de `room_29` (engines/drascula/rooms.cpp, ScummVM) : la porte 114 du garde-manger (drapeau 4)
 * s'ouvre et se ferme. Le four, le bouclier, la casserole, la corbeille et les tiroirs sont dans `roomActions` ; les rectangles de la
 * porte ouverte et du premier plan sont dans `roomPreUpdates` et `roomUpdates` de `drascula.dat`. Pas de `update_29`.
 */
export function* room29(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  const picked = g.picked;
  if (picked === Verb.Open && objectId === Kitchen.DoorToPantry) {
    yield* toggleDoor(g, Flag.DoorPantry, DoorIndex.KitchenToPantry, "open");
  } else if (picked === Verb.Close && objectId === Kitchen.DoorToPantry) {
    yield* toggleDoor(g, Flag.DoorPantry, DoorIndex.KitchenToPantry, "close");
  } else {
    return false;
  }
  return true;
}
