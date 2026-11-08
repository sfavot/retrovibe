import type { DrasculaEngine } from "../../loop";
import { IgorType } from "../../../render/heads";
import { roomObject, setVisible, toggleDoor } from "../../room-kit";
import { type Sequence } from "../../../../../engine/sequence";
import { pause } from "../../cadence";
import { Track, Verb } from "../../state";
import { disguise } from "./disguise";
import { Anim, Bedroom, DoorIndex, Flag, HERO, Item } from "./ids";
import { igorName } from "./world";

/** Réplique du héros quand Igor a fermé la porte à clé (`talk(421)`). */
const LOCKED_BY_IGOR_SPEECH = 421;
/** Objets qui, donnés au héros, lancent le déguisement : la perruque, les frites, la farine et la cape. */
const DISGUISE_ITEMS: readonly number[] = [Item.Wig, Item.Fries, Item.Flour, Item.Cape];
/** Où le héros va pour atteindre la perruque, puis où il revient. */
const WIG_SPOT = { x: 260, y: 180 };
const DOOR_SPOT = { x: 153, y: 180 };

/**
 * Pièce 26, la chambre d'Igor. Réécriture de `room_26` (engines/drascula/rooms.cpp) et `animation_1_4` (animation.cpp, ScummVM). Le
 * dessin (`update_26_pre`, `update_26`) est dans `bedroom-view.ts`, le déguisement (`animation_5_4`) dans `disguise.ts`.
 *
 * - la porte 107 (drapeau 2) s'ouvre sauf si Igor l'a fermée à clé (drapeau 30, réplique 421) et se ferme ;
 * - parler à Igor (51) : `animation_1_4` ;
 * - prendre la perruque (143) : Igor la défend (réplique d'Igor 25) tant qu'il est là ; une fois parti (drapeau 18) le héros la prend
 *   et Igor, derrière la porte, la ferme à clé ;
 * - un des objets du déguisement sur le héros (50), perruque prise et Igor parti : `animation_5_4`.
 */
export function* room26(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  const flags = g.flags;
  const picked = g.picked;
  if (picked === Verb.Open && objectId === Bedroom.Door && flags[Flag.BedroomLocked] === 0) {
    yield* toggleDoor(g, Flag.DoorBedroom, DoorIndex.BedroomDoor, "open");
  } else if (picked === Verb.Open && objectId === Bedroom.Door) {
    yield* g.talk(LOCKED_BY_IGOR_SPEECH);
  } else if (picked === Verb.Close && objectId === Bedroom.Door) {
    yield* toggleDoor(g, Flag.DoorBedroom, DoorIndex.BedroomDoor, "close");
  } else if (DISGUISE_ITEMS.includes(picked) && objectId === HERO && flags[Flag.Ready] === 1 && flags[Flag.WigTaken] === 1) {
    yield* disguise(g);
  } else if (picked === Verb.Pick && objectId === Bedroom.Wig && flags[Flag.Ready] === 1) {
    yield* takeWig(g);
  } else if (picked === Verb.Pick && objectId === Bedroom.Wig) {
    yield* guardedWig(g);
  } else if (picked === Verb.Talk && objectId === Bedroom.Igor) {
    yield* igorTalks(g);
  } else {
    return false;
  }
  return true;
}

/** Igor parti : le héros prend la perruque, et Igor, à côté, ferme la porte à clé sans le voir. */
function* takeWig(g: DrasculaEngine): Sequence {
  const flags = g.flags;
  yield* g.walkToPoint(WIG_SPOT.x, WIG_SPOT.y);
  g.pickObject(Item.Wig);
  setVisible(g, Bedroom.Wig, false);
  flags[Flag.WigTaken] = 1;
  yield* toggleDoor(g, Flag.DoorBedroom, DoorIndex.BedroomDoor, "close");
  g.state.hero.track = Track.Up;
  yield* g.talkers.igor(27, IgorType.Door);
  flags[Flag.BedroomLocked] = 1;
  yield* g.talkers.igor(28, IgorType.Door);
  yield* g.walkToPoint(DOOR_SPOT.x, DOOR_SPOT.y);
}

/** Igor est là : il couvre sa perruque d'une main (une image) et la défend (réplique 25). */
function* guardedWig(g: DrasculaEngine): Sequence {
  const anim = g.state.anim;
  yield* g.walkToPoint(WIG_SPOT.x, WIG_SPOT.y);
  anim[Anim.WigGuard] = 1;
  try {
    yield* pause(3);
  } finally {
    anim[Anim.WigGuard] = 0;
  }
  yield* g.talkers.igor(25, IgorType.Wig);
  yield* g.walkToPoint(DOOR_SPOT.x, DOOR_SPOT.y);
}

/**
 * `animation_1_4` : le héros parle à Igor, qui se lève (deux images) ; la première fois Igor le prend pour le nettoyeur (répliques 13
 * à 15, le nom de l'objet devient « igor »), les suivantes il est assis et reconnaît le héros (356, 276, 6) ; puis la conversation 6.
 * Le drapeau 18 (Igor n'est pas à sa place habituelle) et le drapeau 20 (Igor debout) ne durent que le temps de la conversation.
 */
export function* igorTalks(g: DrasculaEngine): Sequence {
  const s = g.state;
  const flags = s.flags;
  const pose = (frame: number) => (s.anim[Anim.IgorPose] = frame);
  try {
    if (flags[Flag.IgorMet] === 0) {
      const igor = roomObject(g, Bedroom.Igor);
      if (igor) igor.name = igorName(g, true);
      yield* g.talk(275);
      pose(1);
      yield* pause(3);
      pose(2);
      yield* pause(3);
      flags[Flag.Ready] = 1;
      flags[Flag.IgorStanding] = 1;
      pose(0);
      yield* g.talkers.igor(13, IgorType.Seated);
      yield* g.talkers.igor(14, IgorType.Seated);
      yield* g.talkers.igor(15, IgorType.Seated);
      flags[Flag.IgorMet] = 1;
    } else {
      yield* g.talk(356);
      pose(1);
      yield* pause(2);
      flags[Flag.Ready] = 1;
      flags[Flag.IgorStanding] = 1;
      pose(0);
      yield* g.talk(276);
      yield* pause(14);
      yield* g.talkers.igor(6, IgorType.Seated);
    }
    yield* g.dialogs.converse(6);
  } finally {
    pose(0);
    flags[Flag.IgorStanding] = 0;
    flags[Flag.Ready] = 0;
  }
}
