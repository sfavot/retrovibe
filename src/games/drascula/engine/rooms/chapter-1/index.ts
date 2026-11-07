import type { DrasculaEngine } from "../../loop";
import type { ChapterScript } from "../../script";
import type { Sequence } from "../../sequence";
import { barmanAndBj, bedroomPainter, isBackDoor } from "./bj-scene";
import { Flag, REFUSED_DOOR_SPEECH } from "./ids";
import { barmanDialog, innPainter, pianistDialog, room62, tickInn } from "./room-62";

/**
 * Chapitre 1 : l'auberge (pièce 62) et son arrière-salle (pièce 63). Modèle des autres chapitres (`docs/drascula/rooms.md`).
 *
 * Seule la pièce 62 a un gestionnaire (`room_62`) et des mises à jour (`update_62_pre`, `update_62`) dans ScummVM ; la pièce 63 n'a que
 * des lignes de `roomActions` (et un rectangle de `roomUpdates`), déjà couverts par le moteur et par `drascula.dat`. La partie du
 * chapitre dans `checkAction`, `updateVisible` et les autres points d'extension est vide au chapitre 1 (`hasAnswer = 0`, « nothing »).
 *
 * Les portes de l'auberge (`exitRoom`) : la 104 est condamnée par le moteur (`isDoor[7] = 0`) ; la 105 est refusée avec la réplique
 * 442 tant que le barman n'a pas parlé (drapeau 0), puis lance `animation_2_1` (`bj-scene.ts`) et finit le chapitre.
 */
export const chapter1: ChapterScript = {
  rooms: { 62: room62 },
  painters: { 16: bedroomPainter, 62: innPainter },
  tick: tickInn,
  animations: { "2_1": barmanAndBj, "3_1": barmanDialog, "4_1": pianistDialog },

  *canExit(g: DrasculaEngine, index: number): Sequence<boolean> {
    if (!isBackDoor(g, index) || g.flags[Flag.BarmanSpoke] !== 0) return true;
    // `_characterMoved = false; doBreak = 1; talk(442); return false;`
    g.state.hero.moving = false;
    g.doBreak = true;
    yield* g.talk(REFUSED_DOOR_SPEECH);
    return false;
  },

  *leaving(g: DrasculaEngine, index: number): Sequence<boolean> {
    if (!isBackDoor(g, index)) return true;
    yield* g.animation("2_1");
    g.endChapter();
    return false;
  },
};
