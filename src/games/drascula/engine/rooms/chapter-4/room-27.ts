import type { DrasculaEngine } from "../../loop";
import { toggleDoor } from "../../room-kit";
import type { Sequence } from "../../../../../engine/sequence";
import { Verb } from "../../state";
import { Corridor, DoorIndex, Flag, Item } from "./ids";
import { LOCKED_DOOR_SPEECH } from "./room-21";

/** Réplique du héros devant l'aile ouest (`talk(460)`), quel que soit le verbe. */
const WEST_WING_SPEECH = 460;

/**
 * Pièce 27, le grand couloir. Réécriture de `room_27` (engines/drascula/rooms.cpp, ScummVM). Les rectangles des deux portes ouvertes
 * (drapeaux 5 et 6, `copyRect`) et ceux du premier plan sont des lignes de `roomPreUpdates` et `roomUpdates` de `drascula.dat` :
 * la pièce n'a pas de `update_27`.
 *
 * - la porte 110 (vers la pièce 28, drapeau 6) s'ouvre et se ferme ;
 * - la porte 116 (vers le salon, drapeau 5) est verrouillée (réplique 419) tant que la clé du salon (17) n'a pas servi ;
 * - l'aile ouest (150) est interdite, quel que soit le verbe.
 */
export function* room27(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  const flags = g.flags;
  const picked = g.picked;
  if (picked === Verb.Open && objectId === Corridor.DoorToCellar) {
    yield* toggleDoor(g, Flag.DoorCellar, DoorIndex.CorridorCellar, "open");
  } else if (picked === Verb.Close && objectId === Corridor.DoorToCellar) {
    yield* toggleDoor(g, Flag.DoorCellar, DoorIndex.CorridorCellar, "close");
  } else if (picked === Verb.Open && objectId === Corridor.DoorToLivingRoom && flags[Flag.LivingRoomUnlocked] === 0) {
    yield* g.talk(LOCKED_DOOR_SPEECH);
  } else if (picked === Verb.Open && objectId === Corridor.DoorToLivingRoom) {
    yield* toggleDoor(g, Flag.DoorLivingRoom, DoorIndex.CorridorLivingRoom, "open");
  } else if (picked === Item.LivingRoomKey && objectId === Corridor.DoorToLivingRoom) {
    flags[Flag.LivingRoomUnlocked] = 1;
    yield* toggleDoor(g, Flag.DoorLivingRoom, DoorIndex.CorridorLivingRoom, "open");
    g.selectVerb(Verb.None);
  } else if (objectId === Corridor.WestWing) {
    yield* g.talk(WEST_WING_SPEECH);
  } else {
    return false;
  }
  return true;
}
