import type { DrasculaEngine } from "../../loop";
import { toggleDoor } from "../../room-kit";
import type { Sequence } from "../../../../../engine/sequence";
import { Verb } from "../../state";
import { afterDisguisePart } from "./disguise";
import { DoorIndex, Flag, Item, Pantry } from "./ids";

/** Réplique du héros devant les gonds rouillés (`talk(422)`). */
const RUSTY_HINGES_SPEECH = 422;
/** Réplique du héros quand le déodorant dégrippe les gonds (`talk(424)`). */
const OILED_SPEECH = 424;
/** Réplique du héros devant le pot de farine (`talk(423)`). */
const FLOUR_SPEECH = 423;

/**
 * Pièce 30, le garde-manger. Réécriture de `room_30` (engines/drascula/rooms.cpp, ScummVM). La porte 115 (drapeau 4) s'ouvre et se
 * ferme. L'armoire (144) :
 * - ouvrir : refusé tant que les gonds sont rouillés (réplique 422) ; le déodorant (13) sur l'armoire les dégrippe (drapeau 19) ;
 * - ouverte pour la première fois (drapeau 22), elle donne la farine (12), et si le héros a déjà les frites et la cape, Igor part ;
 * - fermer l'armoire.
 *
 * L'armoire ouverte (drapeau 16) est une ligne de `roomPreUpdates`. Pas de `update_30`.
 */
export function* room30(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  const flags = g.flags;
  const picked = g.picked;
  if (picked === Verb.Open && objectId === Pantry.DoorToKitchen) {
    yield* toggleDoor(g, Flag.DoorPantry, DoorIndex.PantryToKitchen, "open");
  } else if (picked === Verb.Close && objectId === Pantry.DoorToKitchen) {
    yield* toggleDoor(g, Flag.DoorPantry, DoorIndex.PantryToKitchen, "close");
  } else if (picked === Verb.Open && objectId === Pantry.Wardrobe && flags[Flag.HingesOiled] === 0) {
    yield* g.talk(RUSTY_HINGES_SPEECH);
  } else if (picked === Verb.Open && objectId === Pantry.Wardrobe && flags[Flag.FlourTaken] === 1) {
    yield* toggleDoor(g, Flag.PantryWardrobeOpen, DoorIndex.PantryWardrobe, "open");
  } else if (picked === Verb.Open && objectId === Pantry.Wardrobe) {
    yield* toggleDoor(g, Flag.PantryWardrobeOpen, DoorIndex.PantryWardrobe, "open");
    yield* g.talk(FLOUR_SPEECH);
    flags[Flag.FlourTaken] = 1;
    g.pickObject(Item.Flour);
    yield* afterDisguisePart(g);
  } else if (picked === Verb.Close && objectId === Pantry.Wardrobe) {
    yield* toggleDoor(g, Flag.PantryWardrobeOpen, DoorIndex.PantryWardrobe, "close");
  } else if (picked === Item.Deodorant && objectId === Pantry.Wardrobe) {
    yield* g.talk(OILED_SPEECH);
    flags[Flag.HingesOiled] = 1;
  } else {
    return false;
  }
  return true;
}
