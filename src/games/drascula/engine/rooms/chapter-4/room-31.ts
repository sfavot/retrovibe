import type { DrasculaEngine } from "../../loop";
import { setVisible, toggleDoor } from "../../room-kit";
import type { Sequence } from "../../sequence";
import { Verb } from "../../state";
import { DoorIndex, Flag, Item, LivingRoom } from "./ids";

/**
 * Pièce 31, le salon. Réécriture de `room_31` (engines/drascula/rooms.cpp, ScummVM) : prendre la hache (145, objet 11) ; la porte 117
 * (drapeau 5) s'ouvre et se ferme. La hache prise laisse un rectangle (`roomPreUpdates`, drapeau 13), la porte ouverte un autre
 * (drapeau 5) ; la télévision a un rectangle de `roomUpdates`. Pas de `update_31`.
 */
export function* room31(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  const picked = g.picked;
  if (picked === Verb.Pick && objectId === LivingRoom.Axe) {
    g.pickObject(Item.Axe);
    setVisible(g, LivingRoom.Axe, false);
    g.flags[Flag.AxeTaken] = 1;
  } else if (picked === Verb.Open && objectId === LivingRoom.DoorToCorridor) {
    yield* toggleDoor(g, Flag.DoorLivingRoom, DoorIndex.LivingRoomToCorridor, "open");
  } else if (picked === Verb.Close && objectId === LivingRoom.DoorToCorridor) {
    yield* toggleDoor(g, Flag.DoorLivingRoom, DoorIndex.LivingRoomToCorridor, "close");
  } else {
    return false;
  }
  return true;
}
