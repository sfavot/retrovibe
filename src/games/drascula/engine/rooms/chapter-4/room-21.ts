import { animate } from "../../../cinematics/player";
import type { DrasculaEngine } from "../../loop";
import { setVisible, toggleDoor } from "../../room-kit";
import type { Sequence } from "../../sequence";
import { Verb } from "../../state";
import { DoorIndex, Flag, Item, Outside } from "./ids";

/** Réplique du héros devant la porte verrouillée (`talk(419)`), aussi à la porte de la pièce 27. */
export const LOCKED_DOOR_SPEECH = 419;
/** Vitesse de `st.bin`, la montée au mur. */
const CLIMB_FPS = 14;

/**
 * Pièce 21, le pied du château. Réécriture de `room_21` (engines/drascula/rooms.cpp, ScummVM). Cette pièce répond avant sa table de
 * `roomActions` au chapitre 4 (`checkAction`, voir `index.ts`) : le grappin (objet 21) sur le mur (179) finit le chapitre.
 *
 * Écart : `room_21` rend vrai pour la montée au mur ; ici c'est `g.endChapter()`, la séquence est abandonnée à son prochain `yield`.
 */
export function* room21(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  const flags = g.flags;
  const picked = g.picked;
  if (picked === Verb.Open && objectId === Outside.Door && flags[Flag.OutsideUnlocked] === 0) {
    yield* g.talk(LOCKED_DOOR_SPEECH);
  } else if (picked === Verb.Open && objectId === Outside.Door) {
    yield* toggleDoor(g, Flag.DoorOutside, DoorIndex.OutsideDoor, "open");
  } else if (picked === Verb.Close && objectId === Outside.Door) {
    yield* toggleDoor(g, Flag.DoorOutside, DoorIndex.OutsideDoor, "close");
  } else if (picked === Verb.Pick && objectId === Outside.Rope) {
    g.pickObject(Item.Rope);
    setVisible(g, Outside.Rope, false);
    flags[Flag.RopeTaken] = 1;
  } else if (picked === Item.Key && objectId === Outside.Door) {
    flags[Flag.OutsideUnlocked] = 1;
    yield* toggleDoor(g, Flag.DoorOutside, DoorIndex.OutsideDoor, "open");
    g.selectVerb(Verb.None);
  } else if (picked === Item.Grapnel && objectId === Outside.Wall) {
    yield* animate(g, "st.bin", CLIMB_FPS);
    yield* g.fadeToBlack(1);
    g.endChapter();
  } else {
    return false;
  }
  return true;
}
