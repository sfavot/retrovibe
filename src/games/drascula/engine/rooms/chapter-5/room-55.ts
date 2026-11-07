import { animate } from "../../../cinematics/player";
import type { DrasculaEngine } from "../../loop";
import type { Sequence } from "../../sequence";
import { Verb } from "../../state";
import { Flag, Item, Workshop } from "./ids";
import { updateVisible } from "./screen";

/**
 * Pièce 55, l'atelier. Réécriture de `room_55` (engines/drascula/rooms.cpp, ScummVM). Pas de `update_55` ni de `roomUpdates`.
 *
 * - prendre la vis (122) la met en main (objet 12) et la cache (drapeau 8) ;
 * - la porte du fond (206), quel que soit le verbe : le son 11, `det.bin` (une détonation), puis le héros recule d'un pas
 *   (`walkToPoint(curX - 3, curY + curHeight + 6)`). Rien n'y est donc possible.
 */

/** `room_55`. */
export function* room55(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  if (g.picked === Verb.Pick && objectId === Workshop.Screw) {
    g.pickObject(Item.Screw);
    g.flags[Flag.ScrewTaken] = 1;
    updateVisible(g);
    return true;
  }
  if (objectId === Workshop.TrappedDoor) {
    const hero = g.state.hero;
    g.playEffect(11);
    yield* animate(g, "det.bin", 17);
    yield* g.finishSound();
    yield* g.walkToPoint(hero.x - 3, hero.y + hero.height + 6);
    return true;
  }
  return false;
}
