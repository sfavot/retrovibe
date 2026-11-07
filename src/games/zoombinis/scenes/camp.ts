/**
 * Écrans 4 et 5 : les camps de base (`BASECAMP.MHK` « l'abri du rocher », `BCTWO.MHK` « l'aire de grozarbre », `docs/zoombinis/screens.md` §3.3).
 * Portage de `10b0:0027` (Enter), `10b0:0620` (Exit), `10b0:073d` (Tick), `10b0:0819` (clic sur un bouton), `10b0:0a2a` (clic ailleurs :
 * glisser-déposer, décor), `10b0:0fb3` (touches : aucune), `10b0:0fc1` (boutons), `10b0:14fc` (dessin du présentoir), `10b0:1217` (emplacement le plus
 * proche), `10b0:1381` (défilement), `10b0:171b` / `17b1` / `17df` / `18cc` (bornes et décalage du présentoir), `10b0:19b4` (son du défilement) et
 * `10b0:1ac9` (versement des arrivants), et de leurs jumeaux `10b8:*` (même code, autres tables : `docs/zoombinis/engine-ts.md`, « Camps »).
 *
 * Décor. Fond et palette `1000` (`BASECAMP`) ou `5000` (`BCTWO`) ; deux planches de formes (1100 et 1200 / 6000 et 7000) ; les 16 `SCRB` d'emplacement
 * (1200 à 1215 / 7000 à 7015, images fixes) ; les objets animés au clic ; puis, de l'arrière vers l'avant, le présentoir (grille, Zoombinis restés en
 * arrière, lattes, cadre), les boutons (sorties, carte, 4 flèches) et les Zoombinis du groupe sur leurs 16 places.
 *
 * Constats de lecture du code (qui complètent `screens.md` §3.3) :
 *  - les 16 places du groupe sont les positions passées aux 16 features d'emplacement (`DS:06e4` / `DS:0930`) ; à l'arrivée d'un groupe de survivants, les
 *    trois quarts de ses membres sont déjà debout sur leurs places et le dernier quart entre à pied par la gauche (`1168:2505` : départ en `x = −50`, démarrage
 *    échelonné `1168:274e(30, 45)`, du dernier au premier) ; sans survivant (retour de la carte, partie chargée) tous sont debout, sans marcher ;
 *  - le présentoir est une grille de 5 colonnes de 5 Zoombinis (une colonne = 5 entrées consécutives de la réserve) ; chaque appui sur une flèche fait
 *    défiler d'une colonne (« pas de 1 ») ou de cinq (« pas de 5 ») ; la flèche tenue répète, avec une image intermédiaire (30 cases décalées d'une demi-colonne,
 *    `DS:0496`) entre deux colonnes ; défiler à gauche de la première colonne décale tout le présentoir d'une colonne vide (`10b0:17df`) ; le son 2000 joue
 *    tant que le défilement est possible, 2001 à l'arrêt (`10b0:19b4`) ;
 *  - chaque Zoombini affiché range dans son entrée de réserve le rectangle où il est dessiné (`10b0:14fc`, copie de 8 octets en `entrée + 8`) : c'est lui
 *    que `10b0:1217` cherche sous le pointeur ; un emplacement libre est choisi par le plus grand recouvrement du Zoombini lâché avec une case de 60 × 60
 *    centrée sur sa position ;
 *  - prendre : appui sur un Zoombini du présentoir (l'entrée est vidée tout de suite, le personnage suit le pointeur) ; reposer : lâcher sur le présentoir (case
 *    libre la plus proche) ; lâcher un Zoombini pris au présentoir hors d'une place du groupe le rend à son entrée ; la sortie n'est possible qu'avec 16
 *    Zoombinis au groupe (`campExitAllowed`) ; sinon une phrase d'aide ;
 *  - une sortie accepte : son 996, bouton enfoncé 2 ticks, tous les présents partent à pied vers la droite, hors de l'écran (`1168:2982` : destination (680, `y`)), du dernier au
 *    premier, `y` = 316 pour la première sortie et 400 pour la seconde), et l'écran change quand le son 996 est fini (un clic le provoque tout de suite) ;
 *  - le camp 2 n'a qu'une sortie (écran 16) ; son décor est un jeu de 10 zones de clic qui rejouent ou changent le script d'une feature (`10b8:0a0c`), sans état
 *    mémorisé dans la partie, alors que les 5 objets du camp 1 (champignons, `SCRB` 1111 à 1115) mémorisent leur image dans `S+0x14` (`10b0:0a2a`).
 *
 * Écarts : le glisser-déposer d'un Zoombini du groupe le rend à sa place s'il n'est lâché ni sur le présentoir ni près d'une place libre (l'original lance
 * `1168:1742`, dont les zones de dépôt `1520:00fc` ne sont pas déclarées par ces écrans : le rayon de 36 points est choisi) ; pas de surbrillance des places
 * pendant le glissement ; pas d'animation d'attente ; le curseur n'est pas changé ; l'arrêt du son 2000 coupe tous les effets (pas d'arrêt par identifiant) ;
 * tri devant / derrière des décors (`11a8:231b`) non porté (les Zoombinis sont au-dessus de tout le décor) ; les champignons ne sont pas créés par `10b0:0027`
 * (**hypothèse** : ils le sont ailleurs, leur image mémorisée est restituée à l'entrée) ; aucune musique n'est lancée par ces écrans (aucun appel dans `10b0:0027`).
 */
import type { Shape } from "../../../data/mohawk/shap";
import { drawShape } from "../../../engine/mohawk/graphics/blit";
import type { Surface } from "../../../engine/mohawk/graphics/surface";
import type { Archive } from "../../../engine/mohawk/resources";
import type { Point } from "../data/zoombini";
import { DIALOG } from "../engine/dialog";
import { FEATURES, FeatureFlag, type Feature, type Features } from "../engine/features";
import { ZOOMBINIS_GAME } from "../engine/game";
import type { Scene, SceneContext } from "../engine/scene";
import { ScreenId } from "../engine/scene";
import { ZOOMBINIS_SOUND } from "../engine/sound";
import { currentLevel, dialogMemoryIndex } from "../game/route";
import { ZOOMBINI_TYPES, isOccupied, type GameState, type GroupBuffer, type Reserve, type Zoombini } from "../game/state";
import {
  campArrive,
  campEndGame,
  campExitAllowed,
  campGroupReserve,
  campLeave,
  campReserve,
  findShelfEntry,
  putOnShelf,
  reserveEnd,
  setSlotRect,
  takeFromShelf,
  type Camp,
  type Rect,
} from "../game/team";
import { closeScreen, openScreen } from "./screen-kit";
import { createSnoid, type Snoid } from "./snoid";
import { dialogChoice } from "./xfer";

// ---------------------------------------------------------------------------------------------------------------------------
// Constantes communes

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const contains = (box: Box, x: number, y: number): boolean => x >= box.x1 && x < box.x2 && y >= box.y1 && y < box.y2;
const box = (x1: number, y1: number, x2: number, y2: number): Box => ({ x1, y1, x2, y2 });

/** Sons de l'écran : défilement du présentoir (`10b0:19b4`), départ (`0x3e4`), carte (999) ; les phrases viennent de `ZOOMBINI.MHK` (20000 et plus). */
const SOUND_SCROLL = 2000;
const SOUND_SCROLL_END = 2001;
const SOUND_GO = 996;
const SOUND_MAP = 999;

/** Ticks d'enfoncement d'un bouton (`1090:00c1(1, 0, 2, 0, 0)`) et pas du défilement (délai de la feature `10b0:1381`). */
const PRESS_TICKS = 2;
const SCROLL_TICKS = 6;
/** Défilement : lignes (colonnes de 5) mini et maxi du présentoir, `0x79` de `10b0:1381`. */
const MIN_ROWS = 10;
const MAX_SCROLL = 0x78;
/** Demi-largeur d'une case du présentoir (`10b0:1217` : ±0x1e) et seuil de recouvrement (0x271 = 625 points²). */
const CELL_HALF = 30;
/** Cases affichées : 5 colonnes de 5, plus une colonne pendant un défilement. */
const COLUMNS = 5;
const ROWS = 5;
/** Les Zoombinis du présentoir sont dessinés autour de la position de la case : écart du point d'ancrage du personnage au centre de la case (mesuré sur le rendu : l'ancre est un peu sous le milieu du corps). */
const SHELF_FEET = 3;
/** Rayon (points) de recherche d'une place libre quand un Zoombini est lâché (voir l'écart décrit en tête). */
const DROP_RADIUS = 36;
/** Arrivée à pied : départ hors écran (`+0xd6 = 0xffce`), délais `1168:274e(30, 45)`. */
const ENTRY_X = -50;
const ARRIVAL_FIRST = 30;
const ARRIVAL_GAP = 45;
/** Départ : cible hors écran à droite (`1168:2982` : `+0x116` = x = 0x2a8, `+0x118` = y de la sortie) et écart entre deux départs. */
const EXIT_X = 0x2a8;
const EXIT_GAP = 45;

/** Les 16 features d'emplacement : images fixes jouées une fois dès la création (`0x108a000`). */
const PLACE_FLAGS = FeatureFlag.staticFirst | FeatureFlag.noReplay | FeatureFlag.active | FeatureFlag.firstImage;
const { staticFirst, stopAtEnd, noReplay, active, random, queueScript, stopEachImage } = FeatureFlag;
/** Drapeaux inconnus du lecteur de features : `0x1000` (feature 1107 de `BASECAMP`), `0x50000000` (1110) et `0x4000000` (6002, 6004, 6006 à 6008 de `BCTWO`). */
const UNREAD_1000 = 0x1000;
const UNREAD_5 = 0x50000000;
const UNREAD_4 = 0x4000000;

// ---------------------------------------------------------------------------------------------------------------------------
// Données de chaque camp

/** Un objet de décor qui se rejoue ou change de script quand on clique dans une zone (`10b0:0a2a` fin, `10b8:0a0c`). */
interface Hotspot {
  zone: Box;
  /** Rang de la feature dans `Decor.features`. */
  feature: number;
  /** Comportement : rejouer (`restart`), enchaîner trois scripts (`cycle`), alterner deux scripts (`toggle`), une seule fois puis image finale (`once`). */
  kind: "restart" | "cycle" | "toggle" | "once";
}

interface FeatureSpec {
  script: number;
  delay: number;
  flags: number;
}

/** Ce qu'il faut pour afficher un présentoir : formes (indices à partir de 1) et positions de `DS:0638…` / `DS:0958…`. */
interface ShelfArt {
  /** Zone sensible : le présentoir (`DS:05a8` / `DS:0870`). */
  zone: Box;
  /** Grille (au repos puis pendant un défilement), lattes qui la recouvrent, cadre : indices dans `shapes` (1 à 5). */
  base: Point;
  overlayRest: Point;
  overlayScroll: Point;
  frame: Point;
  /** `x` de chaque colonne au repos (5) et pendant un défilement (6) ; `y` de chaque case, par colonne (5 × 5 et 6 × 5). */
  columnsX: readonly number[];
  columnsXScroll: readonly number[];
  rowsY: readonly (readonly number[])[];
  rowsYScroll: readonly (readonly number[])[];
}

interface ButtonSpec {
  box: Box;
  /** Image (à partir de 1) au repos ; la suivante est « enfoncé » ; `disabled` : image si la sortie est refusée. */
  image: number;
  disabled?: number;
}

interface CampSpec {
  camp: Camp;
  screen: ScreenId;
  archive: string;
  background: number;
  /** Planches de formes et plages de `SCRB` (`11a0:0000`, `11a8:14ab`, `11a8:15a6`). */
  groups: readonly { sheet: number; first: number; count: number }[];
  /** Les 16 places du groupe et le premier `SCRB` d'emplacement. */
  places: readonly Point[];
  placeScript: number;
  shelf: ShelfArt;
  /** Boutons : sorties (1 et 2), carte, quatre flèches. */
  exits: readonly { button: ButtonSpec; target: ScreenId; y: number }[];
  map: ButtonSpec;
  arrows: readonly ButtonSpec[];
  /** Formes du présentoir (indices 1 à 5) et des boutons (1 à 16) : ids de `tBMP` de la planche ou des images isolées. */
  shelfShapes(archive: Archive): readonly Shape[];
  buttonShapes(archive: Archive): readonly Shape[];
  /** Décor animé : créé après les emplacements. */
  decor: DecorSpec;
}

interface DecorSpec {
  /** Features créées dans l'ordre de `10b0:0027` / `10b8:0030`, après les 16 emplacements. */
  features: readonly FeatureSpec[];
  /** Rangs (dans `features`) des objets sans zone de clic (arrière-plan, premier plan). */
  hotspots: readonly Hotspot[];
  /** `BASECAMP` : les 5 objets à image mémorisée (scripts, sons) ; `BCTWO` : aucun. */
  mushrooms?: { first: number; count: number; sound: number };
  /** `BASECAMP` : la feature qui se rejoue au clic en file (1104 puis 1105). */
  insect?: { script: number; reaction: number };
}

const BASECAMP_PLACES: readonly Point[] = [
  { x: 404, y: 334 }, { x: 389, y: 354 }, { x: 362, y: 339 }, { x: 350, y: 363 }, { x: 323, y: 348 }, { x: 304, y: 367 }, { x: 280, y: 350 }, { x: 262, y: 368 },
  { x: 238, y: 346 }, { x: 221, y: 366 }, { x: 193, y: 352 }, { x: 176, y: 371 }, { x: 152, y: 351 }, { x: 133, y: 369 }, { x: 110, y: 341 }, { x: 94, y: 361 },
];

const BCTWO_PLACES: readonly Point[] = [
  { x: 490, y: 372 }, { x: 458, y: 359 }, { x: 450, y: 384 }, { x: 412, y: 376 }, { x: 393, y: 398 }, { x: 365, y: 386 }, { x: 348, y: 405 }, { x: 321, y: 389 },
  { x: 304, y: 410 }, { x: 278, y: 397 }, { x: 264, y: 417 }, { x: 234, y: 400 }, { x: 218, y: 420 }, { x: 197, y: 398 }, { x: 177, y: 418 }, { x: 152, y: 403 },
];

/** `BASECAMP` : `0x1180000` etc., relevés dans `10b0:0027` (1106, 1108, 1109, 1110, 1107, 1104, puis 1100 à 1103 ; délai 6 sauf 0 pour 1100 à 1103). */
const BASECAMP_DECOR: DecorSpec = {
  features: [
    { script: 1106, delay: 6, flags: staticFirst | stopAtEnd | noReplay },
    { script: 1108, delay: 6, flags: staticFirst | stopAtEnd | noReplay },
    { script: 1109, delay: 6, flags: stopAtEnd | noReplay },
    { script: 1110, delay: 6, flags: UNREAD_5 | stopAtEnd | noReplay },
    { script: 1107, delay: 6, flags: staticFirst | stopAtEnd | UNREAD_1000 },
    { script: 1104, delay: 6, flags: random | queueScript },
    { script: 1100, delay: 0, flags: 0 },
    { script: 1101, delay: 0, flags: 0 },
    { script: 1102, delay: 0, flags: 0 },
    { script: 1103, delay: 0, flags: 0 },
  ],
  // `DS:06bc` : les cinq zones, dans l'ordre des poignées `DS:6e02…6e0a` (1106, 1108, 1109, 1110, 1107).
  hotspots: [
    { zone: box(527, 90, 562, 113), feature: 0, kind: "restart" },
    { zone: box(550, 119, 588, 128), feature: 1, kind: "restart" },
    { zone: box(589, 112, 639, 162), feature: 2, kind: "restart" },
    { zone: box(324, 287, 391, 323), feature: 3, kind: "restart" },
    { zone: box(25, 432, 122, 477), feature: 4, kind: "restart" },
  ],
  mushrooms: { first: 1111, count: 5, sound: 1118 },
  insect: { script: 1104, reaction: 1105 },
};

/** `BCTWO` : `10b8:0030`, dans l'ordre de création ; la dernière (6000) est la poignée `DS:6f4c`. Délai 6. */
const BCTWO_DECOR: DecorSpec = {
  features: [
    { script: 6005, delay: 6, flags: 0x188000 },
    { script: 6011, delay: 6, flags: 0x188000 },
    { script: 6010, delay: 6, flags: staticFirst | stopAtEnd | noReplay | active },
    { script: 6002, delay: 6, flags: UNREAD_4 | stopAtEnd | noReplay | active },
    { script: 6004, delay: 6, flags: UNREAD_4 | stopAtEnd | noReplay },
    { script: 6009, delay: 6, flags: staticFirst | stopAtEnd | noReplay | active },
    { script: 6006, delay: 6, flags: UNREAD_4 | 0x1000000 | stopAtEnd | noReplay | active },
    { script: 6007, delay: 6, flags: UNREAD_4 | 0x1000000 | stopAtEnd | noReplay | active },
    { script: 6008, delay: 6, flags: UNREAD_4 | 0x1000000 | stopAtEnd | noReplay | active },
    { script: 6000, delay: 6, flags: UNREAD_4 | 0x1000000 | stopAtEnd | noReplay | active },
  ],
  // `DS:08e0` : dix zones, poignée i = `DS:6f3a + 2 i` (6005, 6011, 6010, 6002, 6004, 6009, 6006, 6007, 6008, 6000).
  hotspots: [
    { zone: box(52, 290, 136, 332), feature: 0, kind: "restart" },
    { zone: box(469, 169, 521, 241), feature: 1, kind: "cycle" },
    { zone: box(499, 289, 566, 308), feature: 2, kind: "restart" },
    { zone: box(455, 301, 504, 319), feature: 3, kind: "toggle" },
    { zone: box(568, 304, 604, 320), feature: 4, kind: "restart" },
    { zone: box(570, 36, 624, 66), feature: 5, kind: "restart" },
    { zone: box(229, 304, 273, 317), feature: 6, kind: "restart" },
    { zone: box(242, 324, 292, 336), feature: 7, kind: "restart" },
    { zone: box(253, 348, 305, 361), feature: 8, kind: "restart" },
    { zone: box(520, 259, 545, 300), feature: 9, kind: "once" },
  ],
};

const BASECAMP_SPEC: CampSpec = {
  camp: 1,
  screen: ScreenId.baseCamp,
  archive: "BASECAMP.MHK",
  background: 1000,
  groups: [
    { sheet: 1100, first: 1100, count: 16 },
    { sheet: 1200, first: 1200, count: 16 },
  ],
  places: BASECAMP_PLACES,
  placeScript: 1200,
  shelf: {
    zone: box(55, 19, 255, 252),
    base: { x: 53, y: 6 },
    overlayRest: { x: 53, y: 12 },
    overlayScroll: { x: 53, y: 9 },
    frame: { x: 31, y: 0 },
    columnsX: [75, 115, 155, 195, 235],
    columnsXScroll: [55, 95, 135, 175, 215, 255],
    rowsY: [
      [39, 86, 133, 180, 227],
      [40, 87, 134, 181, 228],
      [39, 86, 133, 180, 227],
      [36, 83, 130, 177, 224],
      [31, 78, 125, 172, 219],
    ],
    rowsYScroll: [
      [37, 84, 131, 178, 225],
      [39, 86, 133, 180, 227],
      [40, 87, 134, 181, 228],
      [38, 85, 132, 179, 226],
      [34, 81, 128, 175, 222],
      [27, 74, 121, 168, 215],
    ],
  },
  // `DS:04ac + 0x24 k` : sortie 1 (k = 0, bac du père mathieu), sortie 2 (k = 1, nizibooms), carte (k = 2).
  exits: [
    { button: { box: box(599, 310, 638, 347), image: 1, disabled: 15 }, target: ScreenId.ferry, y: 0x13c },
    { button: { box: box(599, 386, 638, 423), image: 3, disabled: 16 }, target: ScreenId.fleens, y: 400 },
  ],
  map: { box: box(599, 348, 638, 385), image: 5 },
  arrows: [
    { box: box(19, 78, 35, 205), image: 7 },
    { box: box(35, 78, 52, 205), image: 9 },
    { box: box(257, 78, 273, 205), image: 11 },
    { box: box(273, 78, 290, 205), image: 13 },
  ],
  shelfShapes: (archive) => archive.tbmpImages(2000),
  buttonShapes: (archive) => archive.tbmpImages(2100),
  decor: BASECAMP_DECOR,
};

const BCTWO_SPEC: CampSpec = {
  camp: 2,
  screen: ScreenId.bcTwo,
  archive: "BCTWO.MHK",
  background: 5000,
  groups: [
    { sheet: 6000, first: 6000, count: 14 },
    { sheet: 7000, first: 7000, count: 16 },
  ],
  places: BCTWO_PLACES,
  placeScript: 7000,
  shelf: {
    zone: box(112, 0, 377, 293),
    base: { x: 140, y: 23 },
    overlayRest: { x: 141, y: 28 },
    overlayScroll: { x: 140, y: 25 },
    frame: { x: 101, y: 0 },
    columnsX: [163, 203, 243, 283, 323],
    columnsXScroll: [143, 183, 223, 263, 303, 343],
    rowsY: [
      [55, 102, 149, 196, 243],
      [55, 102, 150, 196, 243],
      [54, 102, 149, 196, 243],
      [52, 99, 146, 193, 240],
      [46, 93, 141, 187, 235],
    ],
    rowsYScroll: [
      [53, 100, 147, 194, 244],
      [55, 101, 148, 196, 243],
      [56, 103, 149, 196, 243],
      [54, 100, 147, 195, 242],
      [47, 97, 144, 191, 237],
      [43, 90, 138, 184, 231],
    ],
  },
  exits: [{ button: { box: box(599, 320, 638, 357), image: 1, disabled: 15 }, target: ScreenId.caves, y: 0x13c }],
  map: { box: box(599, 358, 638, 395), image: 5 },
  arrows: [
    { box: box(114, 121, 131, 208), image: 7 },
    { box: box(131, 117, 144, 205), image: 9 },
    { box: box(337, 107, 350, 195), image: 11 },
    { box: box(350, 110, 361, 198), image: 13 },
  ],
  shelfShapes: (archive) => [8000, 8001, 8002, 8003, 8004, 8005].map((id) => archive.tbmp(id)),
  buttonShapes: (archive) => Array.from({ length: 16 }, (_, i) => archive.tbmp(9000 + i)),
  decor: BCTWO_DECOR,
};

// ---------------------------------------------------------------------------------------------------------------------------
// Scènes

export function createBaseCampScene(): Scene {
  return createCampScene(BASECAMP_SPEC);
}

export function createBcTwoScene(): Scene {
  return createCampScene(BCTWO_SPEC);
}

function createCampScene(spec: CampSpec): Scene {
  let archive: Archive;
  let view: CampView | undefined;
  return {
    async load(ctx: SceneContext) {
      archive = await ctx.resources.open(spec.archive);
    },
    enter(ctx: SceneContext) {
      view = start(spec, ctx, archive);
    },
    leave(ctx: SceneContext) {
      view?.leave(ctx);
      view = undefined;
    },
    tick() {
      view?.tick();
    },
  };
}

type CampView = ReturnType<typeof start>;

/** Un Zoombini du groupe sur sa place. */
interface Occupant {
  zoombini: Zoombini;
  snoid: Snoid;
  /** Marche d'arrivée, de retour ou de départ : il ne peut pas être pris. */
  walking: boolean;
  /** Entrée du groupe à pied (compte pour `[9702]`). */
  arriving: boolean;
}

/** Glissement en cours : le personnage suit le pointeur. */
interface Drag {
  occupant: Occupant;
  /** Place d'origine du groupe, ou `null` pour un Zoombini pris au présentoir. */
  slot: number | null;
  /** Entrée vidée du présentoir (`slot` nul) : où il retourne s'il n'est pas accepté. */
  shelfIndex: number;
  lastX: number;
}

function start(spec: CampSpec, ctx: SceneContext, archive: Archive) {
  const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
  const initial = zoombinis.game;
  const { session } = zoombinis;
  const features: Features = ctx.services.get(FEATURES);
  const sound = ctx.services.get(ZOOMBINIS_SOUND);
  const { camp } = spec;
  const shelfShapes = spec.shelfShapes(archive);
  const buttonShapes = spec.buttonShapes(archive);
  const art = spec.shelf;
  const game = (): GameState => zoombinis.game;
  const reserve = (): Reserve => campReserve(game(), camp);

  openScreen(ctx, archive, { background: spec.background });
  spec.groups.forEach((group, k) => {
    features.defineGroup(k, group.sheet);
    if (k === 0) features.setScripts(group.first, group.count);
    else features.addScripts(group.first, group.count);
  });

  // --- État (`10b0:0000`, `10b0:0027`) ---
  /** `DS:6dda` : première colonne affichée ; `DS:6ddc` : nombre de colonnes de la réserve. */
  let scroll = reserve().scroll;
  let rows = MIN_ROWS;
  /** `DS:0494` : commande de défilement en cours (0 aucune, 1 à 4 les flèches) ; `DS:0496` : image intermédiaire ; `DS:6de4` : flèche tenue. */
  let command = 0;
  let half = false;
  let held = 0;
  let nextScroll = 0;
  /** `DS:6dec` : état du son de défilement. */
  let scrolling = false;
  let pressed: { id: string; until: number } | null = null;
  let left = false;
  let departure: { target: ScreenId; y: number } | null = null;
  let drag: Drag | null = null;
  const slots: (Occupant | null)[] = new Array<Occupant | null>(spec.places.length).fill(null);
  const pending: { tick: number; run: () => void }[] = [];
  let shelfSnoids: Snoid[] = [];
  let decor: Feature[] = [];
  const mushrooms: Feature[] = [];
  let insect: Feature | undefined;
  /** Camp 2 : bascule du script 6002 / 6003 (`DS:6f36`), une seule rejouée du 6000 (`DS:6f38`). */
  let toggled = false;
  let onceDone = false;

  // --- Décor (`10b0:0027`, `10b8:0030`) ---
  features.create({ script: 0, delay: 0, depth: 0, flags: 0, onAfterDraw: (_feature, screen) => paintShelfBase(screen) });
  spec.places.forEach((_place, i) => features.create({ script: spec.placeScript + i, delay: 7, flags: PLACE_FLAGS }));
  decor = spec.decor.features.map((params) => features.create(params));
  const mush = spec.decor.mushrooms;
  if (mush) {
    for (let k = 0; k < mush.count; k++) {
      const feature = features.create({ script: mush.first + k, delay: SCROLL_TICKS, flags: stopEachImage | FeatureFlag.firstImage });
      mushrooms.push(feature);
      // Image mémorisée (`S+0x14 + 2 k`) : la feature s'arrête sur la première image, puis rejoint la mémorisée au tick suivant.
      const state = initial.campDecor[k] ?? 0;
      if (state > 0) {
        features.seek(feature, state);
        feature.active = true;
      }
    }
  }
  if (spec.decor.insect) insect = decor.find((feature) => feature.scriptId === spec.decor.insect!.script);
  features.create({ script: 0, delay: 0, depth: 0.3, flags: 0, onAfterDraw: (_feature, screen) => paintShelfFront(screen) });
  features.create({ script: 0, delay: 0, depth: 0.5, flags: 0, onAfterDraw: (_feature, screen) => paintButtons(screen) });

  // --- Arrivée (`10b0:0027`) : réserve, groupe, présentoir ---
  const hadSurvivors = initial.group.members.some((member) => member.present);
  const arrival = campArrive(initial, camp);
  rows = rowsFor(reserve());
  setScroll(clampScroll(arrival.scroll));
  const walkingIn = hadSurvivors && !initial.options.lessAction;
  const standing = walkingIn ? Math.trunc((arrival.party.length * 3) / 4) : arrival.party.length;
  arrival.party.slice(0, spec.places.length).forEach((zoombini, rank) => {
    const place = spec.places[rank]!;
    const entering = rank >= standing;
    const snoid = createSnoid(ctx, zoombini, { position: entering ? { x: ENTRY_X, y: place.y } : place, depth: depthOf(place.y) });
    const occupant: Occupant = { zoombini, snoid, walking: entering, arriving: entering };
    slots[rank] = occupant;
    if (entering) {
      // Du dernier au premier : 30 ticks, puis 45 de plus pour chacun (`1168:274e(30, 45)`).
      const order = arrival.party.length - 1 - rank;
      const startTick = ctx.clock.ticks + ARRIVAL_FIRST + ARRIVAL_GAP * order;
      pending.push({ tick: startTick, run: () => walkIn(occupant, rank) });
    }
  });
  layoutShelf();

  /** Retire `storeGroup` des actions d'avant écriture (rien si la boîte de dialogue n'est pas installée). */
  const unhookSave = hookSave();
  announceArrival();
  features.invalidate();
  ctx.requestPresent();

  // ------------------------------------------------------------------------------------------------------------------------
  // Utilitaires

  function depthOf(y: number): number {
    return 1 + y / 1000;
  }

  /** Nombre de colonnes (`10b0:171b`) : fin de la réserve + 10 arrondi à 5 près, 50 à 625 entrées. */
  function rowsFor(r: Reserve): number {
    const entries = Math.min(ZOOMBINI_TYPES, Math.max(50, Math.trunc((reserveEnd(r) + 10) / 5) * 5));
    return entries / 5;
  }

  function clampScroll(value: number): number {
    return Math.max(0, Math.min(value, rows - 5));
  }

  function setScroll(value: number): void {
    scroll = value;
    reserve().scroll = scroll;
  }

  /** `10b0:171b` : bornes recalculées après un changement du présentoir. */
  function recompute(): void {
    rows = rowsFor(reserve());
    if (scroll > rows - 5) setScroll(rows - 5);
  }

  const partyMembers = (): Zoombini[] => slots.filter((o): o is Occupant => o !== null).map((o) => o.zoombini);
  const walkingArrivals = (): number => slots.filter((o) => o?.arriving).length;

  function exitAllowed(): boolean {
    return campExitAllowed(game(), camp, partyMembers().filter((z) => z.present).length);
  }

  function walkIn(occupant: Occupant, rank: number): void {
    occupant.snoid.onArrive = () => {
      occupant.walking = false;
      occupant.arriving = false;
    };
    occupant.snoid.walkTo(spec.places[rank]!);
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Phrase d'accueil (`10b0:0027` fin, `10b8:0030` fin) et d'aide

  function announceArrival(): void {
    const g = game();
    let choice = -1;
    const slot = dialogMemoryIndex(spec.screen);
    if (session.lastFinal !== 0) {
      const result = dialogChoice(g.dialogMemory[slot]!, currentLevel(g, session, spec.screen), session.training !== 0);
      g.dialogMemory[slot] = result.memory;
      choice = result.choice;
      session.lastFinal = 0;
    }
    const first = camp === 1 ? [ScreenId.ferry, ScreenId.fleens] : [ScreenId.caves];
    if (choice === 2 && first.every((screen) => g.dialogMemory[dialogMemoryIndex(screen)] === 0) && (camp === 1 ? g.counters.camp1 : g.counters.camp2) < 0x11) {
      choice = 1;
      g.dialogMemory[slot] = g.dialogMemory[slot]! & 0xcfff;
    }
    const wide = (g.dialogMemory[slot]! & 0x3000) !== 0;
    const pick = (max: number): number => ctx.rng.range(1, max);
    let id = 0;
    const ends = campEndGame(g, camp);
    if (camp === 1) {
      if (!ends) {
        if (choice === 0) id = [0, 0x4e51, 0x4e53, 0x4e55, 0x4e56, 0x4e52, 0x4e54][pick(wide ? 6 : 4)] ?? 0;
        else if (choice === 1 || choice === 5) id = 0x4e51;
        else if (choice === 2) id = 0x4e52;
        else if (choice === 0xc) id = 0x4e54;
      } else if (choice !== -1) {
        id = [0, 0x4e53, 0x4e55, 0x4e56][pick(3)] ?? 0;
      }
    } else if (choice === 0) {
      id = [0, 0x4e74, 0x4e75, 0x4e72, 0x4e73][pick(wide ? 4 : 3)] ?? 0;
    } else if (choice === 1 || choice === 5) {
      id = 0x4e72;
    } else if (choice === 2 || choice === 0xc) {
      id = 0x4e73;
    }
    if (id !== 0) sound.queue(id);
  }

  /** Phrase d'aide d'une sortie refusée (`10b0:0819` cas 1 et 2, `10b8:088c` cas 1). */
  function refuseExit(): void {
    const ends = campEndGame(game(), camp);
    let id: number;
    if (camp === 1) id = !ends ? 0x4e51 : ([0, 0x4e53, 0x4e55, 0x4e56][ctx.rng.range(1, 3)] ?? 0);
    else id = [0, 0x4e74, 0x4e75, 0x4e72][ctx.rng.range(1, 3)] ?? 0;
    if (id !== 0) sound.queue(id);
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Dessin (`10b0:14fc`, `10b0:0fc1`)

  function blit(screen: Surface, shapes: readonly Shape[], index: number, x: number, y: number, mode: 0 | 8): void {
    const shape = shapes[index - 1];
    if (shape) drawShape(screen, shape, x, y, mode);
  }

  function paintShelfBase(screen: Surface): void {
    blit(screen, shelfShapes, half ? 1 : 3, art.base.x, art.base.y, 0);
  }

  function paintShelfFront(screen: Surface): void {
    const at = half ? art.overlayScroll : art.overlayRest;
    blit(screen, shelfShapes, half ? 2 : 4, at.x, at.y, 8);
    blit(screen, shelfShapes, 5, art.frame.x, art.frame.y, 8);
  }

  function paintButton(screen: Surface, button: ButtonSpec, id: string, enabled = true): void {
    const down = pressed?.id === id;
    const image = enabled ? button.image + (down ? 1 : 0) : (button.disabled ?? button.image);
    blit(screen, buttonShapes, image, button.box.x1, button.box.y1, 8);
  }

  function paintButtons(screen: Surface): void {
    const allowed = exitAllowed();
    spec.exits.forEach((exit, i) => paintButton(screen, exit.button, `exit${i}`, allowed));
    paintButton(screen, spec.map, "map");
    spec.arrows.forEach((arrow, i) => paintButton(screen, arrow, `arrow${i}`));
  }

  function press(id: string): void {
    pressed = { id, until: ctx.clock.ticks + PRESS_TICKS };
    features.invalidate();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Présentoir

  /** Position de la case `k` (colonne `k / 5`, ligne `k % 5`), au repos ou pendant un défilement. */
  function cellCenter(k: number): Point {
    const column = Math.trunc(k / ROWS);
    const row = k % ROWS;
    return half ? { x: art.columnsXScroll[column]!, y: art.rowsYScroll[column]![row]! } : { x: art.columnsX[column]!, y: art.rowsY[column]![row]! };
  }

  /** Les 25 cases au repos, pour chercher un emplacement libre (`10b0:1217`, 60 × 60 autour de la case). */
  function cellRects(): Rect[] {
    return Array.from({ length: COLUMNS * ROWS }, (_unused, k) => {
      const c = { x: art.columnsX[Math.trunc(k / ROWS)]!, y: art.rowsY[Math.trunc(k / ROWS)]![k % ROWS]! };
      return [c.x - CELL_HALF, c.y - CELL_HALF, c.x + CELL_HALF, c.y + CELL_HALF] as const;
    });
  }

  /** Redessine le présentoir (`10b0:14fc`) : un personnage par entrée occupée de la page, dont le rectangle est rangé dans l'entrée. */
  function layoutShelf(): void {
    for (const snoid of shelfSnoids) snoid.destroy();
    shelfSnoids = [];
    const r = reserve();
    const total = rows * 5;
    const count = half ? 30 : 25;
    for (let k = 0; k < count; k++) {
      const entry = r.entries[(scroll * 5 + k) % total] ?? null;
      if (!isOccupied(entry)) continue;
      const cell = cellCenter(k);
      const snoid = createSnoid(ctx, { attrs: entry.attrs, state: entry.state }, { position: { x: cell.x, y: cell.y + SHELF_FEET }, depth: 0.2 });
      shelfSnoids.push(snoid);
      const rect = snoid.feature.rect;
      if (rect && !half) setSlotRect(entry, [rect.left, rect.top, rect.right, rect.bottom]);
    }
    features.invalidate();
  }

  /** `10b0:17df` : la première colonne est occupée et la dernière libre : tout le présentoir recule d'une colonne (une colonne vide apparaît à gauche). */
  function insertFrontPage(): void {
    const r = reserve();
    if (rows >= 125) return;
    if (!r.entries.slice(0, 5).some((e) => isOccupied(e))) return;
    if (r.entries.slice(ZOOMBINI_TYPES - 5).some((e) => isOccupied(e))) return;
    for (let i = ZOOMBINI_TYPES - 6; i >= 0; i--) {
      r.entries[i + 5] = r.entries[i] ?? null;
      r.entries[i] = null;
    }
    rows = rowsFor(r);
    setScroll(scroll + 1);
    soundScroll(false);
  }

  /** `10b0:1381` : un pas de défilement (toutes les 6 ticks), `command` 1 à 4 = flèches (−5, −1, +1, +5). */
  function scrollStep(): void {
    if (command === 0) return;
    // Commandes 1 et 4 : cinq pas (sauf s'il n'y a pas de quoi défiler et que l'image n'est pas intermédiaire) ; 2 et 3 : un pas.
    let n = 1;
    if (command === 1) n = !half && scroll < 5 ? 0 : 5;
    else if (command === 4) n = !half && rows - 5 < scroll + 5 ? 0 : 5;
    if (command === 1 || command === 2) {
      // `10b0:17df` n'est appelé que pour une demande de défilement (pas pendant l'image intermédiaire : la décompilation le fait aussi, ce qui ferait rebondir la page).
      if (n !== 0 && scroll === 0 && !half) insertFrontPage();
      for (; n !== 0; n--) {
        if (!half && scroll > 0) {
          setScroll(scroll - 1);
          half = true;
        } else {
          half = false;
        }
      }
    } else if (command === 3 || command === 4) {
      for (; n !== 0; n--) {
        if (!half) {
          if (scroll + 1 < 0x79 && scroll < rows - 5) half = true;
        } else {
          half = false;
          let next = scroll + 1;
          if (next >= rows - 5) {
            next = Math.min(rows - 5, MAX_SCROLL);
            n = 1;
          }
          setScroll(next);
        }
      }
    }
    if (!half) command = 0;
    layoutShelf();
  }

  /** `10b0:19b4` : son de défilement ; `final` : relâchement de la flèche. */
  function soundScroll(final: boolean): void {
    if (command < 0) return;
    let can = false;
    switch (command) {
      case 1:
        can = scroll > 4;
        break;
      case 2:
        can = scroll > 0;
        break;
      case 3:
        can = scroll < rows - 5 && scroll + 1 < 0x79;
        break;
      case 4:
        can = scroll < rows - 9 && scroll + 5 < 0x79;
        break;
      default:
        break;
    }
    let id = 0;
    if (scrolling !== can) {
      scrolling = can;
      id = can ? SOUND_SCROLL : SOUND_SCROLL_END;
    }
    if (final) {
      if (scrolling) id = SOUND_SCROLL_END;
      scrolling = false;
    }
    if (id === 0) return;
    if (id === SOUND_SCROLL_END) sound.stopEffects();
    sound.queue(id);
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Sorties (`10b0:0819`, `10b0:0620`)

  function leaveTo(screen: ScreenId, toMap: boolean): void {
    if (left) return;
    left = true;
    campLeave(game(), session, camp, partyMembers(), toMap);
    compactShelf();
    zoombinis.goTo(ctx, screen);
  }

  /** `10b0:18cc` : à la sortie, les colonnes vides en tête (au-delà d'une) sont supprimées. */
  function compactShelf(): void {
    const r = reserve();
    let empty = -5;
    for (let i = 0; i < ZOOMBINI_TYPES; i++) {
      if (isOccupied(r.entries[i] ?? null)) break;
      empty++;
    }
    if (empty <= 4) return;
    const shift = Math.trunc(empty / 5) * 5;
    if (shift === 0) return;
    for (let i = shift; i < ZOOMBINI_TYPES; i++) {
      r.entries[i - shift] = r.entries[i] ?? null;
      r.entries[i] = null;
    }
    r.scroll = Math.max(0, r.scroll - shift / 5);
  }

  function clickExit(index: number): void {
    const exit = spec.exits[index]!;
    if (!exitAllowed()) {
      refuseExit();
      return;
    }
    sound.stopEffects();
    sound.queue(SOUND_GO);
    press(`exit${index}`);
    // Tous les présents partent à pied vers le bas de l'écran, du dernier au premier (`1168:2982(45, 0, x, 0x2a8)`).
    const members = slots.map((occupant, rank) => ({ occupant, rank })).filter((entry): entry is { occupant: Occupant; rank: number } => entry.occupant !== null);
    members.sort((a, b) => b.rank - a.rank);
    members.forEach(({ occupant }, order) => {
      pending.push({
        tick: ctx.clock.ticks + EXIT_GAP * order,
        run: () => {
          occupant.walking = true;
          occupant.snoid.walkTo({ x: EXIT_X, y: exit.y });
        },
      });
    });
    departure = { target: exit.target, y: exit.y };
  }

  function clickMap(): void {
    sound.stopEffects();
    sound.queue(SOUND_MAP);
    press("map");
    leaveTo(ScreenId.map, true);
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Glisser-déposer (`10b0:0a2a`)

  function snoidAt(x: number, y: number): { occupant: Occupant; slot: number } | null {
    let found: { occupant: Occupant; slot: number } | null = null;
    slots.forEach((occupant, slot) => {
      const rect = occupant?.snoid.feature.rect;
      if (!occupant || !rect || occupant.walking) return;
      if (x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) {
        if (!found || occupant.snoid.depth >= found.occupant.snoid.depth) found = { occupant, slot };
      }
    });
    return found;
  }

  function beginDrag(occupant: Occupant, slot: number | null, shelfIndex: number, x: number, y: number): void {
    drag = { occupant, slot, shelfIndex, lastX: x };
    features.restack(occupant.snoid.feature, 3);
    occupant.snoid.moveTo({ x, y });
  }

  /** Appui sur un Zoombini du présentoir (`10b0:0a2a` cas 1) : l'entrée est vidée tout de suite, le personnage suit le pointeur. */
  function pickFromShelf(x: number, y: number): boolean {
    if (!contains(art.zone, x, y) || walkingArrivals() > 0) return false;
    const index = findShelfEntry(reserve(), scroll, cellRects(), { mode: "occupied", x, y });
    if (index < 0) return false;
    const zoombini = takeFromShelf(game(), camp, index);
    if (!zoombini) return false;
    recompute();
    layoutShelf();
    const snoid = createSnoid(ctx, zoombini, { position: { x, y }, depth: 3 });
    beginDrag({ zoombini, snoid, walking: false, arriving: false }, null, index, x, y);
    return true;
  }

  function nearestFreePlace(point: Point, own: number | null): number {
    let best = -1;
    let bestDistance = DROP_RADIUS * DROP_RADIUS;
    spec.places.forEach((place, i) => {
      if (slots[i] !== null && i !== own) return;
      const d = (place.x - point.x) ** 2 + (place.y - point.y) ** 2;
      if (d <= bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    return best;
  }

  /** Lâcher (`10b0:0a2a`, `1168:1742`) : présentoir (case libre la plus proche), place libre du groupe, sinon retour à l'origine. */
  function drop(x: number, y: number): void {
    const dragged = drag;
    if (!dragged) return;
    drag = null;
    const { occupant } = dragged;
    occupant.snoid.moveTo({ x, y });
    const rect = occupant.snoid.feature.rect;
    const zone = art.zone;
    if (rect && rect.left < zone.x2 && rect.right > zone.x1 && rect.top < zone.y2 && rect.bottom > zone.y1) {
      const index = findShelfEntry(reserve(), scroll, cellRects(), { mode: "free", drop: [rect.left, rect.top, rect.right, rect.bottom] });
      if (index >= 0 && putOnShelf(game(), camp, occupant.zoombini, index)) {
        if (dragged.slot !== null) slots[dragged.slot] = null;
        occupant.snoid.destroy();
        recompute();
        layoutShelf();
        return;
      }
    }
    const place = nearestFreePlace({ x, y }, dragged.slot);
    if (place >= 0) {
      if (dragged.slot !== null && dragged.slot !== place) slots[dragged.slot] = null;
      slots[place] = occupant;
      settle(occupant, place);
      return;
    }
    if (dragged.slot !== null) {
      settle(occupant, dragged.slot);
      return;
    }
    // Pris au présentoir et lâché nulle part : il retourne à son entrée.
    putOnShelf(game(), camp, occupant.zoombini, dragged.shelfIndex);
    occupant.snoid.destroy();
    recompute();
    layoutShelf();
  }

  /** Le Zoombini marche jusqu'à sa place (`+0xe6` = position d'origine). */
  function settle(occupant: Occupant, place: number): void {
    const where = spec.places[place]!;
    features.restack(occupant.snoid.feature, depthOf(where.y));
    occupant.walking = true;
    occupant.snoid.onArrive = () => {
      occupant.walking = false;
    };
    occupant.snoid.walkTo(where);
  }

  function dragTo(x: number, y: number): void {
    if (!drag) return;
    const sx = Math.max(0, Math.min(639, x));
    const sy = Math.max(0, Math.min(479, y));
    if (sx < drag.lastX) drag.occupant.snoid.setFacing(1);
    else if (sx > drag.lastX) drag.occupant.snoid.setFacing(0);
    drag.lastX = sx;
    drag.occupant.snoid.moveTo({ x: sx, y: sy });
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Décor (`10b0:0a2a` fin, `10b8:0a0c`)

  const under = (feature: Feature, x: number, y: number): boolean => {
    const rect = feature.rect;
    return rect !== null && x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
  };

  /** Clic hors boutons et hors Zoombinis. */
  function clickDecor(x: number, y: number): void {
    const spot = spec.decor;
    mushrooms.forEach((feature, k) => {
      if (!under(feature, x, y) || !mush) return;
      // L'image suivante, mémorisée dans la partie (`S+0x14 + 2 k`) : `(image + 1) % nombre d'images`.
      feature.active = true;
      game().campDecor[k] = (feature.image + 1) % (feature.last + 1);
      sound.queue(mush.sound + k);
    });
    if (mush && mushrooms.some((feature) => under(feature, x, y))) return;
    if (insect && spot.insect && under(insect, x, y)) {
      features.setScript(insect, spot.insect.reaction);
      return;
    }
    for (const hotspot of spot.hotspots) {
      if (!contains(hotspot.zone, x, y)) continue;
      const feature = decor[hotspot.feature];
      if (!feature || feature.active) return;
      switch (hotspot.kind) {
        case "cycle":
          features.setScript(feature, feature.scriptId === 6013 ? 6011 : feature.scriptId + 1);
          break;
        case "toggle":
          toggled = !toggled;
          features.setScript(feature, toggled ? 6003 : 6002);
          break;
        case "once":
          if (!onceDone) {
            features.setScript(feature, 0);
            onceDone = true;
            once = feature;
          }
          break;
        default:
          features.setScript(feature, 0);
      }
      return;
    }
  }

  /** `10b8:0771` : après la première animation du terrier, l'image finale reste (script 6001 en une image, `0x88000`). */
  let once: Feature | undefined;

  // ------------------------------------------------------------------------------------------------------------------------
  // Clics et tick

  function click(x: number, y: number): void {
    // `10b0:073d` : une sortie en attente est exécutée par le clic suivant.
    if (departure) {
      finishDeparture();
      return;
    }
    for (let i = 0; i < spec.arrows.length; i++) {
      if (!contains(spec.arrows[i]!.box, x, y)) continue;
      stopSpeaking();
      held = i + 1;
      command = i + 1;
      press(`arrow${i}`);
      soundScroll(false);
      return;
    }
    for (let i = 0; i < spec.exits.length; i++) {
      if (!contains(spec.exits[i]!.button.box, x, y)) continue;
      stopSpeaking();
      clickExit(i);
      return;
    }
    if (contains(spec.map.box, x, y)) {
      clickMap();
      return;
    }
    const grabbed = walkingArrivals() === 0 ? snoidAt(x, y) : null;
    if (grabbed) {
      stopSpeaking();
      beginDrag(grabbed.occupant, grabbed.slot, -1, x, y);
      return;
    }
    if (pickFromShelf(x, y)) {
      stopSpeaking();
      return;
    }
    clickDecor(x, y);
  }

  function stopSpeaking(): void {
    sound.stopEffects();
  }

  function finishDeparture(): void {
    const target = departure?.target;
    departure = null;
    if (target !== undefined) leaveTo(target, false);
  }

  // --- Enregistrement du groupe avant une écriture de la partie (`11a0:141e`) ---

  function storeGroup(): void {
    if (left || zoombinis.game !== initial) return;
    const target = campGroupReserve(game(), camp);
    const group: GroupBuffer = { members: partyMembers().map((z) => ({ ...z, attrs: [...z.attrs] as Zoombini["attrs"], state: z.state.slice() })), flagA: false, flagB: false };
    target.members = group.members;
    target.flagA = false;
    target.flagB = false;
  }

  function hookSave(): () => void {
    return ctx.services.tryGet(DIALOG)?.addBeforeSave(storeGroup) ?? (() => {});
  }

  return {
    tick(): void {
      const now = ctx.clock.ticks;
      if (pressed && now >= pressed.until && !(held !== 0 && pressed.id === `arrow${held - 1}` && ctx.input.isButtonDown("left"))) {
        pressed = null;
        features.invalidate();
      }
      for (let i = pending.length - 1; i >= 0; i--) {
        const entry = pending[i]!;
        if (entry.tick > now) continue;
        pending.splice(i, 1);
        entry.run();
      }
      if (left) return;
      for (const event of ctx.input.buttonEvents) {
        if (left) return;
        if (event.button !== "left") continue;
        if (event.down) click(event.x, event.y);
        else {
          if (drag) drop(event.x, event.y);
          if (held !== 0) {
            held = 0;
            soundScroll(true);
          }
        }
      }
      if (drag) {
        if (ctx.input.isButtonDown("left")) dragTo(ctx.input.mouseX, ctx.input.mouseY);
        else drop(ctx.input.mouseX, ctx.input.mouseY);
      }
      // Flèche tenue : la commande est réarmée à chaque tick (`10b0:0819` cas 4 à 7).
      if (held !== 0 && ctx.input.isButtonDown("left")) {
        command = held;
        press(`arrow${held - 1}`);
      }
      if (now >= nextScroll) {
        nextScroll = now + SCROLL_TICKS;
        scrollStep();
      }
      // L'objet à image finale du camp 2 (`10b8:0771`).
      if (once && !once.active) {
        features.setScript(once, 6001);
        once.flags = noReplay | active;
        once = undefined;
      }
      // Départ : tous les présents sont partis à pied ; l'écran change quand le son 996 est fini.
      if (departure && !left && sound.pending.effects === 0 && sound.effectsPlaying === 0) finishDeparture();
    },
    leave(leaveCtx: SceneContext): void {
      unhookSave();
      // Sortie par un autre chemin (partie chargée, nouvelle partie) : une partie remplacée ne reçoit pas le groupe de l'ancienne.
      if (!left && zoombinis.game === initial) {
        // Un glissement en cours est abandonné : le Zoombini pris au présentoir y retourne.
        if (drag && drag.slot === null) putOnShelf(game(), camp, drag.occupant.zoombini, drag.shelfIndex);
        campLeave(game(), session, camp, partyMembers(), false);
        compactShelf();
      }
      left = true;
      closeScreen(leaveCtx);
    },
  };

}

