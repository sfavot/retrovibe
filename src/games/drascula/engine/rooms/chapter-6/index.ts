import type { DrasculaEngine } from "../../loop";
import type { ChapterScript } from "../../script";
import type { Sequence } from "../../sequence";
import { HERO_OBJECT, Verb } from "../../state";
import { activatePendulum } from "../../../cinematics";
import { HALF_PAL } from "../../../render/palette";
import { Flag, Item, ENTERING_BEDROOM_EXIT } from "./ids";
import { corridorPainter, room58, updateCorridorDoor } from "./room-58";
import { bedroomPainter, room59, updateBedroomDoors, wardrobeSurprise } from "./room-59";
import { placeDrasculaAtBar, room60, tavernPainter, tickTavern } from "./room-60";
import { freeFromPendulum, pendulumPainter, room102, tickPendulum } from "./room-102";

/**
 * Chapitre 6 : le château de Drascula, de la salle du pendule (pièces 58 et 102) à la taverne (60), la chambre de B.J. (59) et
 * l'arrière-salle (61), jusqu'à la fin du jeu (`animation_9_6`, jouée depuis la taverne). Modèle : le chapitre 1 (`docs/drascula/rooms.md`).
 *
 * Déjà faits par la vague C (`cinematics/`) : `animation_1_6` (début du chapitre), `animation_5_6` (la manivelle), `activatePendulum`,
 * `animation_9_6` (fin) et le générique. Ici : `room_58`, `room_59`, `room_60`, `room_102`, leurs mises à jour (`update_58_pre`,
 * `update_58`, `update_59_pre`, `update_60_pre`, `update_60`, `update_102`), `animation_6_6`, `animation_19_6`, la partie du chapitre de
 * `checkAction` et la partie de `updateVisible`. La pièce 61 n'a ni `room_61` ni `update_61` (un rectangle de `roomUpdates` et des
 * lignes de `roomActions`, déjà couverts par le moteur).
 *
 * `checkAction` : regarder le héros (308, 310) et, dans l'inventaire, regarder l'objet 9 (482, 483). Les pièces 60 et 102 que
 * `checkAction` de ScummVM appelle avant leur table passent ici par `rooms` : `roomActions` de la pièce répond de toute façon d'abord.
 * Pas d'`exitRoom` propre au chapitre, sauf `animation_19_6` à l'entrée de la chambre par la sortie 105 (`roomEntered`).
 */
export const chapter6: ChapterScript = {
  rooms: { 58: room58, 59: room59, 60: room60, 102: room102 },
  painters: { 58: corridorPainter, 59: bedroomPainter, 60: tavernPainter, 102: pendulumPainter },
  animations: { "6_6": freeFromPendulum, "19_6": wardrobeSurprise },

  *checkAction(g: DrasculaEngine, objectId: number): Sequence<boolean> {
    if (g.state.menuScreen) {
      // Inventaire ouvert : regarder l'objet 9.
      if (g.picked !== Verb.Look || objectId !== Item.Stake) return false;
      yield* g.talk(482);
      yield* g.talk(483);
      return true;
    }
    if (g.picked !== Verb.Look || objectId !== HERO_OBJECT) return false;
    yield* g.talk(g.flags[Flag.Free] === 1 ? 308 : 310);
    return true;
  },

  roomLoaded(g: DrasculaEngine): void {
    switch (g.state.room?.number) {
      case 58:
        updateCorridorDoor(g);
        break;
      case 59:
        updateBedroomDoors(g);
        break;
      case 60:
        placeDrasculaAtBar(g);
        break;
    }
  },

  *roomEntered(g: DrasculaEngine): Sequence {
    if (g.state.room?.number === 59 && g.state.objExit === ENTERING_BEDROOM_EXIT) yield* g.animation("19_6");
  },

  /** `loadGame` de ScummVM : dans la pièce 102 avec le héros ligoté (drapeau 1 à 2), le pendule est armé de nouveau (images, héros invisible). */
  restored(g: DrasculaEngine): void {
    if (g.state.room?.number === 102 && g.flags[Flag.Pendulum] === 2) activatePendulum(g);
  },

  /**
   * `kActionEasterEgg` (touche `0`) : dans l'arrière-salle (61), `alcbar.alg` remplace le décor jusqu'à la sortie de la pièce
   * (la pièce suivante recharge le sien). Rend `null` : ce n'est pas une séquence.
   */
  frame(g: DrasculaEngine): Sequence | null {
    if (g.state.room?.number === 61 && g.takeKey("0") !== null) g.gfx.loadPic("alcbar.alg", g.gfx.bg, HALF_PAL);
    return null;
  },

  tick(g: DrasculaEngine): void {
    const s = g.state;
    if (!g.gfx.roomSprites || g.gfx.owner !== "room") return;
    if (s.room?.number === 60) tickTavern(g);
    else if (s.room?.number === 102) tickPendulum(g);
  },
};
