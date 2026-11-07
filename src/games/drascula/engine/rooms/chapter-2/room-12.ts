import type { DrasculaEngine } from "../../loop";
import type { Sequence } from "../../sequence";
import { toggleDoor } from "../../room-kit";
import { Verb } from "../../state";
import { Flag, Street } from "./ids";

/**
 * Pièce 12, la rue devant l'auberge. Réécriture de `room_12` (engines/drascula/rooms.cpp, ScummVM) : ouvrir et fermer la porte 156
 * (index 4 dans la pièce). Son rectangle (`roomPreUpdates`, drapeau 16) est dans `drascula.dat`.
 */

/** Index de la porte 156 dans la pièce (`doorNum`). */
const DOOR_INDEX = 4;

/** `room_12`. */
export function* room12(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  if (objectId !== Street.Door) return false;
  if (g.picked === Verb.Open) yield* toggleDoor(g, Flag.InnDoorOpen, DOOR_INDEX, "open");
  else if (g.picked === Verb.Close) yield* toggleDoor(g, Flag.InnDoorOpen, DOOR_INDEX, "close");
  else return false;
  return true;
}
