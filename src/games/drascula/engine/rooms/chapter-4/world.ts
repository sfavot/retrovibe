import type { DrasculaEngine } from "../../loop";
import { roomObject, setVisible } from "../../room-kit";
import { Bedroom, Corridor, Cupboard, Flag, Hall, Kitchen, Landing, LivingRoom, Outside, Pantry, Study, Tree } from "./ids";

/**
 * L'état du monde du chapitre 4 qui suit les drapeaux : `updateDoor` (table `doors` de rooms.cpp et cas des portes 101 et 116) et
 * la partie du chapitre 4 d'`updateVisible` (objects.cpp, ScummVM). Les deux sont relus par le moteur à l'entrée d'une pièce
 * (`roomLoaded`, `updateDoor`) et par les gestionnaires après un changement.
 */

/** Table `doors` du chapitre 4 : numéro de la porte et drapeau qui dit qu'elle est ouverte. */
const DOOR_FLAGS: ReadonlyMap<number, number> = new Map([
  [Hall.DoorToOutside, Flag.DoorOutside],
  [Hall.DoorToLanding, Flag.DoorLanding],
  [Landing.DoorToHall, Flag.DoorLanding],
  [Landing.DoorToBedroom, Flag.DoorBedroom],
  [Bedroom.Door, Flag.DoorBedroom],
  [Corridor.DoorToCellar, Flag.DoorCellar],
  [Kitchen.DoorToPantry, Flag.DoorPantry],
  [Pantry.DoorToKitchen, Flag.DoorPantry],
  [LivingRoom.DoorToCorridor, Flag.DoorLivingRoom],
  [Study.Wardrobe, Flag.StudyWardrobe],
  [Study.Bookcase, Flag.Bookcase],
]);


/**
 * `updateDoor(index)` : l'état de la porte (`isDoor`) d'après les drapeaux. Hors de la table, seules les portes 101 (extérieur,
 * ouverte quand elle est déverrouillée) et 116 (salon, ouverte quand elle est ouverte et déverrouillée) sont recalculées ; les
 * autres cas laissent l'état précédent, comme ScummVM.
 */
export function updateDoor(g: DrasculaEngine, index: number): void {
  const object = g.room.objects[index];
  if (!object) return;
  const flags = g.flags;
  const tableFlag = DOOR_FLAGS.get(object.id);
  if (tableFlag !== undefined) {
    object.isDoor = flags[tableFlag] !== 0 && object.door !== null;
    return;
  }
  if (object.id === Outside.Door) {
    if (flags[Flag.DoorOutside] === 0) object.isDoor = false;
    else if (flags[Flag.OutsideUnlocked] === 1) object.isDoor = object.door !== null;
  } else if (object.id === Corridor.DoorToLivingRoom) {
    if (flags[Flag.DoorLivingRoom] === 0) object.isDoor = false;
    else if (flags[Flag.LivingRoomUnlocked] === 1) object.isDoor = object.door !== null;
  }
}

/** Nom d'Igor tant que le héros ne l'a pas rencontré (`textmisc[0]`), et après (`textmisc[5]`). */
export function igorName(g: DrasculaEngine, met: boolean): string {
  return g.data.text("textmisc", met ? 5 : 0);
}

/**
 * `updateVisible` pour le chapitre 4 : objets visibles de la pièce chargée d'après les drapeaux. Les « visible[n] » de ScummVM sont
 * des index d'objets, traduits ici en numéros d'objets de la fiche.
 */
export function updateVisible(g: DrasculaEngine): void {
  const flags = g.flags;
  switch (g.room.number) {
    case 21:
      if (flags[Flag.RopeTaken] === 1) setVisible(g, Outside.Rope, false);
      break;
    case 22:
      if (flags[Flag.MagpieDown] === 1) {
        setVisible(g, Tree.Magpie, false);
        setVisible(g, Tree.Branch, true);
      }
      if (flags[Flag.KeyTaken] === 1) setVisible(g, Tree.Key, false);
      break;
    case 23:
      if (flags[Flag.FriesTaken] === 0) setVisible(g, Hall.Fries, flags[Flag.DoorOutside] === 0);
      break;
    case 26: {
      // Igor porte le nom « bossu » tant qu'on ne l'a pas rencontré ; il disparaît quand le héros a tout réuni.
      const igor = roomObject(g, Bedroom.Igor);
      if (igor && flags[Flag.IgorMet] === 0) igor.name = igorName(g, false);
      if (flags[Flag.Ready] === 1) setVisible(g, Bedroom.Igor, false);
      if (flags[Flag.WigTaken] === 1) setVisible(g, Bedroom.Wig, false);
      break;
    }
    case 31:
      if (flags[Flag.AxeTaken] === 1) setVisible(g, LivingRoom.Axe, false);
      break;
    case 35:
      if (flags[Flag.CapeTaken] === 1) setVisible(g, Cupboard.Cape, false);
      if (flags[Flag.DeodorantVisible] === 1) setVisible(g, Cupboard.Deodorant, true);
      if (flags[Flag.BrainTaken] === 1) setVisible(g, Cupboard.Brain, false);
      break;
  }
}
