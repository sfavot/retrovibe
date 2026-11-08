import type { DrasculaEngine } from "../../loop";
import type { ChapterScript } from "../../script";
import type { Sequence } from "../../../../../engine/sequence";
import { setVisible } from "../../room-kit";
import { Track, Verb } from "../../state";
import { Bedroom, Cemetery, ChapelWall, Chapel, Crossroads, DOOR_FLAGS, Flag, HERO, Hut, Inn, Item, Lab, Well, WorldMap } from "./ids";
import { churchPainter, room01 } from "./room-01";
import { crossroadsPainter, tickCrossroads } from "./room-02";
import { cemeteryPainter, room03, sickleOnPlant } from "./room-03";
import { room04, villagePainter } from "./room-04";
import { climbWindow, room05, spikeOnWindow } from "./room-05";
import { bedroomPainter, room06 } from "./room-06";
import { room07 } from "./room-07";
import { room08 } from "./room-08";
import { blindAlleyPainter, giveMoney, room09, talkToBlind, tickBlindAlley } from "./room-09";
import { room12 } from "./room-12";
import { barmanAfterPianist, drunkStory, giveBook, innPainter, room14, talkToBarman, talkToDrunk, talkToPianist, tickInn } from "./room-14";
import { kickMachine, room15 } from "./room-15";
import { hotelPainter, room16 } from "./room-16";
import { room17, vonBraunDoor } from "./room-17";
import { brewPotion, earplugsWork, labPainter, machineDown, machineUp, ordeal, recipeReminder, room18, tickLab, wakeVonBraun } from "./room-18";
import { intoTheWell } from "./room-19";

/**
 * Chapitre 2 : le village de Transylvanie (pièces 1 à 10, 12 et 14 à 19). B.J. est partie, le héros cherche Von Braun, qui sait
 * affronter les vampires, et rassemble les cinq ingrédients de sa potion (feuilles, chewing-gum, mouchoirs, cigarettes, bougie).
 * Il commence dans l'auberge (pièce 14) et finit dans le puits (pièce 19), par le chapitre 3.
 *
 * Réécriture de ScummVM (engines/drascula : rooms.cpp, animation.cpp, drascula.cpp), un module par pièce (`room-NN.ts`, cinématiques
 * de pièce comprises) ; les noms de ScummVM sont cités en tête de chacun. Cet index assemble les points d'extension du chapitre :
 *
 * | Point | ScummVM |
 * | --- | --- |
 * | `rooms`, `painters`, `tick` | `room_N`, `update_N_pre`, `update_N` (dessin et avance séparés) |
 * | `animations` | les `animation_N_2` (les noms sont ceux des réponses de dialogue : `16_2`, `20_2`, `23_2`, `29_2`, `31_2`) |
 * | `checkAction` | la partie « chapitre 2 » : le sac de B.J. dans l'inventaire (164, 307), les bouchons d'oreilles sur le héros (315) |
 * | `leaving` | `exitRoom` : `animation_2_2` (porte 136), la marche de la porte 124, `animation_35_2` (puits 173, fin du chapitre), le départ du pianiste (146), les bouchons d'oreilles rangés (176) |
 * | `updateDoor` | la table `doors` |
 * | `roomLoaded` | `updateVisible`, les musiques des pièces 14 et 15, `savedTime` des pièces 2, 9, 14 et 18 |
 * | `frame` | les corrections de position de `runCurrentChapter` (pièces 3 et 14) |
 *
 * Écarts de conception (le détail est dans l'en-tête de chaque pièce et dans `docs/drascula/rooms-chapter-2.md`) : l'avance des
 * animations est dans `tick` et non dans le dessin ; les cinématiques qui dessinent par rectangles figent l'image de la pièce dans
 * l'image libre (`anim-kit.ts`).
 */

export const chapter2: ChapterScript = {
  rooms: {
    1: room01,
    3: room03,
    4: room04,
    5: room05,
    6: room06,
    7: room07,
    8: room08,
    9: room09,
    12: room12,
    14: room14,
    15: room15,
    16: room16,
    17: room17,
    18: room18,
  },
  painters: {
    1: churchPainter,
    2: crossroadsPainter,
    3: cemeteryPainter,
    4: villagePainter,
    6: bedroomPainter,
    9: blindAlleyPainter,
    14: innPainter,
    16: hotelPainter,
    18: labPainter,
  },
  animations: {
    "2_2": climbWindow,
    "4_2": talkToBlind,
    "5_2": spikeOnWindow,
    "6_2": giveMoney,
    "7_2": sickleOnPlant,
    "11_2": talkToBarman,
    "12_2": talkToPianist,
    "13_2": talkToDrunk,
    "14_2": machineDown,
    "16_2": drunkStory,
    "20_2": vonBraunDoor,
    "23_2": ordeal,
    "24_2": wakeVonBraun,
    "25_2": machineUp,
    "26_2": giveBook,
    "27_2": earplugsWork,
    "29_2": recipeReminder,
    "31_2": brewPotion,
    "34_2": kickMachine,
    "35_2": intoTheWell,
    "36_2": barmanAfterPianist,
  },

  tick(g: DrasculaEngine): void {
    tickCrossroads(g);
    tickBlindAlley(g);
    tickInn(g);
    tickLab(g);
  },

  /** `checkAction`, partie du chapitre 2. */
  *checkAction(g: DrasculaEngine, objectId: number): Sequence<boolean> {
    const flags = g.flags;
    const verb = g.picked;
    if (g.state.menuScreen) {
      // Le sac de B.J. dans l'inventaire : regarder ou ouvrir le vide la première fois (billet de mille et deux pièces).
      if ((verb === Verb.Look || verb === Verb.Open) && objectId === Item.Handbag && flags[Flag.HandbagOpened] === 0) {
        yield* g.talk(164);
        flags[Flag.HandbagOpened] = 1;
        g.selectVerb(Verb.None);
        g.addObject(Item.Money);
        g.addObject(Item.TwoCoins);
        return true;
      }
      if (verb === Verb.Look && objectId === Item.Handbag && flags[Flag.HandbagOpened] === 1) {
        yield* g.talk(307);
        return true;
      }
      return false;
    }
    // Les bouchons d'oreilles sur le héros : « Je les mettrai le moment venu » partout sauf au laboratoire (pièce 18).
    if (verb === Item.Earplugs && objectId === HERO && flags[Flag.EarplugsScene] === 0 && g.room.number !== 18) {
      yield* g.talk(315);
      return true;
    }
    return false;
  },

  /** `exitRoom`, actions par porte (ScummVM les écrit avant de charger la pièce suivante). */
  *leaving(g: DrasculaEngine, index: number): Sequence<boolean> {
    const flags = g.flags;
    const hero = g.state.hero;
    switch (g.room.objects[index]?.id) {
      case ChapelWall.Window: // 136 : le héros escalade la fenêtre de la chapelle
        yield* climbWindow(g);
        break;
      case Cemetery.ToChurch: // 124 : le héros sort par la droite du cimetière en marchant
        yield* g.walkToPoint(163, 106);
        yield* g.walkToPoint(287, 101);
        hero.track = Track.Left;
        break;
      case Well.Well: // le puits : la potion, le puits, et le chapitre 3
        yield* intoTheWell(g);
        g.endChapter();
        return false;
      case WorldMap.ToVillage: // quitter le village après avoir donné le livre : le pianiste s'en va
        if (flags[Flag.BookGiven] === 1) {
          flags[Flag.PianistGone] = 1;
          flags[Flag.PianistTalking] = 1;
        }
        break;
      case Hut.Exit: // sortir de la cabane avec les bouchons d'oreilles : le héros les range
        if (flags[Flag.WearingEarplugs] === 1) {
          flags[Flag.WearingEarplugs] = 0;
          g.removeObject(Item.EarWithEarplug);
          g.addObject(Item.Earplugs);
        }
        break;
    }
    return true;
  },

  /** `updateDoor` : `isDoor[doorNum] = flags[…]` pour les portes de la table `doors`. */
  updateDoor(g: DrasculaEngine, index: number): void {
    const object = g.room.objects[index];
    const flag = object ? DOOR_FLAGS[object.id] : undefined;
    if (object && flag !== undefined) object.isDoor = g.flags[flag] !== 0 && object.door !== null;
  },

  /** Fin de la partie « données » d'`enterRoom` : `updateVisible`, musiques des pièces 14 et 15, `savedTime`. */
  roomLoaded(g: DrasculaEngine): void {
    const s = g.state;
    const flags = s.flags;
    const room = s.room?.number;
    // `updateVisible`.
    if (room === 2 && flags[Flag.HutKnown] === 0) setVisible(g, Crossroads.Hut, false);
    else if (room === 3 && flags[Flag.BarsTaken] === 1) setVisible(g, Cemetery.Bars, false);
    else if (room === 6 && flags[Flag.DrawerOpen] === 1 && flags[Flag.CrucifixTaken] === 0) {
      setVisible(g, Bedroom.Drawer, false);
      setVisible(g, Bedroom.Crucifix, true);
    } else if (room === 7 && flags[Flag.CandleTaken] === 1) setVisible(g, Chapel.Candle, false);
    else if (room === 14 && flags[Flag.PianistGone] === 1) setVisible(g, Inn.Pianist, false);
    else if (room === 18 && flags[Flag.BookTaken] === 1) setVisible(g, Lab.Book, false);
    // Musiques : l'auberge et le couloir changent après le livre, se taisent après le départ du pianiste.
    if ((room === 14 || room === 15) && flags[Flag.BookGiven] === 1) s.roomMusic = 16;
    if ((room === 14 || room === 15) && flags[Flag.PianistGone] === 1) s.roomMusic = 0;
    if (room === 9 || room === 2 || room === 14 || room === 18) s.savedTime = g.ticks;
  },

  /**
   * `runCurrentChapter`, début du tour : le héros arrivé en (279, 101) dans la pièce 3 est ramené sur le chemin, et dans la pièce 14
   * il est écarté de la tête du pianiste (le jeu d'origine déplaçait le héros là où ses pieds ne passent pas devant lui).
   */
  frame(g: DrasculaEngine): Sequence | null {
    const hero = g.state.hero;
    const room = g.state.room?.number;
    const feet = hero.y + hero.height;
    if (room === 3 && hero.x === 279 && feet === 101) {
      return (function* () {
        yield* g.walkToPoint(178, 121);
        yield* g.walkToPoint(169, 135);
      })();
    }
    if (room === 14 && ((hero.x === 214 && feet === 121) || (hero.x === 246 && feet === 112))) {
      return (function* () {
        hero.walkToObject = true;
        yield* g.walkToPoint(190, 130);
      })();
    }
    return null;
  },
};
