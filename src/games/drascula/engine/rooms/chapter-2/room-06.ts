import type { RoomPainter } from "../../../render/renderer";
import type { DrasculaEngine } from "../../loop";
import { type Sequence, pause } from "../../sequence";
import { freezeRoom, pose, setVisible, toggleDoor } from "../../room-kit";
import { Verb } from "../../state";
import { refresh, setLight } from "./anim-kit";
import { Bedroom, Flag, Item } from "./ids";

/**
 * Pièce 6, la chambre. Réécriture de `room_6` et `update_6_pre` (engines/drascula/rooms.cpp, ScummVM). Les rectangles de la porte,
 * du tiroir et de l'armoire fermés (`roomPreUpdates`, drapeaux 0, 1 et 2) sont dans `drascula.dat`.
 *
 * Index de la porte 138 dans la pièce : 1 (`toggleDoor(0, 1, …)`). Ouvrir le tiroir ou l'armoire, prendre le crucifix : le héros est
 * remplacé un instant par une pose de `AUX6.ALG` (`freezeRoom`, `pose`), comme dans l'original qui l'y dessine à sa place.
 */

/** Index de la porte 138 (`doorNum`). */
const DOOR_INDEX = 1;

/** `room_6`. */
export function* room06(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  const verb = g.picked;
  const flags = g.flags;
  const sheet = g.gfx.draw3;
  if (verb === Verb.Look && objectId === Bedroom.Candelabra) {
    yield* g.talk(41);
    yield* g.talk(42);
  } else if (verb === Verb.Open && objectId === Bedroom.Door) {
    yield* toggleDoor(g, Flag.BedroomDoorOpen, DOOR_INDEX, "open");
  } else if (verb === Verb.Close && objectId === Bedroom.Door) {
    yield* toggleDoor(g, Flag.BedroomDoorOpen, DOOR_INDEX, "close");
  } else if (verb === Verb.Open && objectId === Bedroom.Wardrobe && flags[Flag.WardrobeOpen] === 0) {
    freezeRoom(g, { hero: pose(g, sheet, 228, 102, 5, -1, 47, 73), post: false });
    yield* pause(10);
    g.playEffect(3);
    flags[Flag.WardrobeOpen] = 1;
    yield* refresh(g);
    yield* g.finishSound();
  } else if (verb === Verb.Close && objectId === Bedroom.Wardrobe && flags[Flag.WardrobeOpen] === 1) {
    // Le drapeau tombe avant le dessin : la fermeture montre déjà l'armoire fermée sous la pose.
    flags[Flag.WardrobeOpen] = 0;
    freezeRoom(g, { hero: pose(g, sheet, 228, 102, 5, -1, 47, 73), post: false });
    yield* pause(5);
    g.playEffect(4);
    yield* refresh(g);
    yield* g.finishSound();
  } else if (verb === Verb.Open && objectId === Bedroom.Drawer && flags[Flag.DrawerOpen] === 0) {
    freezeRoom(g, { hero: pose(g, sheet, 267, 1, -14, -2, 52, 73), post: false });
    yield* pause(19);
    g.playEffect(3);
    flags[Flag.DrawerOpen] = 1;
    setVisible(g, Bedroom.Crucifix, true);
    setVisible(g, Bedroom.Drawer, false);
    yield* refresh(g);
    yield* g.finishSound();
  } else if (verb === Verb.Pick && objectId === Bedroom.Crucifix) {
    freezeRoom(g, { hero: pose(g, sheet, 267, 1, -14, -2, 52, 73), post: false });
    yield* pause(19);
    g.pickObject(Item.Cross);
    setVisible(g, Bedroom.Crucifix, false);
    flags[Flag.CrucifixTaken] = 1;
    g.updateRoom();
  } else if (verb === Verb.Open && objectId === Bedroom.Crucifix) {
    // Ouvrir le crucifix : rien à dire, mais la pièce a répondu (`hasAnswer = 1`).
  } else {
    return false;
  }
  return true;
}

/** Zones où le héros est dans la lumière (pieds `curY + curHeight`) : devant l'armoire et dans le coin bas gauche. */
function isLit(x: number, feet: number): boolean {
  return (x > 149 && feet > 160 && x < 220 && feet < 188) || (x > 75 && feet > 183 && x < 145);
}

/** `update_6_pre` (avant le héros) : la lumière suit le héros. */
export const bedroomPainter: RoomPainter = {
  pre(r, s) {
    setLight(r, isLit(s.hero.x, s.hero.y + s.hero.height) ? "bright" : "dark");
  },
};
