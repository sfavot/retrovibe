import type { DrasculaEngine } from "../../loop";
import { setVisible } from "../../room-kit";
import { Crypt, Flag, Office, Room, Towers, Workshop, Laboratory } from "./ids";

/**
 * Aide propre au chapitre 5 : `updateVisible` (objets visibles selon les drapeaux). Les cinématiques qui recouvrent la pièce de
 * sprites la gèlent avec `freezeRoom` (`room-kit.ts`, `{ advance: true }` : `updateRoom(); updateScreen();`).
 */

/**
 * La partie du chapitre 5 d'`updateVisible` (objects.cpp, ScummVM), pour la pièce chargée. ScummVM désigne les objets par leur index dans
 * la pièce ; on les désigne par leur numéro (`ids.ts`). Appelée à l'entrée de chaque pièce (`roomLoaded`) et par les gestionnaires qui
 * changent un drapeau (`updateVisible()` de ScummVM).
 */
export function updateVisible(g: DrasculaEngine): void {
  const flags = g.flags;
  switch (g.room.number) {
    case Room.Office:
      // Le loup-garou est parti : sa porte du fond s'ouvre ; sinon elle est cachée.
      if (flags[Flag.WerewolfGone] === 1) {
        setVisible(g, Office.Werewolf, false);
        setVisible(g, Office.DoorRight, true);
      } else {
        setVisible(g, Office.DoorRight, false);
      }
      break;
    case Room.Towers:
      if (flags[Flag.WerewolfGone] === 1) setVisible(g, Towers.Tower4, true);
      break;
    case Room.Laboratory:
      if (flags[Flag.PlugConnected] === 1) setVisible(g, Laboratory.FloorPlug, false);
      break;
    case Room.Crypt:
      if (flags[Flag.BoneTaken] === 1) setVisible(g, Crypt.Bone, false);
      break;
    case Room.Workshop:
      if (flags[Flag.ScrewTaken] === 1) setVisible(g, Workshop.Screw, false);
      break;
    default:
      break;
  }
}
