import { animate } from "../../../cinematics/player";
import { placeIgor } from "../../../render/actors";
import { HALF_PAL } from "../../../render/palette";
import { IgorType } from "../../../render/heads";
import type { DrasculaEngine } from "../../loop";
import { toggleDoor } from "../../room-kit";
import { type Sequence } from "../../../../../engine/sequence";
import { delay, pause } from "../../cadence";
import { Track, Verb } from "../../state";
import { drawBedroomPre } from "./bedroom-view";
import { DoorIndex, Flag, Item } from "./ids";

/**
 * Le déguisement en Drascula : `animation_5_4`, `animation_6_4` et `animation_7_4` (engines/drascula/animation.cpp, ScummVM), avec le
 * test commun aux trois pièces où l'on prend l'un des trois objets du déguisement (`room_23`, `room_30`, `room_35`).
 *
 * Réunir les frites (8), la farine (12) et la cape (16) lève le drapeau 18 : Igor quitte sa chambre (`animation_6_4`). Avec la
 * perruque (10, pièce 26), l'un de ces objets sur le héros lance `animation_5_4` : le héros se déguise, Igor est trompé, le héros
 * sort de la chambre. À l'arrivée sur le palier (24), `animation_7_4` (voir `index.ts`, `roomEntered`) retire le déguisement et donne
 * la clé du salon.
 */

/** Vitesse de `bio.bin`, la métamorphose. */
const DISGUISE_FPS = 14;
/** Objets du déguisement (retirés de l'inventaire par `animation_7_4`). */
const DISGUISE_ITEMS = [Item.Fries, Item.Wig, Item.Flour, Item.Cape] as const;

/**
 * Après la prise d'un des trois objets (frites, farine, cape) : s'ils sont tous pris, Igor s'en va (drapeau 18) et sa chambre est
 * montrée (`animation_6_4`). Les trois pièces testent chacune les deux autres drapeaux ; le test est le même.
 */
export function* afterDisguisePart(g: DrasculaEngine): Sequence {
  const flags = g.flags;
  if (flags[Flag.FriesTaken] === 1 && flags[Flag.FlourTaken] === 1 && flags[Flag.CapeTaken] === 1) flags[Flag.Ready] = 1;
  if (flags[Flag.Ready] === 1) yield* igorLeaves(g);
}

/**
 * `animation_6_4` : la chambre d'Igor (feuilles `aux26.alg` et `auxigor.alg`) est montrée en une image (1,8 s), Igor, de face, annonce
 * qu'il va dîner (réplique 26), puis la pièce reprend. ScummVM change `_roomNumber` en 26 le temps de la scène : ici la pièce chargée
 * est remplacée par une pièce 26 sans objets (ses rectangles de `roomPreUpdates` et ses painters servent à la réplique) et le héros
 * est masqué (`talk_igor` de face ne le dessine pas). La première image est dessinée à part, sans les rectangles de `roomPreUpdates`,
 * comme dans l'original (`update_26_pre` appelée seule). La palette n'est pas remise au niveau de lumière de la pièce
 * (`loadPic` seul, comme ScummVM).
 */
export function* igorLeaves(g: DrasculaEngine): Sequence {
  const gfx = g.gfx;
  const s = g.state;
  const hero = s.hero;
  const room = g.room;
  const heroVisible = hero.visible;
  const igor = { ...s.igor };
  try {
    gfx.clearRoom();
    gfx.loadPic(26, gfx.bg, HALF_PAL);
    gfx.loadPic("aux26.alg", gfx.draw3);
    gfx.loadPic("auxigor.alg", gfx.front);
    s.igor = { x: 104, y: 71, track: s.igor.track };
    gfx.canvas.copyBackground(gfx.bg, 0, 0, 0, 0, 320, 200);
    drawBedroomPre(gfx, gfx.canvas, s);
    placeIgor(gfx, s, gfx.canvas);
    gfx.owner = "canvas";
    yield* pause(40);
    s.room = { ...room, number: 26, objects: [] };
    hero.visible = false;
    gfx.owner = "room";
    yield* g.talkers.igor(26, IgorType.Front);
  } finally {
    s.room = room;
    hero.visible = heroVisible;
    s.igor = igor;
    gfx.loadPic(96, gfx.front);
    gfx.loadPic(room.disk, gfx.draw3);
    gfx.loadPic(room.number, gfx.bg, HALF_PAL);
    gfx.owner = "room";
  }
  g.selectVerb(Verb.None);
  g.updateRoom();
}

/**
 * `animation_5_4` : le héros, perruque, cape, farine et frites réunies, se déguise en Drascula derrière la porte de la chambre
 * (`bio.bin`) ; Igor, croyant son maître, s'excuse (réponses 29 et 30) ; le héros sort par la porte 107, qu'Igor avait fermée.
 * `anh_dr.alg` (le héros déguisé) remplace la feuille « de dos » le temps de la scène et `update_26` le dessine (drapeau 29).
 */
export function* disguise(g: DrasculaEngine): Sequence {
  const gfx = g.gfx;
  const s = g.state;
  const hero = s.hero;
  hero.track = Track.Down;
  gfx.loadPic("anh_dr.alg", gfx.back);
  yield* g.walkToPoint(99, 160);
  yield* g.walkToPoint(38, 177);
  hero.visible = false;
  g.updateRoom();
  yield* delay(800);
  yield* animate(g, "bio.bin", DISGUISE_FPS);
  s.flags[Flag.Disguised] = 1;
  hero.x = 95;
  hero.y = 82;
  g.updateRoom();
  yield* toggleDoor(g, Flag.DoorBedroom, DoorIndex.BedroomDoor, "open");
  gfx.loadPic("auxigor.alg", gfx.front);
  s.igor.x = 100;
  s.igor.y = 65;
  yield* g.talkers.igor(29, IgorType.Front);
  yield* g.talkers.igor(30, IgorType.Front);
  // Dans ScummVM, `fadeToBlack` ne change que la palette : `talk_igor` de face ne finit pas par `updateRoom`, l'écran garde donc la
  // dernière image de la réplique (Igor, son sous-titre, le héros déguisé), alors que `front` et `back` sont déjà rechargées. Ici
  // l'image est recomposée à chaque rendu : on garde celle de la réplique (le painter de la pièce 26 lit `back`, que `loadPic(99)`
  // remplace) jusqu'au retour de la main à la pièce par `exitRoom`.
  g.holdScreen();
  gfx.loadPic(96, gfx.front);
  gfx.loadPic(99, gfx.back);
  hero.visible = true;
  yield* g.fadeToBlack(0);
  yield* g.exitRoom(DoorIndex.BedroomDoor);
}

/**
 * `animation_7_4` : sur le palier, le héros quitte son déguisement (écran noir, réplique 427, fondu) ; les quatre objets du
 * déguisement sont retirés de l'inventaire, la clé du salon (17) est ajoutée, Igor n'a plus la porte à clé.
 */
export function* undress(g: DrasculaEngine): Sequence {
  g.black();
  yield* g.talk(427);
  yield* g.fadeFromBlack(1);
  for (const item of DISGUISE_ITEMS) g.removeObject(item);
  g.addObject(Item.LivingRoomKey);
  g.flags[Flag.BedroomLocked] = 0;
  g.flags[Flag.Disguised] = 0;
}
