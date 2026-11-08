import type { DrasculaEngine } from "../../loop";
import type { ChapterScript } from "../../script";
import type { Sequence } from "../../../../../engine/sequence";
import { Verb } from "../../state";
import { Room } from "./ids";
import { arrival, boneThrow, room49 } from "./room-49";
import { reanimate, room53 } from "./room-53";
import { meetBj, room54 } from "./room-54";
import { room55 } from "./room-55";
import { coffinOpened, room56 } from "./room-56";
import { updateVisible } from "./screen";

/**
 * Chapitre 5 : le château de Drascula (pièces 45 et 49 à 57). Voir `docs/drascula/rooms-chapter-5.md`.
 *
 * - pièce 45, la carte des quatre tours : pas de `room_45` ; le héros est invisible (`enterRoom`), la quatrième tour apparaît quand
 *   le loup-garou est parti ; pièces 50, 51, 52 : rien (pas de `room_N`) ;
 * - pièces 49, 53, 54, 55, 56 : `room_N` (`room-NN.ts`) ; pas de `update_N` au chapitre 5 (les rectangles de `roomPreUpdates` suffisent) ;
 * - pièces 56 et 57 : on y arrive par `animation_12_5` (fin du laboratoire) ; la chambre du cercueil finit le chapitre (`animation_14_5`) ;
 * - `checkAction` : regarder l'objet 9 de l'inventaire (réplique 482 puis 483) ;
 * - `roomLoaded` : `updateVisible` du chapitre ; `roomEntered` : le scénario 4 à la première entrée dans le bureau.
 */
export const chapter5: ChapterScript = {
  rooms: { 49: room49, 53: room53, 54: room54, 55: room55, 56: room56 },
  animations: { "1_5": meetBj, "5_5": boneThrow, "12_5": reanimate, "14_5": coffinOpened },

  *checkAction(g: DrasculaEngine, objectId: number): Sequence<boolean> {
    // Dans l'inventaire : « Comme je m'amuse à tuer des vampires avec ce truc ! »
    if (g.state.menuScreen && g.picked === Verb.Look && objectId === 9) {
      yield* g.talk(482);
      yield* g.talk(483);
      return true;
    }
    return false;
  },

  roomLoaded(g: DrasculaEngine): void {
    updateVisible(g);
    // La carte des tours : le héros n'est pas dessiné.
    if (g.room.number === Room.Towers) g.state.hero.visible = false;
  },

  *roomEntered(g: DrasculaEngine): Sequence {
    if (g.room.number === Room.Office) yield* arrival(g);
  },
};
