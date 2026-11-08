import type { DrasculaEngine } from "../../loop";
import type { ChapterScript } from "../../script";
import type { Sequence } from "../../../../../engine/sequence";
import { Verb } from "../../state";
import { bedroomPainter, tickBedroom } from "./bedroom-view";
import { igorLeaves, disguise, undress } from "./disguise";
import { Flag, HERO, Item, Landing } from "./ids";
import { hallPainter, room23 } from "./room-23";
import { igorTalks, room26 } from "./room-26";
import { bookcaseTurns, room34, studyPainter } from "./room-34";
import { cupboardPainter, room35 } from "./room-35";
import { room21 } from "./room-21";
import { room22 } from "./room-22";
import { room24 } from "./room-24";
import { room27 } from "./room-27";
import { room29 } from "./room-29";
import { room30 } from "./room-30";
import { room31 } from "./room-31";
import { updateDoor, updateVisible } from "./world";

/** Numéro de pièce dont tous les verbes reçoivent la même réponse (`talk(178)` : « cette pièce est trop sombre »). */
const DARK_ROOM = 28;
/** Où le héros va avant de monter l'escalier du palier. */
const STAIRS_TOP = { x: 171, y: 78 };

/**
 * Chapitre 4 : le château de Drascula, de la pièce 21 (le pied du mur) aux pièces 22 à 44. Le héros doit se déguiser en Drascula pour
 * prendre la clé du salon, couper la branche de l'arbre avec la hache du salon, l'attacher à la corde et monter au mur (pièce 21).
 * Modèle : `chapter-1/` (`docs/drascula/rooms.md`), notes dans `docs/drascula/rooms-chapter-4.md`.
 *
 * Gestionnaires `room_N` des pièces 21, 22, 23, 24, 26, 27, 29, 30, 31, 34 et 35 ; les pièces 28 (réponse unique de `checkAction`),
 * 36 à 44 (le labyrinthe de couloirs, des portes seulement ; l'affiche de la pièce 44 est dans `roomActions`) n'ont pas de gestionnaire.
 * Dessin : `update_23_pre`, `update_26_pre`, `update_26`, `update_35_pre`, et l'étagère de `animation_8_4` (pièce 34).
 * Cinématiques de pièce : `animation_1_4`, `5_4`, `6_4`, `7_4`, `8_4` ; `animation_castle` est commune (`cinematics/`).
 */
export const chapter4: ChapterScript = {
  rooms: { 21: room21, 22: room22, 23: room23, 24: room24, 26: room26, 27: room27, 29: room29, 30: room30, 31: room31, 34: room34, 35: room35 },
  painters: { 23: hallPainter, 26: bedroomPainter, 34: studyPainter, 35: cupboardPainter },
  tick: tickBedroom,
  animations: { "1_4": igorTalks, "5_4": disguise, "6_4": igorLeaves, "7_4": undress, "8_4": bookcaseTurns },
  updateDoor,

  /** `updateVisible` et `savedTime` de la chambre d'Igor (clignement). */
  roomLoaded(g: DrasculaEngine): void {
    updateVisible(g);
    if (g.room.number === 26) g.state.savedTime = g.ticks;
  },

  /** `enterRoom` : le héros déguisé qui arrive sur le palier retire son déguisement. */
  *roomEntered(g: DrasculaEngine): Sequence {
    if (g.room.number === 24 && g.flags[Flag.Disguised] === 1) yield* g.animation("7_4");
  },

  /**
   * Partie du chapitre 4 de `checkAction` : les objets de l'inventaire se combinent (la branche et la corde font le grappin), regarder
   * la croix ou la corde ; hors inventaire : tout est trop sombre dans la pièce 28, manger les frites ou la farine n'est pas de saison
   * tant qu'Igor est là, et la pièce 21 répond avant sa table (`room(21, fl)`, le grappin sur le mur finit le chapitre).
   */
  *checkAction(g: DrasculaEngine, objectId: number): Sequence<boolean> {
    const s = g.state;
    const picked = g.picked;
    if (s.menuScreen) {
      if ((picked === Item.Branch && objectId === Item.Rope) || (picked === Item.Rope && objectId === Item.Branch)) {
        g.selectVerb(Verb.None);
        g.pickObject(Item.Grapnel);
        g.removeObject(Item.Branch);
        g.removeObject(Item.Rope);
      } else if (picked === Verb.Look && objectId === Item.Cross) {
        yield* g.talk(482);
        yield* g.talk(483);
      } else if (picked === Verb.Look && objectId === Item.Rope) {
        yield* g.talk(494);
        yield* g.talk(495);
      } else {
        return false;
      }
      return true;
    }
    if (g.room.number === DARK_ROOM) {
      yield* g.talk(178);
    } else if (picked === Item.Fries && objectId === HERO && s.flags[Flag.Ready] === 0) {
      yield* g.talk(481);
    } else if (picked === Item.Flour && objectId === HERO && s.flags[Flag.Ready] === 0) {
      yield* g.talk(487);
    } else if (g.room.number === 21) {
      return yield* g.roomVerb(21, objectId);
    } else {
      return false;
    }
    return true;
  },

  /** `exitRoom`, l'escalier du palier (108) : le héros monte d'abord jusqu'en haut des marches. */
  *leaving(g: DrasculaEngine, index: number): Sequence<boolean> {
    if (g.room.objects[index].id === Landing.Stairs) yield* g.walkToPoint(STAIRS_TOP.x, STAIRS_TOP.y);
    return true;
  },
};

