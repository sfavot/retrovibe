import type { RoomPainter } from "../../../render/renderer";
import type { DrasculaEngine } from "../../loop";
import { type Sequence } from "../../../../../engine/sequence";
import { pause } from "../../cadence";
import { toggleDoor } from "../../room-kit";
import { Track, Verb } from "../../state";
import { Flag, Hotel, Item, NO_DOOR } from "./ids";

/**
 * Pièce 16, la chambre d'hôtel. Réécriture de `room_16` et `update_16_pre` (engines/drascula/rooms.cpp, ScummVM). La pièce 16 est
 * aussi la chambre de B.J. du chapitre 1 (`animation_2_1`) : ici, la partie du chapitre 2.
 *
 * Le coffre (183) : l'ouvrir (drapeau 19) donne le sac de B.J. (objet 22) la première fois ; lui parler le fait répondre
 * (`talk_trunk`). La porte 163 est l'objet d'index 0. Ouvrir et fermer le coffre n'ont pas de porte à mettre à jour (`NO_DOOR`).
 */

/** Index de la porte 163 dans la pièce (`doorNum`). */
const DOOR_INDEX = 0;
/** Réplique du coffre. */
const TRUNK_SPEECH = 83;

/** `room_16`. */
export function* room16(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  const verb = g.picked;
  const flags = g.flags;
  if (verb === Verb.Open && objectId === Hotel.Door) {
    yield* toggleDoor(g, Flag.HotelDoorOpen, DOOR_INDEX, "open");
  } else if (verb === Verb.Close && objectId === Hotel.Door) {
    yield* toggleDoor(g, Flag.HotelDoorOpen, DOOR_INDEX, "close");
  } else if (verb === Verb.Talk && objectId === Hotel.Chest) {
    yield* g.talk(341);
    yield* pause(10);
    yield* g.talkers.heroSync(g.data.text("text", 50), "50.als", "11111111111144432554433");
    yield* pause(3);
    yield* g.talkers.trunk(TRUNK_SPEECH);
  } else if (verb === Verb.Open && objectId === Hotel.Chest) {
    yield* toggleDoor(g, Flag.ChestOpen, NO_DOOR, "open");
    if (flags[Flag.HandbagTaken] === 0) {
      flags[Flag.HandbagTaken] = 1;
      g.state.hero.track = Track.Down;
      g.updateRoom();
      yield* g.talk(342);
      g.pickObject(Item.Handbag);
    }
  } else if (verb === Verb.Close && objectId === Hotel.Chest) {
    yield* toggleDoor(g, Flag.ChestOpen, NO_DOOR, "close");
  } else if (verb === Verb.Look && objectId === Hotel.Mirror) {
    yield* g.talk(343);
    g.state.hero.track = Track.Down;
    g.updateRoom();
    yield* g.talk(344);
  } else {
    return false;
  }
  return true;
}

/**
 * `update_16_pre` (avant le héros), chapitre 2 : la porte fermée (drapeau 17 bas) et le coffre ouvert (drapeau 19). La chambre de
 * B.J. du chapitre 1 (`animation_2_1`, même numéro 16) a son propre painter : les painters sont rangés par chapitre.
 */
export const hotelPainter: RoomPainter = {
  pre(r, s) {
    if (s.flags[Flag.HotelDoorOpen] === 0) r.screen.copyBackground(r.draw3, 1, 103, 24, 72, 33, 95);
    if (s.flags[Flag.ChestOpen] === 1) r.screen.copyBackground(r.draw3, 37, 151, 224, 115, 56, 47);
  },
};
