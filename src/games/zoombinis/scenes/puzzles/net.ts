/**
 * Écran de la muraille de signes (`NET.MHK`, écran 15 ; tâche H11 de la vague H ; `docs/zoombinis/puzzles/net.md`). Les règles sont dans `game/puzzles/net.ts` ; ce fichier est le décor, la
 * catapulte et ses sélecteurs, la boule de boue, les groupes de Zoombinis qui passent le mur et les sorties, sur le kit commun (`puzzle-kit.ts`).
 *
 * Image : fond `tBMP` / palette `SHPL` 5000 (niveaux 0 et 1) ou 5001 (niveaux 2 et 3) ; groupes de formes 0 = `tBMP` 7000 (`SCRB` 7000–7047 : bulle de boue et bras, catapulte, boule, impact ;
 * ancres `REGS` 7000 / 7001), 1 = 8000 (`SCRB` 8000–8007 : réactions des colonnes, balançoire), 2 = 9000 (`SCRB` 9000–9153 : dalles, ancres `REGS` 9000 / 9001), 3 = 10000 (`SCRB` 10000–10018 :
 * bouton de tir et symboles des sélecteurs). Les boutons carte et « go » viennent de la planche 6000 (comme la hutte à pizza), dessinés par le kit.
 *
 * Déroulé (Enter `1120:0000`, Tick `1120:0554`, clic `1120:0f25`, réglage et tir `1120:1b9b`, vol `1120:2e87` / `2ff2`, impact `1120:248b`, rappel d'image `1120:213e`) :
 *  1. entrée : trois valeurs de sélecteurs tirées, mur tiré (le mur est construit tout de suite ici ; l'original attend la fin de l'animation de la muraille `SCRB` 9151 / 9153), groupe qui arrive à pied
 *     (0 puis 30 ticks), la bulle de boue se remplit (`SCRB` 7001 + k, une boule par étape) pendant que les dalles marquées apparaissent ;
 *  2. « rechargement » (`8b5a…8b64`) : le bras prend une boule dans la bulle (7031 + niveau de la bulle), la catapulte enchaîne 7018, 7025, 7026 (et 7027 aux niveaux 2 et 3) et envoie le prochain
 *     Zoombini à la balançoire ; à la fin les clics sont permis (`[89e0] = 0`) et le bouton de tir clignote (10017) ;
 *  3. sélecteurs (régions 4 à 18) : le symbole choisi s'allume (`SCRB` 10002 + v, 10007 + v, 10012 + v) et la boule de la catapulte prend ses couleurs et sa forme (rappel d'image `213e`, tables
 *     `DS:1a2c` / `1a36`) ; seulement quand aucun tir n'est en cours (`[8b8c]`) ;
 *  4. tir (région 3, `(450, 275)–(587, 362)`) : accepté si ni verrou de tir (`[8ba6]`, `[8b8c]`) ni fin des munitions (`[8b6c]`) ; la dalle visée est connue tout de suite (`aim`), la catapulte joue 7028
 *     (colonnes 1 à 3), 7029 (colonne 0) ou 7030 (colonne 4) ; à l'événement 3 la boule part de (484, 318) et atteint la dalle en cinq pas de 3 ticks, puis impact (`SCRB` 7023 / 7024 sur la dalle) ;
 *  5. à la fin de la catapulte : munition de moins (`endOfShot`), puis, si un groupe est libéré, chaque Zoombini libéré passe : la colonne réagit (`SCRB` 8000 + colonne), la balançoire joue 8005 + place (la
 *     boulette tombe, événement 21) et le Zoombini de cette place saute (`SCRS` 13016 +…), vole au-dessus du mur (14000 + place), est reçu de l'autre côté (13031 +…) puis rejoint le point de la file d'arrivée
 *     (`1468:01F4`) ; après la balançoire du dernier du groupe, les suivants montent à la balançoire (`SCRS` 13001 +…, depuis (233, 392)), s'y retournent (événement 0) et
 *     attendent (`1168:4231(0, 2)`) ; la fin de la montée rend le tir (`1120:2900`, `8ba6 = 0`) ;
 *  6. « go » devient actif au premier arrivé ; il sauve ceux qui ont passé (`+0x127`), les autres sont perdus ; la carte les abandonne tous.
 *
 * Écarts avec l'original (aussi dans `net.md` §8) : voir la fin de ce commentaire.
 *  - les animations des Zoombinis (saut, vol, réception) ne sont pas la machine à événements `1120:2900` (absente du corpus) : elles sont enchaînées par fin de script, le Zoombini cesse d'être dessiné
 *    le temps de la montée entre la fin du saut et le début du vol (10 ticks) ; **probable** ;
 *  - les Zoombinis sont envoyés à la balançoire même après la fin des munitions (l'original ne les lançait plus) ;
 *  - les animations de joie (`SCRS` 13046 + nez) sont jouées par un tirage simple, sans la table sans remise `1098:0098` ;
 *  - aucun texte n'est écrit par le port (voix et sons de l'original).
 */
import type { Shape } from "../../../../data/mohawk/shap";
import type { Surface } from "../../../../engine/mohawk/graphics/surface";
import type { Archive } from "../../../../engine/mohawk/resources";
import { TAG_SCRB, screenInfo } from "../../data/archives";
import type { Script } from "../../data/script";
import type { Point } from "../../data/zoombini";
import { DIALOG } from "../../engine/dialog";
import { FEATURE_END, FEATURES, FeatureFlag, type Feature, type FeatureImageHook, type FeaturePart, type Features } from "../../engine/features";
import { ZOOMBINIS_GAME } from "../../engine/game";
import { scrs } from "../../engine/resources";
import type { Scene, SceneContext } from "../../engine/scene";
import { drawDebugBanner } from "../../engine/shortcuts";
import { ScreenId } from "../../engine/scene";
import { currentLevel, dialogMemoryIndex } from "../../game/route";
import {
  NET_LEVELS,
  MUD_TOTAL,
  NET_SYMBOLS,
  aim,
  endOfShot,
  flightKind,
  impact,
  isComplete,
  isWon,
  newNet,
  refill,
  roleNames,
  setSelector,
  wallColumn,
  wantsRegretVoice,
  type NetState,
} from "../../game/puzzles/net";
import type { Zoombini } from "../../game/state";
import { createPuzzleKit, sheetButtonImages, type KitMember, type PuzzleKit, type Rect } from "../puzzle-kit";
import { closeScreen, openScreen } from "../screen-kit";
import { screenScripts } from "../snoid";
import { dialogChoice } from "../xfer";

// ---------------------------------------------------------------------------------------------------------------------------
// Constantes de l'écran (`1120:0000`, `1120:1161`, `1120:1461`)

/** Fonds : 5000 (niveaux 0 et 1) et 5001 (niveaux 2 et 3), avec leur palette `SHPL`. */
const BACKGROUNDS = [5000, 5000, 5001, 5001] as const;
/** Planche de boutons carte et « go » (6 images de 38 × 36). */
const BUTTON_SHEET = 6000;
/** Ticks pendant lesquels l'image enfoncée d'un bouton reste dessinée. */
const PRESSED_TICKS = 6;
/** Délai entre deux images (`11a8:0ad6` : 6). */
const DELAY = 6;
/** Drapeaux des objets de décor (`0x188000`) et des animations qui jouent dès la création (`0x4108000`). */
const STATIC = FeatureFlag.noReplay | FeatureFlag.stopAtEnd | FeatureFlag.active;
const PLAYING = FeatureFlag.stopAtEnd | FeatureFlag.active;

/** `SCRB` de l'écran. */
const SCRB = {
  bubble: 7000,
  /** 7001 + k : la bulle se remplit d'une boule (`k` de 0 à munitions − 2). */
  fill: 7001,
  /** Impact de la boule sur la dalle : 7023 (niveaux 0 et 1), 7024 (niveaux 2 et 3). */
  splash: [7023, 7024],
  /** Catapulte au repos puis rechargement (`0x1b6a`, `0x1b71`, `0x1b72`, `0x1b73`), sélecteur 2 (`0x1b6b`). */
  idle: 7018,
  selectorTwo: 7019,
  loadA: 7025,
  loadB: 7026,
  loadC: 7027,
  /** Tir : 7028 + `flightKind`. */
  launch: 7028,
  /** Bras qui prend une boule : 7031 + niveau de la bulle (0 à 16). */
  take: 7031,
  /** Boule en vol (une image) : selon `flightKind` 0, 1, 2 (`DS:1a58` = 1, 0, 2 ajouté à 7020). */
  flight: 7020,
  /** Réaction d'une colonne : 8000 + colonne. */
  column: 8000,
  /** Balançoire : 8005 + place (0 à 2). */
  lever: 8005,
  /** Dalle `9000 + t` (niveaux 0 et 1) ou `9025 + t` (niveaux 2 et 3), et l'animation de la muraille. */
  tile: [9000, 9025],
  wall: [9151, 9153],
  /** Bouton de tir : enfoncé, prêt (clignote), rappel (clignote). */
  buttonPressed: 10001,
  buttonReady: 10017,
  buttonHint: 10018,
  /** Sélecteurs 1 à 3 : 10002 + v, 10007 + v, 10012 + v. */
  selectors: [10002, 10007, 10012],
} as const;
/** `SCRS` des Zoombinis : montée à la balançoire (13000 + (2 − place) × 5 + nez), saut (13016 + 3 × (nez − 1) + (2 − place)), réception (13031 + 3 × (nez − 1) + place), joie (13045 + nez), vol (14000 + place). */
const SCRS = { hop: 13000, jump: 13016, reception: 13031, joy: 13045, flight: 14000 } as const;

/** Profondeurs : le décor, les dalles, l'impact, les colonnes, la balançoire, la bulle et le bras, la catapulte, le bouton et les sélecteurs, la boule en vol ; les Zoombinis du kit sont à 1 + y / 1000. */
const DEPTH = { wall: 0.1, tiles: 0.12, splash: 0.2, columns: 0.3, lever: 0.35, bubble: 0.4, launcher: 0.45, button: 0.5, selectors: 0.5, flight: 0.6 } as const;

/** Les seize places d'attente (`DS:19c4`, premier mot = x) : le membre `i` du groupe se tient sur la place `i`, la première est le départ de la balançoire. */
export const NET_PLACES: readonly Point[] = [
  { x: 233, y: 392 }, { x: 209, y: 378 }, { x: 196, y: 390 }, { x: 185, y: 365 }, { x: 167, y: 380 }, { x: 160, y: 408 }, { x: 135, y: 397 }, { x: 121, y: 407 },
  { x: 115, y: 368 }, { x: 114, y: 342 }, { x: 99, y: 375 }, { x: 97, y: 394 }, { x: 95, y: 346 }, { x: 91, y: 411 }, { x: 79, y: 355 }, { x: 62, y: 404 },
];
/** Départ de la montée à la balançoire (`+0x116 = 0x18800e9`, `1120:1abd`). */
export const NET_SPOT: Point = { x: 233, y: 392 };
/** Les seize points de la file d'arrivée, au-dessus du mur (`1468:01F4`) : le Zoombini `k` qui passe va sur le point `k`. */
export const NET_ARRIVALS: readonly Point[] = [
  { x: 16, y: 58 }, { x: 17, y: 45 }, { x: 15, y: 33 }, { x: 16, y: 19 }, { x: 47, y: 59 }, { x: 51, y: 48 }, { x: 46, y: 30 }, { x: 48, y: 20 },
  { x: 77, y: 63 }, { x: 74, y: 47 }, { x: 76, y: 32 }, { x: 77, y: 18 }, { x: 146, y: 67 }, { x: 143, y: 58 }, { x: 141, y: 40 }, { x: 147, y: 32 },
];
/** Marche de sortie de « go » (`1168:2982(45, 0, 0xff9c, 600)` : x = 600, y = −100, un Zoombini toutes les 45 ticks). */
const EXIT_WALK = { x: 600, y: -100, step: 45 } as const;
/** Voix d'introduction rejouée par F1 (`DS:a2c4 = 0x4e60`). */
const INTRO_VOICE = 20064;

/** Régions de clic (`1458:0504`, régions 3 à 18 de `1120:0f25`) : le tir, puis les symboles des sélecteurs 1 à 3, de gauche à droite. */
export const NET_FIRE_REGION: Readonly<Rect> = { left: 450, top: 275, right: 587, bottom: 362 };
export const NET_SYMBOL_REGIONS: readonly (readonly Readonly<Rect>[])[] = [
  [r(446, 378, 475, 407), r(476, 375, 498, 402), r(499, 373, 524, 399), r(525, 367, 549, 394), r(550, 363, 573, 390)],
  [r(446, 408, 475, 433), r(476, 403, 501, 428), r(499, 400, 526, 424), r(525, 395, 550, 421), r(550, 391, 577, 415)],
  [r(450, 434, 478, 459), r(479, 429, 501, 455), r(502, 425, 527, 451), r(528, 422, 553, 446), r(554, 416, 577, 441)],
];

function r(left: number, top: number, right: number, bottom: number): Rect {
  return { left, top, right, bottom };
}

function inside(rect: Readonly<Rect>, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** Points d'impact des dalles (`1460:0000` pour 25 dalles, `1468:0000` pour 125 : coin haut-gauche de l'image d'impact). */
const TILE_POINTS_25: readonly (readonly [number, number])[] = [
  [102, 117], [204, 106], [306, 94], [409, 79], [507, 69],
  [102, 157], [204, 143], [306, 129], [407, 115], [507, 104],
  [102, 195], [204, 180], [306, 166], [407, 151], [507, 140],
  [102, 232], [204, 217], [306, 205], [407, 191], [507, 178],
  [102, 272], [204, 257], [306, 245], [407, 229], [507, 214],
];
const TILE_POINTS_125: readonly (readonly [number, number])[] = [
  [74, 121], [94, 119], [114, 116], [135, 113], [156, 111],
  [177, 109], [197, 107], [217, 104], [237, 102], [257, 99],
  [278, 98], [298, 95], [319, 93], [340, 89], [360, 87],
  [380, 84], [398, 82], [418, 79], [438, 77], [458, 74],
  [481, 72], [499, 70], [519, 67], [538, 65], [559, 63],
  [74, 160], [93, 158], [113, 155], [133, 152], [154, 149],
  [177, 147], [197, 145], [217, 143], [237, 140], [257, 139],
  [279, 135], [299, 132], [319, 130], [341, 127], [362, 124],
  [382, 121], [400, 118], [420, 115], [439, 112], [459, 110],
  [480, 109], [499, 107], [518, 105], [538, 103], [558, 101],
  [72, 200], [93, 198], [113, 195], [134, 192], [156, 190],
  [177, 188], [197, 185], [216, 181], [236, 178], [256, 176],
  [279, 173], [299, 170], [319, 168], [338, 164], [358, 162],
  [380, 158], [399, 156], [419, 153], [438, 150], [458, 148],
  [479, 147], [500, 144], [519, 141], [538, 138], [557, 136],
  [74, 239], [94, 236], [114, 233], [135, 230], [156, 227],
  [178, 224], [198, 221], [219, 218], [238, 216], [256, 214],
  [278, 212], [298, 209], [319, 206], [338, 203], [359, 200],
  [380, 196], [399, 194], [419, 191], [438, 189], [459, 186],
  [479, 184], [499, 181], [518, 178], [538, 177], [556, 175],
  [75, 278], [95, 276], [115, 273], [135, 269], [156, 267],
  [177, 263], [197, 261], [217, 258], [237, 255], [257, 253],
  [280, 250], [300, 248], [319, 245], [339, 241], [359, 238],
  [380, 235], [400, 232], [419, 229], [439, 226], [457, 223],
  [480, 219], [499, 216], [519, 214], [538, 211], [556, 209],
];

/** Départ de la boule en vol (`1120:2e87` : 0x1e4, 0x13e) et nombre de positions montrées avant l'impact (`8b96` de 1 à 5). */
const FLIGHT_START: Point = { x: 0x1e4, y: 0x13e };
const FLIGHT_POSITIONS = 5;
const FLIGHT_DELAY = 3;
/** Tables de `1120:213e` (`DS:1a2c`, `DS:1a36`) : ordre d'affichage des symboles des sélecteurs. */
const TABLE_SHAPE = [2, 3, 0, 1, 4] as const;
const TABLE_KIND = [4, 0, 2, 1, 3] as const;

/** Inactivité (`1120:0554`) : 7200 ticks sans tir ; 720 ticks après le dernier mouvement d'un groupe libéré (filet : le verrou tombe d'ordinaire plus tôt, `unlockAfterRelease`). */
const IDLE_TICKS = 7200;
const LOCK_TICKS = 720;
/** Délai entre deux animations de joie (30 ticks) et leur nombre (3, ou 2 avec « moins d'action »). */
const JOY_GAP = 30;
const JOY_COUNT = 3;
/** Temps pendant lequel un Zoombini lancé n'est pas dessiné entre la fin du saut et le début du vol. */
const ASCENT_TICKS = 10;

// ---------------------------------------------------------------------------------------------------------------------------
// Rappel d'image de la catapulte (`1120:213e`)

/** Valeurs des sélecteurs vues par le rappel d'image : courantes et précédentes (−1 : aucune). */
interface BallView {
  selectors: readonly number[];
  previous: readonly number[];
}

/** Image de la planche 7000 à dessiner à la place de `w` selon les sélecteurs (`1120:213e`, dans l'ordre de ses tests). */
export function ballImage(w: number, view: BallView): number {
  if (w <= 0 || w >= 0xb9) return w;
  const [s1, s2, s3] = view.selectors;
  const [p1, p2, p3] = view.previous;
  const color = s1! !== -1 ? TABLE_KIND[s1!]! : -1;
  const shape = s2! !== -1 ? TABLE_SHAPE[s2!]! : -1;
  const style = s3! !== -1 ? TABLE_KIND[s3!]! : -1;
  const previousShape = p2! !== -1 ? TABLE_SHAPE[p2!]! : -1;
  const previousStyle = p3! !== -1 ? TABLE_KIND[p3!]! : -1;
  const previousColor = p1! !== -1 ? TABLE_KIND[p1!]! : -1;
  if (w < 6 && previousShape > -1 && previousColor !== -1) return previousColor * 12 + previousShape + 6;
  if (w < 6 && previousShape !== -1 && previousColor === -1) return previousShape + 1;
  if (w >= 6 && w <= 10 && shape >= 0 && color !== -1) return w + color * 12 + shape;
  if (w >= 6 && w <= 10 && shape !== -1) return shape + 1;
  if (w >= 0xb && w <= 0x11 && color !== -1) return w + color * 12;
  if (w >= 0x42 && w <= 0x57 && style >= 0) return w + style * 0x16;
  if (w > 0xaf && previousStyle !== -1) return previousStyle * 0x16 + 0x42;
  return w;
}

/** Position imposée par `1120:213e` quand une boule est en vol ou a frappé : première partie en (x, y), les suivantes décalées de (dx, dy). */
interface BallPlacement {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Scripts d'un Zoombini

/** Point de la première partie de la dernière image dont la première case est une partie : où finit un script de l'écran (`scriptAnchorOffset`). */
export function scriptEnd(script: Script): Point {
  for (let i = script.images.length - 1; i >= 0; i--) {
    const first = script.images[i]!.cells[0];
    if (first && first.w > 0) return { x: first.x, y: first.y };
  }
  return { x: 0, y: 0 };
}

/** Valeur du nez (attribut 3, 1 à 5) d'un Zoombini, bornée. */
function noseOf(zoombini: Zoombini): number {
  return Math.min(5, Math.max(1, zoombini.attrs[2]));
}

export function hopScript(slot: number, nose: number): number {
  return SCRS.hop + (2 - slot) * 5 + nose;
}
export function jumpScript(slot: number, nose: number): number {
  return SCRS.jump + 3 * (nose - 1) + (2 - slot);
}
export function receptionScript(slot: number, nose: number): number {
  return SCRS.reception + 3 * (nose - 1) + slot;
}

// ---------------------------------------------------------------------------------------------------------------------------

/** Où en est un Zoombini : dans la file, en route vers la balançoire, sur la balançoire, lancé, passé. */
type Status = "queue" | "toLever" | "lever" | "jumping" | "flying" | "landing" | "crossed";

/** Fenêtre pour les tests et le robot de partie. */
export interface NetProbe {
  readonly kit: PuzzleKit;
  readonly state: NetState;
  readonly statuses: readonly Status[];
  /** Zoombini de chaque place de la balançoire (indice du membre, −1 : vide) et s'il est prêt (arrivé). */
  readonly lever: readonly { member: number; ready: boolean }[];
  /** Tir accepté ? (ni verrou, ni fin des munitions, ni animation bloquante). */
  readonly canFire: boolean;
  readonly locked: boolean;
  readonly shotPending: boolean;
  readonly inputBlocked: boolean;
  /** Zoombinis arrivés de l'autre côté. */
  readonly arrived: number;
  readonly pendingRelease: number;
}


const PROBES = new WeakMap<Scene, () => NetProbe | null>();

/** Fenêtre sur une scène de muraille (tests) ; null avant l'entrée. */
export function netProbeOf(scene: Scene): NetProbe | null {
  return PROBES.get(scene)?.() ?? null;
}

/** Scène de l'épreuve de la muraille de signes (écran 15). */
export function createNetScene(): Scene {
  const name = screenInfo(ScreenId.net)?.archive;
  if (!name) throw new Error("createNetScene : pas d'archive pour l'écran 15");
  let archive: Archive;
  let ctx: SceneContext;
  let kit: PuzzleKit | null = null;
  let party: Zoombini[] = [];
  let state: NetState | null = null;
  let features: Features;
  let gone = true;

  // Objets de l'écran.
  let columns: Feature[] = [];
  let lever: Feature;
  let launcher: Feature;
  let bubble: Feature;
  let button: Feature;
  /** Marques des tirs sur le mur, une par tir, jamais retirées (`DS:8b0c[k]`, `k` = `1468:0234`, compteur de tirs). */
  let splashes: Feature[] = [];
  /** Symboles réglés au moment du tir (`+0x1e` de la feature du tir). */
  let shotView: BallView | undefined;
  let flight: Feature | null = null;
  const selectorFeatures: (Feature | null)[] = [null, null, null];
  const tileFeatures = new Map<number, Feature>();
  let wallFeature: Feature | null = null;
  /** Fond de l'écran (recopié à chaque recomposition) : le bandeau de la touche `L` y est dessiné pour rester affiché. */
  let background: Surface | null = null;

  // Variables d'état de l'original (entre parenthèses).
  /** Tir en cours (`[8b8c]`) et dernier tir pas encore réglé (`[8ba6]`) ; clics bloqués (`[89e0]`) ; fin du tir : horodatage (`[8bae]`). */
  let locked = true;
  let shotPending = false;
  /** Animation de tir de la catapulte en cours (`[8ba4]`, du clic à `shotEnded`). */
  let firing = false;
  let inputBlocked = true;
  let lastActivity = 0;
  /** Premier rechargement (`[8b58]`), dernier tir manqué (`[8b8e]`), niveau de la bulle (`[8b4c]`). */
  let firstReload = true;
  let lastMiss = false;
  let bubbleLevel = 0;
  /** Zoombinis libérés encore à lancer (`[8b9a]`) et lancement en cours. */
  let pendingRelease = 0;
  let releasing = false;
  let releaseColumn = 0;
  /** Boule en vol : étape et jeton (un nouveau tir annule le précédent).*/
  let flightStep = 0;
  let flightToken = 0;
  let flightPlacement: BallPlacement | null = null;

  // Zoombinis.
  let statuses: Status[] = [];
  let leverSlots: { member: number; ready: boolean }[] = [];
  let nextToSend = 0;
  let sending = false;
  /** Zoombinis en train de jouer leur montée à la balançoire (`[89f2…89f6]` non nuls). */
  let climbing = 0;
  let arrivedCount = 0;
  /** Pose en attente des événements 240 à 243 (`[89de]`, 0 : aucune), appliquée par l'événement 0. */
  let pendingPose = 0;
  let joysLeft = 0;
  let nextJoy = 0;
  let timers: { at: number; run: () => void }[] = [];
  /** Animations suivies (une feature occupée par un script) et leurs attentes. */
  const busy = new Set<Feature>();
  const waiters = new Map<Feature, (() => void)[]>();

  // ------------------------------------------------------------------------------------------------------------------------
  // Aides

  const level = () => state!.level;
  const lessAction = () => ctx.services.get(ZOOMBINIS_GAME).game.options.lessAction;

  function after(ticks: number, run: () => void): void {
    timers.push({ at: ctx.clock.ticks + ticks, run });
  }

  /** Joue le script `id` sur `feature` (rappel de fin : `flush`). */
  function playOn(feature: Feature, id: number, hook?: FeatureImageHook, delay?: number): void {
    if (delay !== undefined) feature.delay = delay;
    if (hook) feature.onImage = hook;
    busy.add(feature);
    feature.onEvent = (_image, n) => {
      if (n === FEATURE_END && !gone) flush(feature);
    };
    features.setScript(feature, id);
  }

  function flush(feature: Feature): void {
    busy.delete(feature);
    const list = waiters.get(feature);
    waiters.delete(feature);
    for (const run of list ?? []) {
      if (gone) return;
      run();
    }
  }

  /** `run` dès que la feature n'a plus de script en cours (le jeton `1f5c` de l'original). */
  function whenIdle(feature: Feature, run: () => void): void {
    if (!busy.has(feature)) {
      run();
      return;
    }
    const list = waiters.get(feature) ?? [];
    list.push(run);
    waiters.set(feature, list);
  }

  const view = (): BallView => ({ selectors: state!.selectors, previous: state!.previous });

  /** Rappel d'image de la catapulte, de la boule en vol et de l'impact (`1120:213e`) : images des symboles, et position imposée si `placement` en donne une. */
  function ballHook(placement: () => BallPlacement | null, fixed?: ReturnType<typeof view>): FeatureImageHook {
    return (_feature, parts): FeaturePart[] =>
      parts.map((part, index) => {
        if (part.w <= 0 || part.w >= 0xb9) return part;
        const out: FeaturePart = { w: ballImage(part.w, fixed ?? view()), x: part.x, y: part.y };
        const at = placement();
        if (at) {
          out.x = index === 0 ? at.x : at.x + at.dx;
          out.y = index === 0 ? at.y : at.y + at.dy;
        }
        return out;
      });
  }

  const launcherHook = ballHook(() => null);

  function tilePoint(tile: number): Point {
    const table = level() < 2 ? TILE_POINTS_25 : TILE_POINTS_125;
    const [x, y] = table[tile] ?? [0, 0];
    return { x, y };
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Dalles marquées

  /** Dalle qui cache un groupe : la dalle éclaircie et, dessus, la marque de la taille du groupe (image 150 + taille aux niveaux 0 et 1, 153 + taille ensuite ; `1120:20e7`). */
  function buildTiles(): void {
    const s = state!;
    const base = SCRB.tile[level() < 2 ? 0 : 1]!;
    const markBase = level() < 2 ? 150 : 153;
    for (let tile = 0; tile < s.tiles; tile++) {
      const size = s.groups[tile]!;
      if (size <= 0) continue;
      const feature = features.create({
        script: base + tile,
        delay: DELAY,
        flags: STATIC,
        depth: DEPTH.tiles,
        onImage: (_f, parts) => (parts.length > 0 ? [...parts, { w: markBase + size, x: parts[0]!.x, y: parts[0]!.y }] : parts),
      });
      tileFeatures.set(tile, feature);
    }
    features.invalidate();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Bouton de tir

  function flash(id: number): void {
    playOn(button, id);
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Remplissage de la bulle, rechargement de la catapulte (`1120:0554`)

  /** La bulle se remplit d'une boule par étape (7001 + k), puis le premier rechargement commence. */
  function fillBubble(step: number): void {
    const s = state!;
    if (gone) return;
    if (step + 1 < s.startAmmo) {
      playOn(bubble, SCRB.fill + step, undefined, DELAY);
      whenIdle(bubble, () => fillBubble(step + 1));
      return;
    }
    // Fin du remplissage : les trois premiers Zoombinis partent vers la balançoire (`8b9c = 3`) et le bras prend la première boule.
    sendNext();
    reload();
  }

  /** `8b50 → 8b5a → 8b5c → 8b60 → 8b62 → 8b64` : le bras prend une boule, la catapulte se recharge, le prochain Zoombini monte, le tir est de nouveau permis. */
  function reload(): void {
    const s = state!;
    if (gone || s.exhausted) return;
    playOn(bubble, SCRB.take + Math.min(bubbleLevel, 16), undefined, DELAY);
    bubbleLevel = Math.min(16, bubbleLevel + 1);
    // `8b5a` : sans attendre le bras, la boule perd sa couleur et ses valeurs précédentes (`8b84 = 8b82`, `8b88 = 8b80 = −1`, `8b7e = −1` aux niveaux 0 et 1).
    s.previous[1] = s.selectors[1];
    s.previous[2] = -1;
    s.previous[0] = -1;
    if (level() < 2) s.selectors[0] = -1;
    playOn(launcher, SCRB.idle, launcherHook, 3);
    whenIdle(launcher, () => {
      sendNext();
      playOn(launcher, SCRB.loadA, launcherHook, 2);
      whenIdle(launcher, () => {
        playOn(launcher, SCRB.loadB, launcherHook, DELAY);
        whenIdle(launcher, () => {
          inputBlocked = false;
          if (level() < 2) {
            finishReload();
            return;
          }
          s.previous[0] = -1;
          playOn(launcher, SCRB.loadC, launcherHook, DELAY);
          whenIdle(launcher, finishReload);
        });
      });
    });
  }

  /** Fin du rechargement : le tir est de nouveau permis (`8b8c = 0`) ; le bouton clignote au premier rechargement, après un tir manqué ou quand tous sont libérés. */
  function finishReload(): void {
    const s = state!;
    locked = false;
    if (firstReload) {
      firstReload = false;
      flash(SCRB.buttonReady);
      lastActivity = ctx.clock.ticks;
    } else if (lastMiss || isWon(s)) {
      flash(SCRB.buttonHint);
    }
    lastMiss = false;
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Touches du mode de test (`1120:10cd`, table `CS:1151`, actives si `[a43f]`)

  /**
   * Quatre touches (sûr, table lue dans l'exécutable) : espace `111f`, `L` et `l` `1115` (puis `1f2d`), `F1` `110b` (l'aide vocale, traitée par `kit.key`).
   */
  function testHandlers(): Readonly<Record<number, () => boolean | void>> {
    return { 0x20: refillAmmo, 0x4c: showRoles, 0x6c: showRoles };
  }

  /**
   * Espace (`1120:111f`) : munitions et tas de la bulle remis à neuf ; si le jeu était arrêté faute de munitions, il repart (`[8b6c] = 0`, `[8b50]++` : le rechargement
   * du Tick, `reload`).
   */
  function refillAmmo(): void {
    const s = state!;
    const restart = refill(s);
    bubbleLevel = Math.max(0, MUD_TOTAL - s.ammo);
    if (restart && !gone) reload();
  }

  /** `L` (`1120:1f2d`) : les trois noms des rôles tirés à l'entrée dans un bandeau en haut à droite, dessiné sur le fond (il reste tant que l'écran dure). */
  function showRoles(): void {
    const screen = background;
    if (!screen) return;
    // Bandeau `DS:1a0a` (gauche `1a12`, droite `1a1a`) : noms des rôles `[89cc]`, `[89ce]`, `[89d0]`.
    drawDebugBanner(ctx, screen, roleNames(state!));
    features.invalidate();
    ctx.requestPresent();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Sélecteurs et tir (`1120:1b9b`)

  /** Clic sur le symbole `value` de la rangée `row` (0 à 2). */
  function chooseSymbol(row: 0 | 1 | 2, value: number): void {
    const s = state!;
    const before = isComplete(s);
    const changed = setSelector(s, row, value);
    const feature = selectorFeatures[row];
    if (!changed || !feature) return;
    playOn(feature, SCRB.selectors[row]! + value);
    if (s.exhausted || !before) return;
    // Le sélecteur change : la catapulte rejoue son animation de chargement avec la nouvelle boule.
    if (row === 0) playOn(launcher, SCRB.loadC, launcherHook, DELAY);
    else if (row === 1) playOn(launcher, SCRB.selectorTwo, launcherHook, 3);
    else playOn(launcher, SCRB.loadB, launcherHook, DELAY);
    if (!shotPending) flash(SCRB.buttonHint);
  }

  function canFire(): boolean {
    return !shotPending && !locked && !state!.exhausted && !inputBlocked;
  }

  /** Tir (`1120:0f25`, région 3, puis `1b9b(0, 0)`). */
  function fire(): void {
    const s = state!;
    if (!canFire()) return;
    shotPending = true;
    locked = true;
    firing = true;
    lastActivity = ctx.clock.ticks;
    playOn(button, SCRB.buttonPressed);
    const tile = aim(s);
    const column = wallColumn(level(), tile);
    const kind = flightKind(column);
    releaseColumn = column;
    // Dès l'événement 3 (n = 2) la boule part ; la catapulte finit son animation, puis la munition est comptée.
    launcher.onEvent = (_image, n) => {
      if (gone) return;
      if (n === 2) startFlight(tile, kind);
      else if (n === FEATURE_END) flush(launcher);
    };
    busy.add(launcher);
    launcher.onImage = launcherHook;
    launcher.delay = DELAY;
    features.setScript(launcher, SCRB.launch + kind);
    whenIdle(launcher, shotEnded);
  }

  /** `1120:2e87` : la boule part de la catapulte (image 7020 + ordre selon la colonne) et avance de cinq positions, une toutes les 3 ticks, vers la dalle. */
  function startFlight(tile: number, kind: 0 | 1 | 2): void {
    clearFlight();
    shotView = { selectors: [...state!.selectors], previous: [...state!.previous] } as BallView;
    const target = tilePoint(tile);
    const dx = Math.trunc((FLIGHT_START.x - target.x) / 6);
    const dy = Math.trunc((FLIGHT_START.y - target.y) / 6);
    flightStep = 0;
    const token = ++flightToken;
    // `DS:1a58` = (1, 0, 2) : le script de la boule est 7020 + 1 pour 0 (colonnes 1 à 3), + 0 pour 1 (colonne 0), + 2 pour 2 (colonne 4).
    const script = SCRB.flight + [1, 0, 2][kind]!;
    const show = (): void => {
      if (flight) features.destroy(flight);
      flightPlacement = { x: FLIGHT_START.x - flightStep * dx, y: FLIGHT_START.y - flightStep * dy, dx: 4, dy: 3 };
      flight = features.create({ script, delay: 1, flags: STATIC, depth: DEPTH.flight, onImage: ballHook(() => flightPlacement) });
    };
    const step = (): void => {
      if (gone || token !== flightToken) return;
      flightStep += 1;
      if (flightStep < FLIGHT_POSITIONS && !lessAction()) {
        show();
        after(FLIGHT_DELAY, step);
        return;
      }
      clearFlight();
      land(tile);
    };
    show();
    after(FLIGHT_DELAY, step);
  }

  function clearFlight(): void {
    if (flight) features.destroy(flight);
    flight = null;
    flightPlacement = null;
  }

  /** `1120:248b` : la boule frappe la dalle ; le groupe caché est libéré, ou le tir est manqué. */
  function land(tile: number): void {
    const s = state!;
    const released = impact(s, tile);
    const target = tilePoint(tile);
    // `1120:2e87` crée pour chaque tir sa propre feature (`DS:8b0c[k]`, `k` incrémenté à chaque tir) ; à l'impact `248b` elle devient la marque de boue (`SCRB` 7023 / 7024), qui
    // reste sur la dalle jusqu'à la fin de l'épreuve : les marques des tirs précédents restent visibles, c'est l'information du joueur.
    const placement: BallPlacement = { x: target.x, y: target.y, dx: level() < 2 ? 0x15 : 3, dy: 7 };
    const script = SCRB.splash[level() < 2 ? 0 : 1]!;
    // Les symboles de la marque sont ceux du tir (`+0x1e` de la feature, posé à `2e87`), pas ceux réglés ensuite pour le tir suivant.
    const fixed = shotView ?? { selectors: [...state!.selectors], previous: [...state!.previous] } as BallView;
    splashes.push(features.create({ script, delay: DELAY, flags: PLAYING, depth: DEPTH.splash, onImage: ballHook(() => placement, fixed) }));
    if (released > 0) {
      pendingRelease = released;
      joysLeft = lessAction() ? JOY_COUNT - 1 : JOY_COUNT;
      nextJoy = ctx.clock.ticks + JOY_GAP;
      // La dalle marquée (pierre éclaircie et points du groupe) reste : `1120` ne détruit jamais ses dalles (aucun `11a8:20e8`) ; la marque du tir se pose dessus.
    } else {
      pendingRelease = 0;
      shotPending = false;
      lastMiss = true;
    }
  }

  /** Fin de l'animation de tir (`8ba4`) : munition de moins, dernier tir, rechargement ; un groupe libéré commence à passer. */
  function shotEnded(): void {
    const s = state!;
    if (gone) return;
    firing = false;
    const last = endOfShot(s);
    if (last) {
      const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
      const slot = dialogMemoryIndex(ScreenId.net);
      const novice = slot >= 0 && (zoombinis.game.dialogMemory[slot]! & 0xfff) < 4;
      // `10a8:04e8(4, 0)` : tirage de 0 à 4 ; la voix de regret est tirée entre 20045 et 20048.
      const draw = ctx.rng.range(0, 4);
      if (wantsRegretVoice(s, draw, pendingRelease === 0, novice)) kit?.playRegretVoice();
    }
    lastActivity = ctx.clock.ticks;
    if (pendingRelease > 0) startRelease();
    reload();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Passage d'un groupe : colonne, balançoire, saut, vol, réception, file d'arrivée

  function startRelease(): void {
    if (releasing) return;
    releasing = true;
    releaseNext();
  }

  /**
   * Après un tir qui a libéré un groupe, le tir redevient permis (`8ba6 = 0`, bouton `SCRB` 10018) sans attendre les 720 ticks du Tick (`1120:0554`, simple filet), aux
   * moments où `1120:2900` le rend :
   *  - `"climbed"` : fin de la montée d'un Zoombini à la balançoire, quand plus personne d'autre n'est en train d'y monter (événement −1, `1120:2bef`, `[89f2…89f6]` nuls) ;
   *  - `"released"` : fin du passage du groupe ; le remplaçant part alors vers la balançoire et c'est la fin de sa montée qui lève le verrou ; si personne ne part (file vide),
   *    le verrou tombe tout de suite (`1120:2c25`) ;
   *  - `"arrival"` : un Zoombini reçu de l'autre côté part vers la file d'arrivée alors que tous sont libérés ou qu'il ne reste personne à envoyer (`1120:2cba`, `[89dc]`).
   * Pas pendant le passage du groupe : chaque réaction de colonne le remet (`8ba6++`). `locked` (`8b8c`) reste à la charge du rechargement (`finishReload`) : l'original le
   * lève aussi au même moment, même pendant un rechargement, ce que le port ne fait pas.
   */
  function unlockAfterRelease(reason: "climbed" | "released" | "arrival"): void {
    const s = state;
    if (gone || !s || !shotPending || firing || releasing || pendingRelease > 0 || flight !== null) return;
    if (reason === "arrival" && !(isWon(s) || !kit || nextToSend >= kit.members.length)) return;
    if (reason === "released" && (sending || climbing > 0)) return;
    if (reason === "climbed" && climbing > 0) return;
    shotPending = false;
    flash(SCRB.buttonHint);
    lastActivity = ctx.clock.ticks;
  }

  /** Un Zoombini de moins à passer (`8b9a−−`) : la colonne réagit, puis la balançoire lance le Zoombini de la place la plus à gauche occupée. */
  function releaseNext(): void {
    if (gone) return;
    if (pendingRelease <= 0) {
      releasing = false;
      // `1120:0554` : la montée des remplaçants attend la fin des réactions de colonne et des balançoires du groupe (`[8b9e]`, `[8ba0]`, `[8b9a]`).
      sendNext();
      unlockAfterRelease("released");
      return;
    }
    pendingRelease -= 1;
    lastActivity = ctx.clock.ticks;
    const columnFeature = columns[releaseColumn]!;
    playOn(columnFeature, SCRB.column + releaseColumn, undefined, DELAY);
    whenIdle(columnFeature, () => {
      // La boulette est retombée : le groupe ne l'attend plus, l'image de la colonne est retirée.
      columnFeature.parts = [];
      features.invalidate();
      awaitLever();
    });
  }

  /** Attend qu'un Zoombini soit prêt sur la balançoire (le refus de partir sans personne de l'original est ici une attente). */
  function awaitLever(): void {
    if (gone) return;
    const slot = leverSlots.findIndex((entry) => entry.member >= 0 && entry.ready);
    if (slot < 0) {
      sendNext();
      after(1, awaitLever);
      return;
    }
    const entry = leverSlots[slot]!;
    const member = kit!.members[entry.member]!;
    playOn(lever, SCRB.lever + slot, undefined, DELAY);
    // Événement 21 (n = 20) : la boulette frappe la balançoire, le Zoombini est lancé.
    lever.onEvent = (_image, n) => {
      if (gone) return;
      if (n === 20) launchMember(member, slot);
      else if (n === FEATURE_END) flush(lever);
    };
    whenIdle(lever, () => {
      releaseNext();
    });
  }

  function indexOf(member: KitMember): number {
    return kit!.members.indexOf(member);
  }

  /** Le Zoombini de la place `slot` saute (`SCRS` 13016 +…), puis vole (14000 + place), est reçu (13031 +…) et rejoint la file d'arrivée. */
  function launchMember(member: KitMember, slot: number): void {
    const index = indexOf(member);
    leverSlots[slot] = { member: -1, ready: false };
    statuses[index] = "jumping";
    member.zoombini.present = true;
    const snoid = member.snoid;
    const nose = noseOf(member.zoombini);
    snoid.onEvent = (n) => poseEvent(snoid, n);
    snoid.onEnd = () => {
      // Monte hors du champ, puis vole au-dessus du mur.
      statuses[index] = "flying";
      snoid.feature.flags |= FeatureFlag.noDraw;
      after(ASCENT_TICKS, () => {
        if (gone || snoid.destroyed) return;
        const end = scriptEnd(scrs(archive, SCRS.flight + slot));
        snoid.onEnd = () => {
          statuses[index] = "landing";
          const landing = scriptEnd(scrs(archive, receptionScript(slot, nose)));
          snoid.onEnd = () => walkToArrival(member);
          snoid.play(receptionScript(slot, nose), FeatureFlag.stopAtEnd, { kind: "normal", at: landing });
        };
        snoid.play(SCRS.flight + slot, FeatureFlag.stopAtEnd, { kind: "reject", at: end });
      });
    };
    snoid.play(jumpScript(slot, nose), FeatureFlag.stopAtEnd, { kind: "normal" });
    // La place est libre ; le remplaçant ne part qu'après la balançoire du dernier du groupe (`releaseNext`).
  }

  /**
   * Événements de pose des `SCRS` (`1120:2900`, table `CS:2d55`) : 250 à 253 imposent la pose tout de suite (`1168:4dc9`) ; 240 à 243 la mettent en attente (`[89de] = n − 239`) ;
   * 0 retourne le Zoombini (`+0xf2` inversé) et applique la pose en attente. Les montées à la balançoire s'en servent pour finir tournées, dans la pose 1.
   */
  function poseEvent(snoid: KitMember["snoid"], n: number): void {
    if (n >= 250 && n <= 253) snoid.setPose(n - 250);
    else if (n >= 240 && n <= 243) pendingPose = n - 239;
    else if (n === 0) {
      snoid.setFacing(snoid.facing === 0 ? 1 : 0);
      if (pendingPose !== 0) snoid.setPose(pendingPose - 1);
      pendingPose = 0;
    }
  }

  function walkToArrival(member: KitMember): void {
    if (gone) return;
    const index = indexOf(member);
    const point = NET_ARRIVALS[Math.min(arrivedCount, NET_ARRIVALS.length - 1)]!;
    arrivedCount += 1;
    member.snoid.onEvent = undefined;
    member.snoid.onEnd = undefined;
    unlockAfterRelease("arrival");
    kit!.depart([member], point, {
      onArrive: () => {
        statuses[index] = "crossed";
        // `1120:2cae` : « go » devient actif quand le premier Zoombini a rejoint la file d'arrivée.
        if (kit) kit.goEnabled = true;
        const crossedAll = statuses.every((status) => status === "crossed");
        if (crossedAll) kit?.playSuccessVoice();
      },
    });
  }

  /** `1120:1abd` : le prochain Zoombini monte à la première place libre de la balançoire (la plus à droite d'abord). */
  function sendNext(): void {
    if (gone || sending || !kit) return;
    if (nextToSend >= kit.members.length) return;
    let slot = -1;
    for (let k = 2; k >= 0; k--) {
      if (leverSlots[k]!.member < 0) {
        slot = k;
        break;
      }
    }
    if (slot < 0) return;
    const index = nextToSend++;
    const member = kit.members[index]!;
    sending = true;
    leverSlots[slot] = { member: index, ready: false };
    statuses[index] = "toLever";
    const hop = (): void => {
      if (gone) return;
      const snoid = member.snoid;
      const id = hopScript(slot, noseOf(member.zoombini));
      const end = scriptEnd(scrs(archive, id));
      snoid.onEvent = (n) => poseEvent(snoid, n);
      snoid.onEnd = () => {
        snoid.onEnd = undefined;
        snoid.onEvent = undefined;
        // `1120:2900`, événement −1 d'une montée : `1168:4231(0, 2)`, le Zoombini attend sur la balançoire dans sa pose d'attente (tourné par l'événement 0).
        snoid.idle();
        statuses[index] = "lever";
        leverSlots[slot] = { member: index, ready: true };
        sending = false;
        climbing -= 1;
        sendNext();
        unlockAfterRelease("climbed");
      };
      climbing += 1;
      snoid.play(id, FeatureFlag.stopAtEnd, { kind: "normal", at: end });
    };
    const at = member.snoid.position;
    if (at.x === NET_SPOT.x && at.y === NET_SPOT.y) hop();
    else kit.depart([member], NET_SPOT, { onArrive: hop });
  }

  /** Animation de joie d'un Zoombini qui attend (`SCRS` 13045 + nez, `1120:0554`) : toutes les 30 ticks après un groupe libéré. */
  function joy(): void {
    if (!kit) return;
    const waiting = kit.members.filter((m, i) => statuses[i] === "queue" && !m.walking && m.snoid.resting && !m.snoid.destroyed);
    if (waiting.length === 0) return;
    const member = waiting[ctx.rng.range(0, waiting.length - 1)]!;
    const snoid = member.snoid;
    snoid.onEvent = undefined;
    snoid.onEnd = () => {
      snoid.onEnd = undefined;
      snoid.idle();
    };
    snoid.play(SCRS.joy + noseOf(member.zoombini), FeatureFlag.stopAtEnd, { kind: "normal" });
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Clics

  function onPointerDown(x: number, y: number): boolean {
    const k = kit;
    if (!k || k.left || k.departing || !state) return true;
    if (inputBlocked) return false;
    if (inside(NET_FIRE_REGION, x, y)) {
      fire();
      return true;
    }
    for (let row = 0; row < 3; row++) {
      if (row === 0 && level() < 2) continue;
      for (let value = 0; value < NET_SYMBOLS; value++) {
        if (!inside(NET_SYMBOL_REGIONS[row]![value]!, x, y)) continue;
        // Sélecteurs inertes pendant un tir, sauf quand il n'y a plus de munitions (`[8b8c] == 0 || [8b6c] != 0`).
        if (!locked || state.exhausted) chooseSymbol(row as 0 | 1 | 2, value);
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Scène

  const scene: Scene = {
    async load(c: SceneContext) {
      archive = await c.resources.open(name);
    },
    enter(c: SceneContext) {
      ctx = c;
      gone = false;
      const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
      zoombinis.session.screen = ScreenId.net;
      const chosen = currentLevel(zoombinis.game, zoombinis.session, ScreenId.net);
      if (chosen < 0 || chosen >= NET_LEVELS) throw new RangeError(`net : niveau ${chosen}`);
      // Le groupe de la scène : copie des présents du tampon (`party` de `exitPuzzle`).
      party = zoombinis.game.group.members.filter((z) => z.present).map((z) => ({ ...z, attrs: [...z.attrs] as Zoombini["attrs"], state: z.state.slice() }));
      state = newNet(ctx.rng, chosen, Math.max(1, party.length));
      locked = true;
      shotPending = false;
      firing = false;
      inputBlocked = true;
      lastActivity = ctx.clock.ticks;
      firstReload = true;
      lastMiss = false;
      bubbleLevel = 16 - state.startAmmo;
      pendingRelease = 0;
      releasing = false;
      releaseColumn = 0;
      flight = null;
      flightToken += 1;
      splashes = [];
      flightPlacement = null;
      nextToSend = 0;
      sending = false;
      climbing = 0;
      arrivedCount = 0;
      pendingPose = 0;
      joysLeft = 0;
      timers = [];
      busy.clear();
      waiters.clear();
      tileFeatures.clear();
      statuses = party.map(() => "queue" as Status);
      leverSlots = [0, 1, 2].map(() => ({ member: -1, ready: false }));

      background = openScreen(ctx, archive, { background: BACKGROUNDS[chosen]! });
      features = ctx.services.get(FEATURES);
      // Groupes de formes et plages de scripts (`1120:0000`).
      features.defineGroup(0, 7000, true);
      features.defineGroup(1, 8000);
      features.defineGroup(2, 9000, true);
      features.defineGroup(3, 10000);
      features.setScripts(7000, 48);
      features.addScripts(8000, 8);
      features.addScripts(9000, 154);
      features.addScripts(10000, 19);
      for (const id of [SCRB.bubble, SCRB.column, SCRB.lever, SCRB.tile[0], SCRB.wall[0], SCRB.buttonHint]) if (!archive.has(TAG_SCRB, id)) throw new Error(`net : SCRB ${id} absent de ${name}`);

      // Objets de `1120:1161` : les cinq colonnes, la balançoire, la muraille, la catapulte, le bouton, les sélecteurs, la bulle.
      columns = [0, 1, 2, 3, 4].map((k) => features.create({ script: SCRB.column + k, delay: DELAY, flags: STATIC, depth: DEPTH.columns }));
      lever = features.create({ script: SCRB.lever, delay: DELAY, flags: STATIC, depth: DEPTH.lever });
      const wallId = SCRB.wall[chosen < 2 ? 0 : 1]!;
      wallFeature = features.create({ script: wallId, delay: DELAY, flags: PLAYING, depth: DEPTH.wall });
      wallFeature.onEvent = (_image, n) => {
        if (n !== FEATURE_END || gone) return;
        // `1120:1461` : à la fin de l'animation de la muraille, les dalles marquées apparaissent.
        features.destroy(wallFeature!);
        wallFeature = null;
        buildTiles();
      };
      launcher = features.create({ script: SCRB.idle, delay: 3, flags: STATIC, depth: DEPTH.launcher, onImage: launcherHook });
      button = features.create({ script: SCRB.buttonHint, delay: DELAY, flags: STATIC, depth: DEPTH.button });
      for (let row = 0; row < 3; row++) {
        // Rangée 1 (sélecteur 1) seulement aux niveaux 2 et 3.
        if (row === 0 && chosen < 2) continue;
        selectorFeatures[row] = features.create({ script: SCRB.selectors[row]! + state.selectors[row]!, delay: DELAY, flags: PLAYING, depth: DEPTH.selectors });
      }
      bubble = features.create({ script: SCRB.bubble, delay: DELAY, flags: STATIC, depth: DEPTH.bubble });

      const sheet: Shape[] = archive.tbmpImages(BUTTON_SHEET);
      const images = sheetButtonImages(sheet);
      kit = createPuzzleKit(ctx, {
        screen: ScreenId.net,
        party,
        places: NET_PLACES,
        snoid: { scripts: screenScripts(archive) },
        // Aucun glisser-déposer (région 18 inerte).
        canPick: () => false,
        // Boutons carte et « go » (planche 6000, `1120:03bb`), image enfoncée tenue 6 ticks.
        buttons: { map: { images: images.map, hold: PRESSED_TICKS }, go: { images: images.go, hold: PRESSED_TICKS }, depth: DEPTH.button },
        exitWalk: EXIT_WALK,
        introVoice: INTRO_VOICE,
        onPointerDown,
      });
      // `1168:274e(0, 30)` : le premier Zoombini entre tout de suite, puis un toutes les 30 ticks ; `1168:3dd0(0, 0)` : personne n'est sauvé.
      kit.arrive({ startDelay: 0, step: 30 });
      kit.markAll(false);
      kit.playMusic();
      // `1168:5c57` : une visite de plus de l'écran (mémoire de dialogue, 12 bits).
      const slot = dialogMemoryIndex(ScreenId.net);
      if (slot >= 0) zoombinis.game.dialogMemory[slot] = dialogChoice(zoombinis.game.dialogMemory[slot]!, chosen, zoombinis.session.training !== 0).memory;
      PROBES.set(scene, () =>
        state && kit
          ? {
              kit,
              state,
              statuses,
              lever: leverSlots,
              canFire: canFire(),
              locked,
              shotPending,
              inputBlocked,
              arrived: arrivedCount,
              pendingRelease,
            }
          : null,
      );
      ctx.requestPresent();
      // Tout de suite : la bulle se remplit (`8b6a`), une boule par étape.
      whenIdle(bubble, () => fillBubble(0));
    },
    leave(c: SceneContext) {
      gone = true;
      kit?.leave();
      kit = null;
      timers = [];
      busy.clear();
      waiters.clear();
      tileFeatures.clear();
      selectorFeatures.fill(null);
      flight = null;
      splashes = [];
      wallFeature = null;
      closeScreen(c);
    },
    tick() {
      if (!kit || gone || !state) return;
      kit.tick();
      const now = ctx.clock.ticks;
      if (timers.length > 0) {
        const due = timers.filter((t) => t.at <= now);
        timers = timers.filter((t) => t.at > now);
        for (const t of due) t.run();
      }
      if (ctx.services.tryGet(DIALOG)?.isOpen ?? false) return;
      // Animations de joie de ceux qui attendent après un groupe libéré (toutes les 30 ticks, trois fois).
      if (joysLeft > 0 && now >= nextJoy) {
        joysLeft -= 1;
        nextJoy = now + JOY_GAP;
        joy();
      }
      // Inactivité (`1120:0554`) : rappel du bouton après 7200 ticks sans tir ; après un tir qui a libéré un groupe, au plus tard 720 ticks après son dernier mouvement (filet, `unlockAfterRelease`).
      if (!shotPending) {
        if (now - lastActivity > IDLE_TICKS && !inputBlocked) {
          locked = false;
          flash(SCRB.buttonHint);
          lastActivity = now;
        }
      } else if (now - lastActivity > LOCK_TICKS && !releasing && pendingRelease === 0 && flight === null) {
        locked = false;
        shotPending = false;
        flash(SCRB.buttonHint);
        lastActivity = now;
      }
    },
    key(event, c: SceneContext) {
      if (!kit || kit.left) return false;
      if (event.ctrl || event.alt) return false;
      if (c.services.tryGet(DIALOG)?.isOpen) return false;
      return kit.key(event) || kit.testKey(event, testHandlers());
    },
  };
  return scene;
}
