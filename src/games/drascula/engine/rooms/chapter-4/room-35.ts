import type { RoomPainter } from "../../../render/renderer";
import type { DrasculaEngine } from "../../loop";
import { setVisible } from "../../room-kit";
import type { Sequence } from "../../sequence";
import { Verb } from "../../state";
import { afterDisguisePart } from "./disguise";
import { Cupboard, Flag, Item } from "./ids";
import { updateVisible } from "./world";

/** Réplique du héros qui choisit le plus gros cerveau (`talk(426)`). */
const BRAIN_SPEECH = 426;

/**
 * Pièce 35, l'armoire derrière le bureau. Réécriture de `room_35` et `update_35_pre` (engines/drascula/rooms.cpp, ScummVM).
 *
 * - la cape (148, objet 16) : si les frites et la farine sont déjà prises, Igor part (`animation_6_4`) ;
 * - le cerveau (147, objet 15) : le bocal vide et le déodorant (149) apparaissent (`updateVisible`) ;
 * - le déodorant (149, objet 13).
 *
 * `update_35_pre` est un painter : le bocal vide (rectangle de `draw3`) quand le cerveau est pris et le déodorant aussi.
 */
export function* room35(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  const flags = g.flags;
  const picked = g.picked;
  if (picked === Verb.Pick && objectId === Cupboard.Cape) {
    g.pickObject(Item.Cape);
    setVisible(g, Cupboard.Cape, false);
    flags[Flag.CapeTaken] = 1;
    yield* afterDisguisePart(g);
  } else if (picked === Verb.Pick && objectId === Cupboard.Brain) {
    yield* g.talk(BRAIN_SPEECH);
    g.pickObject(Item.Brain);
    setVisible(g, Cupboard.Brain, false);
    flags[Flag.BrainTaken] = 1;
    flags[Flag.DeodorantVisible] = 1;
    updateVisible(g);
  } else if (picked === Verb.Pick && objectId === Cupboard.Deodorant) {
    g.pickObject(Item.Deodorant);
    setVisible(g, Cupboard.Deodorant, false);
    flags[Flag.DeodorantVisible] = 0;
  } else {
    return false;
  }
  return true;
}

/** `update_35_pre` : l'étagère vide, une fois le cerveau et le déodorant pris. */
export const cupboardPainter: RoomPainter = {
  pre(r, s) {
    if (s.flags[Flag.DeodorantVisible] === 0 && s.flags[Flag.BrainTaken] === 1) r.screen.copyBackground(r.draw3, 111, 150, 118, 52, 40, 23);
  },
};
