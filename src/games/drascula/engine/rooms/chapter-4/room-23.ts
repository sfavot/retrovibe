import type { RoomPainter } from "../../../render/renderer";
import type { DrasculaEngine } from "../../loop";
import { setVisible, toggleDoor } from "../../room-kit";
import type { Sequence } from "../../sequence";
import { Verb } from "../../state";
import { afterDisguisePart } from "./disguise";
import { DoorIndex, Flag, Hall, Item } from "./ids";
import { updateVisible } from "./world";

/**
 * Pièce 23, le hall d'entrée. Réécriture de `room_23` et `update_23_pre` (engines/drascula/rooms.cpp, ScummVM).
 *
 * - la porte 103 (vers la pièce 21, drapeau 0) et la porte 104 (vers le palier, drapeau 1) s'ouvrent et se ferment ; la porte 103
 *   ouverte cache l'objet 142 (les frites), qui apparaît quand on la referme (`updateVisible`) ;
 * - prendre les frites (142) : objet 8 ; si la farine et la cape sont déjà prises, Igor est parti (drapeau 18) et sa chambre est
 *   montrée (`animation_6_4`).
 *
 * `update_23_pre` est un painter : le manque laissé par les frites, la porte 103 ouverte (`copyBackground`) et la porte 104 ouverte
 * (`copyRect`, 255 transparent).
 */
export function* room23(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  const flags = g.flags;
  const picked = g.picked;
  if (picked === Verb.Open && objectId === Hall.DoorToOutside) {
    yield* toggleDoor(g, Flag.DoorOutside, DoorIndex.HallToOutside, "open");
    updateVisible(g);
  } else if (picked === Verb.Close && objectId === Hall.DoorToOutside) {
    yield* toggleDoor(g, Flag.DoorOutside, DoorIndex.HallToOutside, "close");
    updateVisible(g);
  } else if (picked === Verb.Open && objectId === Hall.DoorToLanding) {
    yield* toggleDoor(g, Flag.DoorLanding, DoorIndex.HallToLanding, "open");
  } else if (picked === Verb.Close && objectId === Hall.DoorToLanding) {
    yield* toggleDoor(g, Flag.DoorLanding, DoorIndex.HallToLanding, "close");
  } else if (picked === Verb.Pick && objectId === Hall.Fries) {
    g.pickObject(Item.Fries);
    setVisible(g, Hall.Fries, false);
    flags[Flag.FriesTaken] = 1;
    yield* afterDisguisePart(g);
  } else {
    return false;
  }
  return true;
}

/** `update_23_pre` : le manque des frites, la porte 103 ouverte, la porte 104 ouverte. */
export const hallPainter: RoomPainter = {
  pre(r, s) {
    const { screen, draw3 } = r;
    const { flags } = s;
    if (flags[Flag.FriesTaken] === 1 && flags[Flag.DoorOutside] === 0) screen.copyBackground(draw3, 87, 171, 237, 110, 20, 28);
    if (flags[Flag.DoorOutside] === 1) screen.copyBackground(draw3, 29, 126, 239, 94, 57, 73);
    if (flags[Flag.DoorLanding] === 1) screen.copyRect(draw3, 1, 135, 7, 94, 27, 64);
  },
};
