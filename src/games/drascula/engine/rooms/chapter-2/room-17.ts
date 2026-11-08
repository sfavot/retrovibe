import type { DrasculaEngine } from "../../loop";
import { type Sequence } from "../../../../../engine/sequence";
import { toggleDoor } from "../../room-kit";
import { Verb } from "../../state";
import { Flag, Hut } from "./ids";
import { ordeal, resetVonBraun } from "./room-18";

/**
 * Pièce 17, la cabane de Von Braun. Réécriture de `room_17` et de `animation_20_2` (la discussion à travers la porte)
 * (engines/drascula/rooms.cpp, animation.cpp, ScummVM). Le rectangle de la porte ouverte et celui du premier plan (`roomPreUpdates`,
 * `roomUpdates`) sont dans `drascula.dat`.
 *
 * Écart : `room_17` a une branche pour les bouchons d'oreilles sur le héros (objet 11 sur l'objet 50, drapeau 22 bas) que
 * `checkAction` n'atteint jamais (la partie du chapitre 2 répond avant la pièce, sauf dans la pièce 18, `index.ts`) : elle n'est
 * pas reprise.
 *
 * Déroulement : ouvrir la porte (177) une première fois fait sonner le héros (scénario 22, drapeau 18) ; lui parler ouvre le menu
 * `OP_3` ; la réponse 20 lance `animation_20_2`, qui mène le héros dans le laboratoire (pièce 18) si le sac a été ouvert (drapeau 23).
 */

/** Index de la porte 177 dans la pièce (`doorNum`). */
const DOOR_INDEX = 1;

/** `room_17`. */
export function* room17(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  if (objectId !== Hut.Door) return false;
  const verb = g.picked;
  const flags = g.flags;
  if (verb === Verb.Look) {
    yield* g.talk(35);
  } else if (verb === Verb.Talk && flags[Flag.VonBraunAnswered] === 0) {
    yield* g.talk(6);
  } else if (verb === Verb.Talk) {
    yield* g.talk(378);
    yield* g.talkers.vonBraun(4, true);
    yield* g.dialogs.converse(3);
  } else if (verb === Verb.Open && flags[Flag.VonBraunAnswered] === 1) {
    yield* g.talk(346);
  } else if (verb === Verb.Open && flags[Flag.VonBraunLetsIn] === 0) {
    yield* g.dialogs.play(22);
  } else if (verb === Verb.Open) {
    yield* toggleDoor(g, Flag.HutDoorOpen, DOOR_INDEX, "open");
  } else if (verb === Verb.Close && flags[Flag.VonBraunLetsIn] === 1) {
    yield* toggleDoor(g, Flag.HutDoorOpen, DOOR_INDEX, "close");
  } else {
    return false;
  }
  return true;
}

/**
 * `animation_20_2` : Von Braun, derrière sa porte, met le héros au défi. Sans le sac ouvert (drapeau 23) il refuse l'entrée (« c'est que
 * je suis fauché ») ; sinon il ouvre, le héros entre dans le laboratoire (pièce 18), subit l'épreuve (`animation_23_2`) et ressort.
 */
export function* vonBraunDoor(g: DrasculaEngine): Sequence {
  const flags = g.flags;
  const talkers = g.talkers;
  yield* talkers.vonBraun(7, true);
  yield* talkers.vonBraun(8, true);
  yield* g.talk(383);
  yield* talkers.vonBraun(9, true);
  yield* g.talk(384);
  yield* talkers.vonBraun(10, true);
  yield* g.talk(385);
  yield* talkers.vonBraun(11, true);
  if (flags[Flag.HandbagOpened] === 0) {
    yield* g.talk(350);
    yield* talkers.vonBraun(57, true);
    return;
  }
  yield* g.talk(386);
  yield* talkers.vonBraun(12, true);
  flags[Flag.VonBraunAnswered] = 0;
  flags[Flag.VonBraunLetsIn] = 1;
  yield* toggleDoor(g, Flag.HutDoorOpen, DOOR_INDEX, "open");
  yield* g.exitRoom(1);
  yield* ordeal(g);
  yield* g.exitRoom(0);
  resetVonBraun(g);
  g.dialogs.breakOut = true;
}
