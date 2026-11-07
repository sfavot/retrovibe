import type { ChapterScript } from "../../script";
import { gatePainter, killVampire, room13, tickGate, wakeBeforeAction, wakeOnFrame, wakeVampire } from "./room-13";

/**
 * Chapitre 3 : le vampire qui garde le passage (pièce 13) et la pièce de départ (pièce 20). Convention : `docs/drascula/rooms.md` ;
 * notes : `docs/drascula/rooms-chapter-3.md`.
 *
 * Seule la pièce 13 a un gestionnaire (`room_13`, aussi appelé par la partie du chapitre 3 de `checkAction`, ce que le moteur fait déjà
 * en appelant le gestionnaire de la pièce) et une mise à jour (`update_13`) ; la pièce 20 n'a que son rectangle d'avant-plan
 * (`roomUpdates`). `updateVisible` est vide au chapitre 3, et les deux portes n'ont pas d'action propre (`exitRoom`).
 *
 * Fin du chapitre : le gestionnaire de la pièce 13 « rend vrai » quand la croix tue le vampire (`animation_2_3`) ; chapitre 4 ensuite.
 */
export const chapter3: ChapterScript = {
  rooms: { 13: room13 },
  painters: { 13: gatePainter },
  tick: tickGate,
  frame: wakeOnFrame,
  checkAction: wakeBeforeAction,
  animations: { "2_3": killVampire, "6_3": wakeVampire },
};
