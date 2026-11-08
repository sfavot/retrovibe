import type { DrasculaEngine } from "../../loop";
import { toggleDoor } from "../../room-kit";
import type { Sequence } from "../../../../../engine/sequence";
import { Verb } from "../../state";
import { DoorIndex, Flag, Landing } from "./ids";

/**
 * Pièce 24, le palier. Réécriture de `room_24` (engines/drascula/rooms.cpp, ScummVM) : les deux portes, 105 (vers le hall, drapeau 1)
 * et 106 (vers la chambre d'Igor, drapeau 2), s'ouvrent et se ferment. Les portes ouvertes sont des rectangles de `roomPreUpdates`
 * (drapeaux 1 et 2) ; la pièce n'a pas de `update_24`. L'escalier (108) est franchi par `leaving` (`index.ts`).
 *
 * La perspective de la pièce se prolonge au-dessus de la zone de marche (`enterRoom` : `_roomNumber == 24`) : c'est dans
 * `perspective.ts`, pas ici.
 */
export function* room24(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  const picked = g.picked;
  if (picked === Verb.Open && objectId === Landing.DoorToHall) {
    yield* toggleDoor(g, Flag.DoorLanding, DoorIndex.LandingToHall, "open");
  } else if (picked === Verb.Close && objectId === Landing.DoorToHall) {
    yield* toggleDoor(g, Flag.DoorLanding, DoorIndex.LandingToHall, "close");
  } else if (picked === Verb.Open && objectId === Landing.DoorToBedroom) {
    yield* toggleDoor(g, Flag.DoorBedroom, DoorIndex.LandingToBedroom, "open");
  } else if (picked === Verb.Close && objectId === Landing.DoorToBedroom) {
    yield* toggleDoor(g, Flag.DoorBedroom, DoorIndex.LandingToBedroom, "close");
  } else {
    return false;
  }
  return true;
}
