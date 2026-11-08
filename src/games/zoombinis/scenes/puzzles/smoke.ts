/**
 * Le piège de cristal (`SMOKE.MHK`, écran 17, tâche H8 ; `docs/zoombinis/puzzles/smoke.md`, `docs/zoombinis/engine-ts.md`, « Cristal (tâche H8) »).
 * Épreuve sur le kit commun (`puzzle-kit.ts`) : le kit porte l'arrivée du groupe (niveaux 1-2), le glisser-déposer des Zoombinis, les boutons, l'enregistrement, l'aide F1
 * et la musique ; cet écran porte les règles (`game/puzzles/smoke.ts`) et la mise en scène (original : `Enter` `1158:0000`, `Tick` `1158:0cbe`, clic `1158:1429`,
 * rappel d'événements `1158:37a4` et `1158:3e59`, résultat `1158:34b0`).
 *
 * ## Déroulé
 *
 *  1. **Entrée** : fond et palette 5000, groupe de formes 11000 (positions absolues), les 78 `SCRB` (décor, machine, wagonnets), objets de puzzle dessinés avec la planche 10000
 *     (`REGS` 10000 / 10001), intro du cristal géant (`SCRB` 11015 / 11016, puis 11017), musique `30030 + niveau`. Niveaux 1-2 : le groupe attend à gauche (20 places `DS:21f0`) ;
 *     niveaux 3-4 : les Zoombinis arrivent en wagonnet (`SCRB` 11033 / 11034, `SCRS` 12038 / 12039) dans l'ordre du groupe.
 *  2. **Préparer** (niveaux 1-2) : le wagonnet vide arrive (`SCRB` 11032) ; glisser un Zoombini sur le wagonnet de gauche, puis une des 8 silhouettes sur le cristal de droite (filtres fixes au niveau 2). (Niveaux 3-4) :
 *     glisser les 6 cristaux sur les 2 × 3 emplacements de la voie.
 *  3. **Levier** (zone `DS:2018`, `SCRB` 11002) : image 3, événement 2 : test (`pull`), fiches comparées affichées, balayage `SCRB` 11018 / 11019 (événement 4) puis séquence de résultat
 *     (11024 à 11031, qui dessinent aussi le wagonnet qui part : celui d'arrivée est caché ; le Zoombini marche, `SCRS` 11999… à 12014…, les fiches rebondissent
 *     puis reviennent au repos, événement 17 : le wagonnet de sortie `SCRB` 11036 + k roule avec le Zoombini
 *     `SCRS` 12020 + k, événement 50 : fin de tour). Sauvé : garé dans son wagonnet (`SCRB` 11071 − k) et « go » actif ; piégé : au fond de la voie, le wagonnet roule à vide. Niveaux 1-2 : un wagonnet vide revient (11032).
 *  4. **Tour suivant** : le levier clignote (`SCRB` 11005) ; le tirer refait le puzzle (`newRound`, `SCRB` 11004). Niveau 4 : le second de la paire est testé tout seul avec la
 *     même disposition contre la cible n° 8 (socle `SCRB` 11011).
 *  5. **Fin de série** : voix de réussite et danse de victoire si personne n'est perdu (un Zoombini sauvé tiré sans remise toutes les 30 ticks, `SCRS` 12044 + pieds) ; sinon voix de
 *     regret selon le niveau. « go » : les trois premiers wagonnets partent (`SCRB` 11072 à 11074, `SCRS` 12041 à 12043), puis écran suivant ; les non testés sont perdus.
 *
 * ## Écarts avec l'original (voir aussi `docs/zoombinis/puzzles/smoke.md` §11)
 *
 *  - dépôt d'un Zoombini : cibles ponctuelles du kit (wagonnet de gauche et 20 places d'attente, carré de prise 35) au lieu de la zone rectangulaire et des 5 colonnes d'accrochage ;
 *  - niveaux 3-4 : l'enchaînement des arrivées (`SCRB` 11033 à 11035, événements 30 à 38) est reconstruit : le premier du groupe et le suivant arrivent à l'entrée (11033 puis 11034),
 *    après chaque tour le suivant monte sur la plate-forme (11035, `SCRS` 12040) et le nouveau suivant arrive (11034) ; niveau 4, la nouvelle paire arrive après le second testé ;
 *    **probable**. Le levier ne se tire pas avant l'arrivée du premier (l'original l'arme dès l'entrée) ;
 *  - `SCRS` 12038 se termine sur une image vide (événement 25, sans cas) : le Zoombini est remis en pose d'attente sur la plate-forme à la fin ;
 *  - le test du niveau 4 pour le second se lance à la fin du socle `SCRB` 11011 (événement 18) ; la cible n° 8 glisse de (580, 258) à (548, 255) ; **probable** ;
 *  - le Zoombini garé garde la dernière image de sa traversée ; « go » ne fait partir que les trois premiers wagonnets et les trois premiers sauvés (`SCRS` 12041 à 12043), depuis leur
 *    place ; « go » est sans effet pendant un tour ;
 *  - rayon de surbrillance des emplacements (`SCRB` 11006 / 11007) et dalle verte (11076) : jouées une fois au début du transport ;
 *  - les objets de puzzle (silhouettes, filtres, cristaux, fiches) sont de simples dessins ; le glisser suit le protocole du kit (`carryObject`) : relâcher dépose, ou, avec la souris
 *    aimantée, le clic suivant ;
 *  - mode de test (`[a43f]`, `1158:2504`) : voir `testKeys` ; le texte va sur la ligne d'état commune (`showDebugLine`), dont le fond et le cadre ne sont pas ceux, locaux, de l'original (`11e8:3034(…, 0x0b)`).
 */
import { drawShape } from "../../../../engine/mohawk/graphics/blit";
import type { Surface } from "../../../../engine/mohawk/graphics/surface";
import type { KeyEvent } from "../../../../engine/mohawk/input";
import type { Archive } from "../../../../engine/mohawk/resources";
import { NoRepeatPool } from "../../../../engine/mohawk/rng";
import { screenInfo } from "../../data/archives";
import { DIALOG } from "../../engine/dialog";
import { FEATURES, FeatureFlag, type Feature, type Features } from "../../engine/features";
import { ZOOMBINIS_GAME } from "../../engine/game";
import { regs, scrs } from "../../engine/resources";
import type { Scene, SceneContext } from "../../engine/scene";
import { showDebugLine } from "../../engine/shortcuts";
import { currentLevel, dialogMemoryIndex } from "../../game/route";
import {
  SILHOUETTES,
  SMOKE_PALETTE_ID,
  SMOKE_SHEET_ID,
  SMOKE_SHEET_REGS_X,
  SMOKE_SHEET_REGS_Y,
  applyCrystal,
  chooseMember,
  chooseSilhouette,
  createSmoke,
  endTurn,
  goActive,
  isFinished,
  leverArmed,
  newRound,
  objectParts,
  placeCrystal,
  pull,
  releaseMember,
  releaseSilhouette,
  removeCrystal,
  type SmokeLevel,
  type SmokeSide,
  type SmokeState,
} from "../../game/puzzles/smoke";
import type { Attrs, Zoombini } from "../../game/state";
import { createPuzzleKit, createTarget, sheetButtonImages, type DropInfo, type DropTarget, type KitMember, type PointerInfo, type PuzzleKit, type Rect } from "../puzzle-kit";
import { closeScreen, openScreen } from "../screen-kit";
import { screenScripts } from "../snoid";
import { dialogChoice } from "../xfer";

const SCREEN = 17;

type Point = { x: number; y: number };

/** Fond et palette (`SHPL` / `tBMP` 5000), formes des scripts (`tBMP` 11000, 98 images, positions absolues), boutons (`tBMP` 6000). */
const BACKGROUND = SMOKE_PALETTE_ID;
const GROUP_SHAPES = 11000;
const SCRB_FIRST = 11000;
const SCRB_COUNT = 78;
const BUTTONS_SHEET = 6000;

/** `SCRB` (§2.2, §6.1). */
const SCRB = {
  dropZone: 11001,
  leverTest: 11002,
  leverArmed: 11003,
  leverRound: 11004,
  leverRoundReady: 11005,
  lightLeft: 11006,
  lightRight: 11007,
  front: 11008,
  pulley: 11009,
  pedestalLift: 11011,
  pedestalDrop: 11012,
  pedestal: 11013,
  intro: 11015,
  introFront: 11016,
  crystal: 11017,
  beamA: 11018,
  beamB: 11019,
  emptyWagon: 11032,
  arrivalA: 11033,
  arrivalB: 11034,
  arrivalNext: 11035,
  wagonOut: 11036,
  parked: 11071,
  departure: 11072,
  green: 11076,
  front2: 11077,
} as const;
/** Séquences de résultat (arrière puis avant) : niveaux 1-2 et 3-4, sauvé et piégé. */
const RESULT = {
  low: { saved: [11024, 11025], lost: [11026, 11027] },
  high: { saved: [11028, 11029], lost: [11030, 11031] },
} as const;

/** `SCRS` : marche du résultat (réussite / échec, niveaux 1-2 puis 3-4, + pieds), trajet du wagonnet 12020 + k, arrivées, départ au « go » 12041 + i, danse 12044 + pieds. */
const SCRS_ID = {
  walkSaved: [11999, 12009],
  walkLost: [12004, 12014],
  ride: 12020,
  arriveA: 12038,
  arriveB: 12039,
  arriveNext: 12040,
  departure: 12041,
  dance: 12044,
} as const;

/** Délais entre images (`11a8:0ad6`) : socle 10, les autres 6, levier 5. */
const DELAY = { default: 6, pedestal: 10, lever: 5, none: 0 } as const;

/** Événements (octet bas du terminateur − 1, §5.4). */
const EVENT = {
  introEnd: 1,
  test: 2,
  roundEnd: 3,
  sweepEnd: 4,
  walkLow: [10, 11],
  walkHigh: [13, 14],
  bounce: 16,
  leave: 17,
  arriveA: 30,
  arrivalWagonB: 31,
  arriveB: 35,
  arrivedB: 36,
  next: 37,
  pair: 38,
  turnEnd: 50,
  departed: 60,
  targetSwap: 17,
  targetSet: 18,
  pedestalReady: 19,
} as const;

/** Profondeurs : décor 0, avant-plan et wagonnets garés 0,8, wagonnet de sortie 0,9, objets de puzzle 0,5 (les Zoombinis sont à 1 + y / 1000). */
const DEPTH = { piece: 0.5, front: 0.8, parked: 0.85, out: 0.9 } as const;

/** Zones (§2.3) : levier `DS:2018`, cristal droit `DS:1f38`. */
const LEVER_ZONE: Rect = { left: 9, top: 300, right: 75, bottom: 364 };
const CRYSTAL_ZONE: Rect = { left: 525, top: 211, right: 582, bottom: 300 };

/** 20 places d'attente `DS:21f0` (niveaux 1-2) et wagonnet de gauche (pieds, premier point de `SCRS` 12000). */
export const SMOKE_PLACES: readonly Point[] = [
  { x: 214, y: 128 }, { x: 175, y: 126 }, { x: 135, y: 127 }, { x: 94, y: 126 }, { x: 53, y: 128 },
  { x: 237, y: 176 }, { x: 196, y: 177 }, { x: 150, y: 178 }, { x: 110, y: 176 }, { x: 69, y: 178 },
  { x: 234, y: 36 }, { x: 195, y: 37 }, { x: 155, y: 36 }, { x: 114, y: 35 }, { x: 73, y: 38 },
  { x: 237, y: 79 }, { x: 196, y: 78 }, { x: 150, y: 80 }, { x: 110, y: 78 }, { x: 69, y: 79 },
];
export const SMOKE_WAGON: Readonly<Point> = { x: 42, y: 262 };
/** Niveaux 3-4 : entrée des wagonnets (premier point de `SCRS` 12038), plate-forme de gauche, file d'attente (dernier point de `SCRS` 12039). */
const ARRIVAL_START: Point = { x: -8, y: 258 };
export const SMOKE_PLATFORM: Readonly<Point> = { x: 58, y: 260 };
export const SMOKE_QUEUE: Readonly<Point> = { x: 19, y: 257 };
const PLATFORM = SMOKE_PLATFORM;
const QUEUE = SMOKE_QUEUE;
/** Départ du wagonnet de sortie : premier point de `SCRS` 12020 + k. */
const RIDE_START: Point = { x: 530, y: 384 };

/** Étagères des silhouettes `DS:1ed0` et des cristaux `DS:1ef4` (p = 1 à 6), filtres `DS:1f18`, cristaux de l'écran. */
const SILHOUETTE_POS: readonly Point[] = [
  { x: 459, y: 26 }, { x: 535, y: 25 }, { x: 429, y: 80 }, { x: 500, y: 84 }, { x: 619, y: 76 }, { x: 423, y: 168 }, { x: 525, y: 167 }, { x: 605, y: 163 },
];
const SHELF_POS: readonly Point[] = [
  { x: 441, y: 66 }, { x: 531, y: 70 }, { x: 605, y: 67 }, { x: 421, y: 160 }, { x: 483, y: 153 }, { x: 612, y: 153 },
];
const FILTER_POS: readonly Point[] = [{ x: 187, y: 255 }, { x: 247, y: 255 }, { x: 424, y: 255 }, { x: 484, y: 255 }];
const LEFT_CRYSTAL_POS: Point = { x: 124, y: 255 };
const RIGHT_CRYSTAL_POS: Point = { x: 548, y: 255 };
const TARGET2_START: Point = { x: 616, y: 253 };
/** Trajet du pilier de cible, niveau 4 (`DS:1f28 + 4 × [94ba]`) : le second arrive en (580, 258) puis se pose en (548, 255). */
const TARGET2_ENTER: Point = { x: 580, y: 258 };
/** Positions des cristaux posés (`DS:1f40`, `DS:1f64`) selon le nombre posé du côté (1 à 3), de gauche à droite. */
const LEFT_SLOTS: readonly (readonly Point[])[] = [
  [{ x: 211, y: 255 }],
  [{ x: 187, y: 255 }, { x: 247, y: 255 }],
  [{ x: 164, y: 255 }, { x: 211, y: 255 }, { x: 258, y: 255 }],
];
const RIGHT_SLOTS: readonly (readonly Point[])[] = [
  [{ x: 457, y: 255 }],
  [{ x: 424, y: 255 }, { x: 484, y: 255 }],
  [{ x: 409, y: 255 }, { x: 457, y: 255 }, { x: 505, y: 255 }],
];
/** Cases d'insertion (`DS:1f88`, `DS:1fd0`) selon le nombre déjà posé du côté (0 à 2) : une case par indice d'insertion, de gauche à droite. */
const LEFT_CASES: readonly (readonly Rect[])[] = [
  [{ left: 185, top: 230, right: 245, bottom: 293 }],
  [{ left: 137, top: 230, right: 197, bottom: 293 }, { left: 236, top: 230, right: 296, bottom: 293 }],
  [{ left: 124, top: 230, right: 184, bottom: 293 }, { left: 197, top: 230, right: 257, bottom: 293 }, { left: 265, top: 230, right: 325, bottom: 293 }],
];
const RIGHT_CASES: readonly (readonly Rect[])[] = [
  [{ left: 426, top: 230, right: 486, bottom: 293 }],
  [{ left: 372, top: 230, right: 432, bottom: 293 }, { left: 474, top: 230, right: 534, bottom: 293 }],
  [{ left: 350, top: 230, right: 400, bottom: 293 }, { left: 419, top: 230, right: 469, bottom: 293 }, { left: 485, top: 230, right: 535, bottom: 293 }],
];

/**
 * Fiches comparées (porte-fiche `DS:2030`) : abscisses, ordonnée de repos et rebonds, un par événement 16 (`DS:2038` / `DS:2070` réussite, 13 entrées ;
 * `DS:20a8` / `DS:20ec` échec, 17 entrées ; abscisses constantes). Les séquences de résultat envoient 12 (réussite) ou 15 (échec) événements 16 : les fiches
 * montent (ou descendent) puis reviennent à leur ordonnée de repos.
 */
const FICHE_X = [317, 354] as const;
const FICHE_HOME_Y = 254;
const BOUNCE_SAVED = [263, 248, 236, 210, 201, 192, 201, 210, 236, 248, 263, 254, 254] as const;
const BOUNCE_LOST = [257, 261, 264, 267, 270, 274, 277, 280, 277, 270, 267, 264, 261, 257, 254, 254, 254] as const;

/**
 * Orientations des objets (`+0xf1`, posées par `1158:4a01` et `1158:4500`, dessinées par `1140:0000`, `ORIENTATION_SET`) : silhouette 1 ; filtre, cristal posé de gauche 0, de droite 2 ;
 * étagère 7 ; cible 5, seconde cible 3 ; cristal de gauche de l'écran (le Zoombini testé, tous niveaux) 8, cristal de droite (la silhouette posée, sur le cristal vide du
 * socle) 5 ; fiches comparées 5 (gauche) et 3 (droite), sans cristal de fond.
 */
const ORIENTATION = { left: 0, silhouette: 1, right: 2, second: 3, target: 5, shelf: 7, crystalLeft: 8, crystalRight: 5, ficheLeft: 5, ficheRight: 3 } as const;

/** Voix, danse, sortie : écart de la danse de victoire (30 ticks), nombre de wagonnets qui partent au « go ». */
const DANCE_GAP = 30;
const DEPARTING = 3;
/** Rythme d'affichage des cristaux : la valeur incrémentée tourne toutes les 60 ticks sur l'étagère et clignote toutes les 30 ticks sur la voie (`1158:620c`). */
const ROTATE_TICKS = 60;
const BLINK_TICKS = 30;
/** Carré de prise des Zoombinis (`DS:9706`) : plus large que le défaut du kit (15) pour les cibles ponctuelles. */
const DROP_RADIUS = 35;

const F = FeatureFlag;
/** `0x5188000` : feature statique (première image seule, sans son). */
/** Décor figé que `1158:0000` crée sans le bit `0x1000000` (piédestal `0x4188000`, poulie `0x4000000`, avant-plans `0x4100000`, levier `0x4180000`, wagonnets `0x4108000`). */
const STILL = F.flag4000000 | F.still | F.stopAtEnd | F.noReplay | F.active | F.firstImage;
/** Objets que `1158:0000` crée avec le bit `0x1000000` (`0x5188000`, `0x5180000`, `0xd180000`, zone de dépôt `0x108a000`) : vert, lampes, faisceaux, wagonnet sortant. */
const STILL_BIT = F.flag4000000 | F.playOnly | F.stopAtEnd | F.noReplay | F.active | F.firstImage;
/** Feature qui joue ses scripts une fois (puis s'arrête sur la dernière image). */
const PLAYS = F.flag4000000 | F.stopAtEnd | F.active;

/** Un objet de puzzle dessiné avec la planche 10000 (silhouette, filtre, cristal, cible, fiche). */
interface Piece {
  readonly feature: Feature;
  /** Orientation (`+0xf1`) : fixe, ou selon la place (cristal posé à gauche, à droite, ou sur son étagère). */
  readonly orientation: number | (() => number);
  /** Position de repos ; null = absent. */
  readonly place: () => Point | null;
  /** Attributs affichés ; null = rien. */
  readonly attrs: () => Attrs | null;
  /** Position imposée pendant le transport. */
  override: Point | null;
}

/** Fenêtre sur l'épreuve en cours, pour les tests. */
export interface SmokeProbe {
  readonly kit: PuzzleKit;
  readonly state: SmokeState;
  readonly level: SmokeLevel;
  /** Une séquence (levier, test, arrivée) est en cours : aucune saisie. */
  readonly locked: boolean;
  /** Niveaux 3-4 : le Zoombini courant est arrivé sur la plate-forme. */
  readonly ready: boolean;
  readonly leaving: boolean;
  /** Fiches comparées affichées (après le levier), ou null ; leur ordonnée (repos 254, puis les rebonds de l'événement 16). */
  readonly fiches: { left: Attrs; right: Attrs } | null;
  readonly ficheY: number;
  /** Script du levier et de la cible n° 8 (niveau 4). */
  readonly leverScript: number;
  readonly secondTarget: Point | null;
  readonly parked: readonly (Feature | undefined)[];
  /** Membres sauvés, dans l'ordre où ils l'ont été (`[9358]`). */
  readonly saved: readonly number[];
  /** Centre du rectangle d'une silhouette (niveaux 1-2) ou d'un cristal (niveaux 3-4) tel qu'il est dessiné, ou null. */
  silhouetteAt(k: number): Point | null;
  crystalAt(n: number): Point | null;
  /** Centre de la zone du levier et du cristal de droite. */
  readonly leverPoint: Point;
  readonly crystalPoint: Point;
  /** Point d'une case d'insertion (côté, indice) pour le nombre de cristaux déjà posés du côté. */
  casePoint(side: SmokeSide, slot: number): Point;
  /** Orientation (`+0xf1`) avec laquelle un objet est dessiné : cristaux de l'écran, fiches, ou cristal n° `n` (1 à 6). */
  orientationOf(piece: "crystalLeft" | "crystalRight" | "ficheLeft" | "ficheRight" | number): number | null;
  readonly hasWon: boolean;
}

export type SmokeScene = Scene & { readonly probe: SmokeProbe | null };

/** Dernier point des cases (première partie de la dernière image qui en a une) d'un `SCRS` : où le Zoombini se trouve à la fin de son script. */
function scriptEnd(archive: Archive, id: number): Point | null {
  const images = scrs(archive, id).images;
  for (let i = images.length - 1; i >= 0; i--) {
    const cell = images[i]!.cells[0];
    if (cell && cell.w > 0) return { x: cell.x, y: cell.y };
  }
  return null;
}

function inside(rect: Rect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** Plus petit rectangle qui contient les deux (null si aucun). */
function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a || !b) return a ?? b;
  return { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) };
}

function centre(rect: Rect): Point {
  return { x: (rect.left + rect.right) >> 1, y: (rect.top + rect.bottom) >> 1 };
}

class SmokeRun implements SmokeProbe {
  readonly kit: PuzzleKit;
  readonly level: SmokeLevel;
  state!: SmokeState;
  locked = false;
  ready = false;
  leaving = false;
  fiches: { left: Attrs; right: Attrs } | null = null;
  readonly parked: (Feature | undefined)[] = [];

  private readonly features: Features;
  private readonly party: Zoombini[];
  private readonly shapes: ReturnType<Archive["tbmpImages"]>;
  private readonly anchorX: Int16Array;
  private readonly anchorY: Int16Array;
  private readonly wagonTarget: DropTarget;
  /** Zone de dépôt (`SCRB` 11001, niveaux 1 et 2) : surbrillance du wagonnet survolé. */
  private dropZone: Feature | undefined;
  private readonly pool: NoRepeatPool;

  // Features de la machine (noms d'après §2.2).
  private readonly pedestal: Feature;
  private readonly green: Feature | null = null;
  private readonly lightLeft: Feature;
  private readonly lightRight: Feature;
  private readonly crystalBack: Feature;
  private readonly crystalFront: Feature;
  private readonly beamA: Feature;
  private readonly beamB: Feature;
  private readonly wagonOut: Feature;
  private readonly lever: Feature;
  private readonly wagonA: Feature;
  private readonly wagonB: Feature | null = null;

  // Objets de puzzle.
  private readonly pieces: Piece[] = [];
  private readonly silhouettes: Piece[] = [];
  private readonly crystals: Piece[] = [];
  private readonly ficheView: Piece[] = [];
  private crystalLeft: Piece | null = null;
  private crystalRight: Piece | null = null;

  /** Cible n° 8 : position (niveau 4) ; la cible n° 7 est cachée pendant le test du second. */
  private target8At: Point | null = null;
  private targetsShown = true;
  private leverShown = -1;
  private ficheStep = 0;
  private rideEnds = new Map<number, Point>();
  private readonly savedOrder: number[] = [];
  private dancing = false;
  private danced = 0;
  private lastDance = 0;
  private departed = 0;
  private departing = 0;
  private finished = false;
  private lastPulse = -1;

  constructor(
    private readonly ctx: SceneContext,
    private readonly archive: Archive,
  ) {
    const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
    const { game, session } = zoombinis;
    session.screen = SCREEN;
    this.level = (currentLevel(game, session, SCREEN) + 1) as SmokeLevel;
    const low = this.level <= 2;
    openScreen(ctx, archive, { background: BACKGROUND });
    this.features = ctx.services.get(FEATURES);
    this.party = game.group.members.filter((z) => z.present).map((z) => ({ ...z, attrs: [...z.attrs] as Zoombini["attrs"], state: z.state.slice() }));
    if (this.party.length < 1 || this.party.length > 16) throw new RangeError(`piège de cristal : ${this.party.length} Zoombinis`);
    this.pool = new NoRepeatPool(Math.max(1, Math.min(32, this.party.length)));
    this.shapes = archive.tbmpImages(SMOKE_SHEET_ID);
    this.anchorX = regs(archive, SMOKE_SHEET_REGS_X);
    this.anchorY = regs(archive, SMOKE_SHEET_REGS_Y);

    // Décor, dans l'ordre de création d'`Enter` ; les Zoombinis (créés ensuite) sont devant (1 + y / 1000).
    const f = this.features;
    f.defineGroup(0, GROUP_SHAPES);
    f.setScripts(SCRB_FIRST, SCRB_COUNT);
    this.pedestal = f.create({ script: low || this.level === 3 ? SCRB.pedestal : SCRB.pedestalLift, delay: DELAY.pedestal, flags: STILL });
    if (low) this.green = f.create({ script: SCRB.green, delay: DELAY.default, flags: STILL_BIT });
    this.lightLeft = f.create({ script: SCRB.lightLeft, delay: DELAY.default, flags: STILL_BIT });
    this.lightRight = f.create({ script: SCRB.lightRight, delay: DELAY.default, flags: STILL_BIT });
    this.crystalBack = f.create({ script: SCRB.intro, delay: DELAY.default, flags: PLAYS });
    this.crystalFront = f.create({ script: SCRB.introFront, delay: DELAY.default, flags: PLAYS });
    this.beamA = f.create({ script: SCRB.beamA, delay: DELAY.default, flags: STILL_BIT });
    this.beamB = f.create({ script: SCRB.beamB, delay: DELAY.default, flags: STILL_BIT });
    f.create({ script: SCRB.pulley, delay: DELAY.default, flags: STILL });
    this.wagonOut = f.create({ script: SCRB.wagonOut, delay: DELAY.default, flags: STILL_BIT, depth: DEPTH.out });
    f.create({ script: SCRB.front, delay: DELAY.none, flags: STILL, depth: DEPTH.front });
    f.create({ script: SCRB.front2, delay: DELAY.none, flags: STILL, depth: DEPTH.front });
    this.lever = f.create({ script: SCRB.leverTest, delay: DELAY.lever, flags: STILL });
    if (low) {
      // `0x4108000` (sans `0x2000`) : le wagonnet vide arrive sur la plate-forme de gauche dès l'entrée (`SCRB` 11032, 9 images).
      this.wagonA = f.create({ script: SCRB.emptyWagon, delay: DELAY.default, flags: PLAYS });
      // Zone de dépôt (le wagonnet de gauche) : `0x108a000` (`1158:07c7`), avec le bit `0x1000000` : dessinée seulement pendant sa surbrillance, quand un
      // Zoombini porté la survole (`1168:1742`, `DropTarget.highlight`).
      this.dropZone = f.create({ script: SCRB.dropZone, delay: 7, flags: STILL_BIT });
    } else {
      this.wagonA = f.create({ script: SCRB.arrivalA, delay: DELAY.default, flags: STILL });
      this.wagonB = f.create({ script: SCRB.arrivalB, delay: DELAY.default, flags: STILL });
    }
    this.crystalBack.onEvent = (_image, n) => {
      if (n === EVENT.introEnd) this.still(this.crystalBack, SCRB.crystal);
    };

    this.buildPieces();
    // Au doigt (extension tactile, bug 18), le wagonnet est pris aussi quand le doigt est sur son image : celle du wagonnet vide (11032) ou de la zone de dépôt.
    const dropZone = this.dropZone;
    const wagon = this.wagonA;
    this.wagonTarget = createTarget(SMOKE_WAGON, "wagon", dropZone ? () => union(dropZone.rect, wagon.rect) : undefined);
    if (dropZone) this.wagonTarget.highlight = dropZone;
    const buttons = sheetButtonImages(archive.tbmpImages(BUTTONS_SHEET));
    this.kit = createPuzzleKit(ctx, {
      screen: SCREEN,
      party: this.party,
      // Niveaux 3-4 : les Zoombinis ne sont pas affichés à l'entrée (cachés, `+0xe0 = 0`) ; ils arrivent un à un en wagonnet.
      places: low ? SMOKE_PLACES : this.party.map(() => ({ x: -100, y: -100 })),
      targets: (places) => (low ? [...places, this.wagonTarget] : []),
      radius: DROP_RADIUS,
      introVoice: 0,
      snoid: { scripts: screenScripts(archive) },
      waitAnimations: low,
      buttons: { map: { images: buttons.map }, go: { images: buttons.go, onPress: () => this.pressGo() } },
      canPick: (member) => this.canPick(member),
      onPick: (member) => this.picked(member),
      decide: (drop) => this.decide(drop),
      onDrop: (drop) => this.dropped(drop),
      onReturn: (drop) => this.returned(drop),
      onPointer: (event) => this.pointer(event),
    });
    this.kit.arrive(low ? { startDelay: 30, step: 45 } : { startDelay: 0, step: 0, standing: true });
    // `1158:0000` tire la mise en place après la création des Zoombinis.
    this.state = createSmoke(ctx.rng, this.level, this.party.map((z) => z.attrs));
    this.kit.introVoice = this.state.introVoice;
    // `1168:3dd0(0, 0)` : personne n'est sauvé (`+0x127 = 0`).
    this.kit.markAll(false);
    this.kit.playMusic();
    // `1168:5c57` : une visite de plus de l'écran (mémoire de dialogue 13).
    const slot = dialogMemoryIndex(SCREEN);
    if (slot >= 0) game.dialogMemory[slot] = dialogChoice(game.dialogMemory[slot]!, this.level - 1, session.training !== 0).memory;
    if (!low) {
      // Niveaux 3-4 : le Zoombini courant et le suivant arrivent en wagonnet.
      if (this.level === 4) this.target8At = TARGET2_START;
      this.arrivePair(() => {
        this.ready = true;
        this.locked = false;
      });
    }
    ctx.requestPresent();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Fenêtre pour les tests

  get saved(): readonly number[] {
    return this.savedOrder;
  }

  get leverScript(): number {
    return this.lever.scriptId;
  }

  get secondTarget(): Point | null {
    return this.level === 4 ? this.target8At : null;
  }

  get leverPoint(): Point {
    return centre(LEVER_ZONE);
  }

  get crystalPoint(): Point {
    return centre(CRYSTAL_ZONE);
  }

  get hasWon(): boolean {
    return isFinished(this.state) && this.state.savedCount === this.party.length;
  }

  silhouetteAt(k: number): Point | null {
    const piece = this.silhouettes[k];
    return piece ? this.centreOf(piece) : null;
  }

  crystalAt(n: number): Point | null {
    const piece = this.crystals[n - 1];
    return piece ? this.centreOf(piece) : null;
  }

  casePoint(side: SmokeSide, slot: number): Point {
    const list = side === "left" ? this.state.left : this.state.right;
    const cases = (side === "left" ? LEFT_CASES : RIGHT_CASES)[Math.min(list.length, 2)]!;
    return centre(cases[slot]!);
  }

  orientationOf(piece: "crystalLeft" | "crystalRight" | "ficheLeft" | "ficheRight" | number): number | null {
    const found =
      typeof piece === "number"
        ? this.crystals[piece - 1]
        : piece === "crystalLeft"
          ? this.crystalLeft
          : piece === "crystalRight"
            ? this.crystalRight
            : this.ficheView[piece === "ficheLeft" ? 0 : 1];
    if (!found) return null;
    return typeof found.orientation === "number" ? found.orientation : found.orientation();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Aides d'animation

  /** Joue le script `id` sur la feature (rappel d'événement remplacé) : `FEATURE_END` arrive aussi au rappel. */
  private play(feature: Feature, id: number, handler?: (n: number) => void): void {
    feature.onEvent = handler ? (_image, n) => handler(n) : undefined;
    feature.flags |= F.stopAtEnd;
    this.features.setScript(feature, id);
  }

  /**
   * Remet la feature en pose statique sur la première image de `id`, sans son. `bit` : l'original pose les drapeaux avec le bit `0x1000000` (`0x5188000` :
   * lampes `1158:2107`, wagonnet sortant `1158:21c3`) ; sinon sans (`0x4188000` : cristal `1158:201c`, levier, piédestal).
   */
  private still(feature: Feature, id: number, bit = false): void {
    feature.onEvent = undefined;
    feature.scriptId = id;
    feature.replacing = true;
    feature.active = true;
    feature.flags = (feature.flags & ~(F.playOnly | F.still)) | (bit ? F.playOnly : F.still) | F.noReplay | F.stopAtEnd;
    this.features.invalidate();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Objets de puzzle (planche 10000)

  private addPiece(orientation: Piece["orientation"], place: () => Point | null, attrs: () => Attrs | null, depth: number = DEPTH.piece): Piece {
    const piece: Piece = {
      orientation,
      place,
      attrs,
      override: null,
      feature: this.features.create({ script: 0, delay: 0, flags: 0, depth, onAfterDraw: (_feature, screen) => this.drawPiece(piece, screen) }),
    };
    this.pieces.push(piece);
    return piece;
  }

  /** Cases `(w, x, y)` d'un objet : chaque partie est posée à `(x − REGS_X[w], y − REGS_Y[w])` (`1140:0000`). */
  private partsOf(piece: Piece): { w: number; x: number; y: number }[] {
    const at = piece.override ?? piece.place();
    const attrs = piece.attrs();
    if (!at || !attrs) return [];
    const orientation = typeof piece.orientation === "number" ? piece.orientation : piece.orientation();
    return objectParts(orientation, attrs).map((w) => ({ w, x: at.x - (this.anchorX[w] ?? 0), y: at.y - (this.anchorY[w] ?? 0) }));
  }

  private drawPiece(piece: Piece, screen: Surface): void {
    for (const part of this.partsOf(piece)) {
      const shape = this.shapes[part.w - 1];
      if (shape) drawShape(screen, shape, part.x, part.y, 8);
    }
  }

  private rectOf(piece: Piece): Rect | null {
    let rect: Rect | null = null;
    for (const part of this.partsOf(piece)) {
      const shape = this.shapes[part.w - 1];
      if (!shape) continue;
      rect = rect
        ? { left: Math.min(rect.left, part.x), top: Math.min(rect.top, part.y), right: Math.max(rect.right, part.x + shape.width - 1), bottom: Math.max(rect.bottom, part.y + shape.height - 1) }
        : { left: part.x, top: part.y, right: part.x + shape.width - 1, bottom: part.y + shape.height - 1 };
    }
    return rect;
  }

  private centreOf(piece: Piece): Point | null {
    const rect = this.rectOf(piece);
    return rect ? centre(rect) : null;
  }

  private buildPieces(): void {
    const s = (): SmokeState => this.state;
    if (this.level <= 2) {
      for (let k = 0; k < SILHOUETTES; k++) {
        this.silhouettes[k] = this.addPiece(
          ORIENTATION.silhouette,
          () => (s()?.silhouette === k ? null : SILHOUETTE_POS[k]!),
          () => s()?.silhouettes[k] ?? null,
        );
      }
      if (this.level === 2) {
        FILTER_POS.forEach((at, i) => this.addPiece(i < 2 ? ORIENTATION.left : ORIENTATION.right, () => at, () => s()?.filters[i] ?? null));
      }
      // Cristal de gauche (le Zoombini testé) et de droite (la silhouette posée), `26d7`.
      this.crystalLeft = this.addPiece(ORIENTATION.crystalLeft, () => LEFT_CRYSTAL_POS, () => (s()?.current != null ? s()!.members[s()!.current!]! : null));
      this.crystalRight = this.addPiece(ORIENTATION.crystalRight, () => RIGHT_CRYSTAL_POS, () => (s()?.silhouette != null ? s()!.silhouettes[s()!.silhouette!]! : null));
    } else {
      this.crystalLeft = this.addPiece(ORIENTATION.crystalLeft, () => LEFT_CRYSTAL_POS, () => (this.ready && s()?.current != null ? s()!.members[s()!.current!]! : null));
      this.addPiece(
        ORIENTATION.target,
        () => (this.targetsShown && !s()?.second ? RIGHT_CRYSTAL_POS : null),
        () => s()?.target ?? null,
      );
      if (this.level === 4) {
        this.addPiece(
          ORIENTATION.second,
          () => (s()?.second || this.target8At !== TARGET2_START ? this.target8At : null),
          () => (s()?.second ? s()!.target2 : null),
        );
      }
      for (let n = 1; n <= 6; n++) {
        // `1158:1429` : 0 posé à gauche, 2 posé à droite, 7 repris (sur l'étagère ou porté).
        this.crystals[n - 1] = this.addPiece(
          () => (s()?.left.includes(n) ? ORIENTATION.left : s()?.right.includes(n) ? ORIENTATION.right : ORIENTATION.shelf),
          () => this.crystalPlace(n),
          () => this.crystalAttrs(n),
        );
      }
    }
    // Fiches comparées `[9422]` / `[9424]`.
    for (const side of [0, 1]) {
      this.ficheView[side] = this.addPiece(
        side === 0 ? ORIENTATION.ficheLeft : ORIENTATION.ficheRight,
        () => (this.fiches ? { x: FICHE_X[side]!, y: this.ficheY } : null),
        () => (this.fiches ? (side === 0 ? this.fiches.left : this.fiches.right) : null),
      );
    }
  }

  ficheY = FICHE_HOME_Y;

  /** Position d'un cristal : posé sur la voie (selon le nombre du côté) ou sur son étagère (`[94dc]`). */
  private crystalPlace(n: number): Point | null {
    const s = this.state;
    if (!s) return null;
    const left = s.left.indexOf(n);
    if (left >= 0) return LEFT_SLOTS[s.left.length - 1]![left]!;
    const right = s.right.indexOf(n);
    if (right >= 0) return RIGHT_SLOTS[s.right.length - 1]![right]!;
    return SHELF_POS[(s.shelf[n] ?? n) - 1]!;
  }

  /**
   * Attributs affichés d'un cristal (`1158:620c`) : les attributs fixés ; l'attribut incrémenté tourne de 1 à 5 sur l'étagère (60 ticks) et, posé, clignote entre 0 et sa valeur
   * calculée par la chaîne (30 ticks).
   */
  private crystalAttrs(n: number): Attrs | null {
    const s = this.state;
    const crystal = s?.crystals[n - 1];
    if (!crystal) return null;
    const attrs: Attrs = [...crystal.fixed];
    if (crystal.incr === null) return attrs;
    const ticks = this.ctx.clock.ticks;
    if (s.left.includes(n) || s.right.includes(n)) {
      attrs[crystal.incr] = Math.floor(ticks / BLINK_TICKS) % 2 === 0 ? this.chainValue(n) : 0;
    } else {
      attrs[crystal.incr] = 1 + (Math.floor(ticks / ROTATE_TICKS) % 5);
    }
    return attrs;
  }

  /** Valeur de l'attribut incrémenté du cristal posé `n` : la fiche de son côté transformée par les cristaux jusqu'à lui (`1158:2ad9`, `2d23`). */
  private chainValue(n: number): number {
    const s = this.state;
    const crystal = s.crystals[n - 1]!;
    const left = s.left.indexOf(n);
    const running: Attrs = left >= 0 ? [...s.members[s.current ?? s.rank] ?? [0, 0, 0, 0]] : [...(s.second ? (s.target2 ?? s.target) : s.target)];
    if (left >= 0) {
      for (let i = 0; i <= left; i++) applyCrystal(s.crystals[s.left[i]! - 1]!, running);
    } else {
      const right = s.right.indexOf(n);
      for (let i = s.right.length - 1; i >= right; i--) applyCrystal(s.crystals[s.right[i]! - 1]!, running);
    }
    return running[crystal.incr!]!;
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Saisie (`1158:1429` région 3)

  /** Une pose est permise : ni séquence en cours, ni départ, pas entre deux tours, test non enregistré. */
  private get canEdit(): boolean {
    const s = this.state;
    if (this.locked || this.leaving || this.finished || !s || s.awaitingRound || s.pending || isFinished(s)) return false;
    return this.level <= 2 || (this.ready && !s.second);
  }

  private canPick(member: KitMember): boolean {
    return this.level <= 2 && this.canEdit && this.kit.walking < 1 && this.state.outcome[member.index] === null;
  }

  private picked(member: KitMember): void {
    if (this.state.current === member.index) releaseMember(this.state);
  }

  private decide(drop: DropInfo): boolean {
    if (drop.target?.tag === "wagon") return this.canEdit && this.state.current === null;
    return true;
  }

  private dropped(drop: DropInfo): void {
    if (drop.target?.tag === "wagon") chooseMember(this.state, drop.member.index);
  }

  private returned(drop: DropInfo): void {
    if (drop.from?.tag === "wagon") chooseMember(this.state, drop.member.index);
  }

  /** Appui du bouton gauche : levier, silhouette ou cristal (les Zoombinis sont pris par le kit). */
  private pointer(event: PointerInfo): boolean {
    if (!event.down || event.button !== "left" || this.leaving || this.finished) return false;
    if (this.kit.carrying || this.kit.carryingObject) return false;
    if (inside(LEVER_ZONE, event.x, event.y)) {
      this.leverClick();
      return true;
    }
    if (!this.canEdit) return false;
    if (this.level <= 2) return this.pickSilhouette(event);
    return this.pickCrystal(event);
  }

  private pickSilhouette(event: PointerInfo): boolean {
    const s = this.state;
    let k = -1;
    for (let i = SILHOUETTES - 1; i >= 0 && k < 0; i--) {
      const rect = this.rectOf(this.silhouettes[i]!);
      if (rect && inside(rect, event.x, event.y)) k = i;
    }
    // La silhouette posée sur le cristal de droite se reprend en cliquant dessus.
    if (k < 0 && s.silhouette !== null && inside(CRYSTAL_ZONE, event.x, event.y)) k = s.silhouette;
    if (k < 0) return false;
    const piece = this.silhouettes[k]!;
    const from = s.silhouette === k ? RIGHT_CRYSTAL_POS : SILHOUETTE_POS[k]!;
    // Le point de saisie par rapport à la position de l'objet : celle de la silhouette où elle se trouve (étagère) ou du cristal droit.
    const grab = { x: event.x - from.x, y: event.y - from.y };
    if (s.silhouette === k) releaseSilhouette(s);
    piece.override = { x: from.x, y: from.y };
    if (this.green) this.play(this.green, SCRB.green);
    const ok = this.kit.carryObject({
      origin: from,
      grab,
      feature: piece.feature,
      onMove: (at) => {
        piece.override = at;
        this.features.invalidate();
      },
      decide: () => inside(CRYSTAL_ZONE, this.ctx.input.mouseX, this.ctx.input.mouseY),
      onDrop: () => {
        piece.override = null;
        this.features.restack(piece.feature, DEPTH.piece);
        chooseSilhouette(s, k);
        this.features.invalidate();
      },
      onReturn: () => {
        piece.override = null;
        this.features.restack(piece.feature, DEPTH.piece);
        this.features.invalidate();
      },
    });
    if (!ok) {
      piece.override = null;
      if (s.silhouette === null && from === RIGHT_CRYSTAL_POS) chooseSilhouette(s, k);
      return false;
    }
    return true;
  }

  private pickCrystal(event: PointerInfo): boolean {
    const s = this.state;
    let n = 0;
    for (let i = 6; i >= 1 && n === 0; i--) {
      const rect = this.rectOf(this.crystals[i - 1]!);
      if (rect && inside(rect, event.x, event.y)) n = i;
    }
    if (n === 0) return false;
    const piece = this.crystals[n - 1]!;
    const from = piece.place()!;
    const grab = { x: event.x - from.x, y: event.y - from.y };
    // Un cristal posé quitte la chaîne dès qu'on le prend ; il retourne à son étagère s'il n'est pas reposé.
    removeCrystal(s, n);
    piece.override = { x: from.x, y: from.y };
    if (s.left.length < 3) this.play(this.lightLeft, SCRB.lightLeft);
    if (s.right.length < 3) this.play(this.lightRight, SCRB.lightRight);
    let chosen: { side: SmokeSide; slot: number } | null = null;
    const ok = this.kit.carryObject({
      origin: from,
      grab,
      feature: piece.feature,
      onMove: (at) => {
        piece.override = at;
        this.features.invalidate();
      },
      decide: () => {
        chosen = this.caseAt(this.ctx.input.mouseX, this.ctx.input.mouseY);
        return chosen !== null;
      },
      onDrop: () => {
        piece.override = null;
        this.features.restack(piece.feature, DEPTH.piece);
        if (chosen) placeCrystal(s, n, chosen.side, chosen.slot);
        this.stopLights();
        this.features.invalidate();
      },
      onReturn: () => {
        piece.override = null;
        this.features.restack(piece.feature, DEPTH.piece);
        this.stopLights();
        this.features.invalidate();
      },
    });
    if (!ok) piece.override = null;
    return ok;
  }

  /** Case d'insertion touchée par le pointeur (`DS:1f88`, `DS:1fd0`) ; null si le côté est plein ou si le point est hors des cases. */
  private caseAt(x: number, y: number): { side: SmokeSide; slot: number } | null {
    const s = this.state;
    for (const side of ["left", "right"] as const) {
      const list = side === "left" ? s.left : s.right;
      if (list.length >= 3) continue;
      const cases = (side === "left" ? LEFT_CASES : RIGHT_CASES)[list.length]!;
      const slot = cases.findIndex((rect) => inside(rect, x, y));
      if (slot >= 0) return { side, slot };
    }
    return null;
  }

  private stopLights(): void {
    this.still(this.lightLeft, SCRB.lightLeft, true);
    this.still(this.lightRight, SCRB.lightRight, true);
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Levier

  private leverClick(): void {
    const s = this.state;
    if (this.locked || this.leaving || this.finished) return;
    if (s.awaitingRound && (this.level <= 2 || this.ready)) {
      this.startRound();
      return;
    }
    if (!this.canEdit || !leverArmed(s)) return;
    this.locked = true;
    this.leverShown = -1;
    this.play(this.lever, SCRB.leverTest, (n) => {
      if (n === EVENT.test) this.startTest();
    });
  }

  /** Affiche le levier : au repos, armé (il clignote) ou « nouveau tirage » disponible (il clignote autrement). */
  private syncLever(): void {
    const s = this.state;
    if (!s || this.locked || this.leaving) return;
    const round = s.awaitingRound && (this.level <= 2 || this.ready);
    const armed = this.canEdit && leverArmed(s);
    const target = round ? SCRB.leverRoundReady : armed ? SCRB.leverArmed : SCRB.leverTest;
    if (target === this.leverShown) return;
    this.leverShown = target;
    if (target === SCRB.leverTest) {
      this.still(this.lever, target);
    } else {
      this.lever.onEvent = undefined;
      this.lever.flags &= ~F.stopAtEnd;
      this.features.setScript(this.lever, target);
    }
  }

  /** Levier « nouveau tirage » (`1158:2208`) : `newRound`, levier 11004 ; au niveau 4 le socle redescend (11012) et la nouvelle cible monte. */
  private startRound(): void {
    this.locked = true;
    this.leverShown = -1;
    this.fiches = null;
    this.ficheStep = 0;
    this.ficheY = FICHE_HOME_Y;
    if (!newRound(this.state, this.ctx.rng)) {
      this.locked = false;
      return;
    }
    this.features.invalidate();
    if (this.level === 4) {
      this.targetsShown = false;
      this.target8At = TARGET2_START;
      this.play(this.lever, SCRB.leverRound);
      this.play(this.pedestal, SCRB.pedestalDrop, (n) => {
        if (n !== EVENT.pedestalReady) return;
        this.targetsShown = true;
        this.still(this.pedestal, SCRB.pedestalLift);
        this.locked = false;
        this.features.invalidate();
      });
      return;
    }
    this.play(this.lever, SCRB.leverRound, (n) => {
      if (n !== EVENT.roundEnd) return;
      this.locked = false;
    });
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Test et résultat (`1158:3126`, `34b0`)

  /** Image 3 du levier : test (`1158:31e8`), fiches affichées, balayage de la machine. */
  private startTest(): void {
    const test = pull(this.state);
    if (!test) {
      this.locked = false;
      return;
    }
    // La place du wagonnet de gauche est libérée (le Zoombini part avec le test).
    this.wagonTarget.owner = null;
    const member = this.kit.members[test.member];
    if (member) {
      member.target = null;
      member.waiting = null;
    }
    this.fiches = { left: test.left, right: test.right };
    this.ficheStep = 0;
    this.ficheY = FICHE_HOME_Y;
    this.features.invalidate();
    this.play(this.beamA, SCRB.beamA);
    this.play(this.beamB, SCRB.beamB, (n) => {
      if (n === EVENT.sweepEnd) this.startResult();
    });
  }

  /** Fin du balayage (événement 4) : le cristal géant joue la séquence de résultat. */
  private startResult(): void {
    const pending = this.state.pending;
    if (!pending) return;
    const [back, front] = RESULT[this.level <= 2 ? "low" : "high"][pending.saved ? "saved" : "lost"];
    this.ficheStep = 0;
    // Niveaux 1-2 (`1158:34b0`) : le wagonnet d'arrivée passe en `0x5188000` sans jouer (caché) ; la séquence de résultat dessine elle-même le wagonnet qui part
    // avec le Zoombini. Le wagonnet vide suivant n'arrive qu'à la fin du tour.
    if (this.level <= 2) this.still(this.wagonA, SCRB.emptyWagon, true);
    this.play(this.crystalFront, front);
    this.play(this.crystalBack, back, (n) => this.resultEvent(n));
  }

  private resultEvent(n: number): void {
    const events: readonly number[] = this.level <= 2 ? EVENT.walkLow : EVENT.walkHigh;
    if (n === events[0] || n === events[1]) this.startWalk();
    else if (n === EVENT.bounce) this.bounce();
    else if (n === EVENT.leave) this.ride();
    else if (n === EVENT.introEnd) this.still(this.crystalBack, SCRB.crystal);
  }

  /** Événements 10, 11, 13, 14 (`1158:385e`) : le Zoombini quitte la plate-forme (sauvé : jusqu'au rail ; piégé : il tombe au fond). */
  private startWalk(): void {
    const pending = this.state.pending;
    const member = pending ? this.kit.members[pending.member] : undefined;
    if (!pending || !member) return;
    const { snoid } = member;
    const high = this.level <= 2 ? 0 : 1;
    const base = pending.saved ? SCRS_ID.walkSaved[high]! : SCRS_ID.walkLost[high]!;
    const id = base + snoid.traits.feet;
    const end = scriptEnd(this.archive, id);
    if (end) this.rideEnds.set(member.index, end);
    snoid.onEvent = undefined;
    snoid.onEnd = undefined;
    snoid.play(id, F.stopAtEnd, { kind: "normal" });
  }

  /** Événement 16 : les fiches rebondissent (`DS:2038` à `DS:20ec`). */
  private bounce(): void {
    const table = this.state.pending?.saved ? BOUNCE_SAVED : BOUNCE_LOST;
    this.ficheY = table[Math.min(this.ficheStep, table.length - 1)]!;
    this.ficheStep++;
    this.features.invalidate();
  }

  /** Événement 17 (`1158:3995`, `3622`) : le wagonnet de sortie roule vers sa place `k` ; le Zoombini sauvé y monte (`SCRS` 12020 + k), un piégé reste au fond (le wagonnet roule à vide). */
  private ride(): void {
    const pending = this.state.pending;
    if (!pending) return;
    const k = this.state.tested;
    const member = this.kit.members[pending.member];
    this.play(this.wagonOut, SCRB.wagonOut + k, (n) => {
      if (n === EVENT.turnEnd) this.endOfTurn();
    });
    if (!pending.saved || !member) return;
    const { snoid } = member;
    const id = SCRS_ID.ride + k;
    const end = scriptEnd(this.archive, id);
    snoid.setPosition(RIDE_START);
    snoid.onEvent = undefined;
    if (end) this.rideEnds.set(member.index, end);
    snoid.onEnd = () => {
      snoid.onEnd = undefined;
      if (end) snoid.setPosition(end);
    };
    snoid.play(id, F.stopAtEnd, { kind: "normal" });
  }

  /** Événement 50 (`1158:3ddb` puis le Tick, étape `[94ac]`) : fin de tour. */
  private endOfTurn(): void {
    const s = this.state;
    const pending = s.pending;
    if (!pending) return;
    const k = s.tested;
    const member = this.kit.members[pending.member];
    // Le wagonnet est garé à sa place ; celui de sortie revient au repos.
    this.parked[k] = this.features.create({ script: SCRB.parked - k, delay: DELAY.default, flags: STILL, depth: DEPTH.parked });
    this.still(this.wagonOut, SCRB.wagonOut, true);
    // Niveaux 1-2 (`1158:0cbe`, `[94ac]` étape 5) : le wagonnet d'arrivée, vidé, reprend ses drapeaux de création (`0x4108000`) et rejoue 11032 : un wagonnet
    // vide arrive sur la plate-forme pour le Zoombini suivant.
    if (this.level <= 2) {
      this.wagonA.flags &= ~(F.playOnly | F.still | F.noReplay);
      this.play(this.wagonA, SCRB.emptyWagon);
    }
    const before = s.savedCount;
    const end = endTurn(s, this.ctx.rng);
    if (!end || !member) return;
    if (pending.saved) {
      member.zoombini.present = true;
      this.savedOrder.push(member.index);
      this.kit.goEnabled = goActive(s);
      // À partir du quatrième sauvé, il danse sur place à son arrivée (`SCRS` 12044 + pieds).
      if (before > 2) this.dance(member);
    }
    this.features.invalidate();
    if (end.finished) {
      this.locked = false;
      this.finalVoice();
    } else if (this.level <= 2) {
      this.locked = false;
    } else if (this.level === 3) {
      this.bringNext(() => (this.locked = false));
    } else if (end.autoTest) {
      this.bringNext(() => this.startSecond());
    } else {
      // Niveau 4, après le second de la paire : la nouvelle paire arrive (la cible reparaît au levier).
      this.ready = false;
      this.targetsShown = false;
      this.arrivePair(() => {
        this.ready = true;
        this.locked = false;
      });
    }
  }

  /** Voix de fin de série (`1158:3ddb` étape 4) : personne de perdu, voix de réussite et danse ; sinon voix de regret avec la probabilité du niveau. */
  private finalVoice(): void {
    const s = this.state;
    if (s.savedCount === this.party.length) {
      this.kit.playSuccessVoice();
      this.dancing = true;
      this.danced = 0;
      this.lastDance = this.ctx.clock.ticks;
      return;
    }
    const { game } = this.ctx.services.get(ZOOMBINIS_GAME);
    const slot = dialogMemoryIndex(SCREEN);
    const visits = slot >= 0 ? game.dialogMemory[slot]! & 0xfff : 0;
    // `04e8(4, 0) > [93ac] − 1` ou moins de 4 visites (`S+0x42 & 0xfff`).
    if (this.ctx.rng.range(0, 4) > this.level - 1 || visits < 4) this.kit.playRegretVoice();
  }

  /** Danse sur place d'un Zoombini garé (`SCRS` 12044 + pieds, 12045 à 12049). */
  private dance(member: KitMember): void {
    const { snoid } = member;
    const at = this.rideEnds.get(member.index);
    if (at) snoid.setPosition(at);
    snoid.onEvent = undefined;
    snoid.onEnd = () => {
      snoid.onEnd = undefined;
    };
    snoid.play(SCRS_ID.dance + snoid.traits.feet, F.stopAtEnd, { kind: "normal" });
  }

  private tickDance(): void {
    if (!this.dancing || this.leaving) return;
    const now = this.ctx.clock.ticks;
    if (this.danced >= this.party.length - 1) {
      this.dancing = false;
      this.danced = 0;
      return;
    }
    if (now - this.lastDance <= DANCE_GAP) return;
    this.lastDance = now;
    for (let tries = 0; tries < this.party.length; tries++) {
      const member = this.kit.members[this.pool.pick(this.ctx.rng)];
      if (!member || member.snoid.destroyed || !member.zoombini.present) continue;
      this.dance(member);
      this.danced += 1;
      break;
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Arrivées en wagonnet (niveaux 3-4, `SCRB` 11033 à 11035, événements 30 à 38)

  /** Fait entrer le Zoombini `index` par le wagonnet (`SCRS` `id`, de l'entrée jusqu'à `to`), puis le met en pose d'attente. */
  private walkIn(index: number, id: number, from: Point, to: Point, done?: () => void): void {
    const member = this.kit.members[index];
    if (!member) {
      done?.();
      return;
    }
    const { snoid } = member;
    snoid.setPosition(from);
    snoid.setFacing(0);
    snoid.onEvent = undefined;
    snoid.onEnd = () => {
      snoid.onEnd = undefined;
      snoid.setPosition(to);
      snoid.idle();
      done?.();
    };
    snoid.play(id, F.stopAtEnd, { kind: "normal" });
  }

  /**
   * Le premier Zoombini de la file arrive (11033, `SCRS` 12038) ; son wagonnet lance celui du suivant (11034, `SCRS` 12039). `done` quand les deux sont en place (pose d'attente).
   */
  private arrivePair(done: () => void): void {
    this.locked = true;
    const first = this.state.rank;
    let remaining = first + 1 < this.party.length ? 2 : 1;
    const arrived = (): void => {
      if (--remaining === 0) done();
    };
    this.play(this.wagonA, SCRB.arrivalA, (n) => {
      if (n === EVENT.arriveA) {
        this.walkIn(first, SCRS_ID.arriveA, ARRIVAL_START, PLATFORM, arrived);
      } else if (n === EVENT.arrivalWagonB && first + 1 < this.party.length) {
        this.play(this.wagonB!, SCRB.arrivalB, (m) => {
          if (m === EVENT.arriveB) this.walkIn(first + 1, SCRS_ID.arriveB, ARRIVAL_START, QUEUE, arrived);
        });
      }
    });
  }

  /**
   * Après un tour : le suivant monte sur la plate-forme (11035, `SCRS` 12040, événements 37 et 38) ; au niveau 3 un nouveau suivant arrive (11034). `done` quand le wagonnet a fini
   * (événement 38) et que chacun est en place. `state.rank` est déjà celui du Zoombini qui monte.
   */
  private bringNext(done: () => void): void {
    this.locked = true;
    const next = this.state.rank;
    const newcomer = this.level === 3 && next + 1 < this.party.length;
    let remaining = newcomer ? 3 : 2;
    const arrived = (): void => {
      if (--remaining === 0) done();
    };
    this.play(this.wagonA, SCRB.arrivalNext, (n) => {
      if (n === EVENT.next) {
        this.walkIn(next, SCRS_ID.arriveNext, QUEUE, PLATFORM, arrived);
        if (newcomer) {
          this.play(this.wagonB!, SCRB.arrivalB, (m) => {
            if (m === EVENT.arriveB) this.walkIn(next + 1, SCRS_ID.arriveB, ARRIVAL_START, QUEUE, arrived);
          });
        }
      } else if (n === EVENT.pair) {
        arrived();
      }
    });
  }

  /** Niveau 4, second de la paire (`1158:3ce9`, `3e59`) : la cible n° 7 se cache, la n° 8 arrive sous le socle (11011) et le test part tout seul. */
  private startSecond(): void {
    this.fiches = null;
    this.target8At = TARGET2_START;
    this.features.invalidate();
    this.play(this.pedestal, SCRB.pedestalLift, (n) => {
      if (n === EVENT.targetSwap) {
        this.target8At = TARGET2_ENTER;
        this.features.invalidate();
      } else if (n === EVENT.targetSet) {
        this.target8At = RIGHT_CRYSTAL_POS;
        this.features.invalidate();
        this.startTest();
      }
    });
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Mode de test (`DS:a43f`, `Key` `1158:2504`, table de 5 touches `CS:26af`)

  /**
   * Touches du mode de test (sans effet hors de ce mode, `PuzzleKit.testKey`) : Espace consommée sans rien faire (cible `1158:25b3`), L « Level n »
   * (`"Level x "`, `x = "01234"[[93ac]]`), F4 `[950a] = 1` + message « Cheat on » (`DS:22d7`), F5 `[950a] = 0` (sans message), F1 aide (traitée par le kit).
   * `[950a]` empêche le mélange des étagères de cristaux au levier « nouveau tirage » (`1158:236b`, niveaux 3-4).
   */
  testKeys(event: KeyEvent): boolean {
    return this.kit.testKey(event, {
      0x20: () => {},
      0x4c: () => showDebugLine(this.ctx, `Level ${this.state.level} `),
      0x172: () => {
        this.state.keepShelves = true;
        showDebugLine(this.ctx, " Cheat on ");
      },
      0x173: () => {
        this.state.keepShelves = false;
      },
    });
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Tick

  tick(): void {
    this.kit.tick();
    if (this.finished || this.kit.finishing) return;
    if (this.kit.left && !this.leaving) return;
    if (this.ctx.services.tryGet(DIALOG)?.isOpen) return;
    this.syncLever();
    // Les valeurs affichées des cristaux tournent ou clignotent : redessin à chaque période.
    if (this.level >= 3) {
      const pulse = Math.floor(this.ctx.clock.ticks / BLINK_TICKS);
      if (pulse !== this.lastPulse) {
        this.lastPulse = pulse;
        this.features.invalidate();
      }
    }
    this.tickDance();
    if (this.leaving && this.departed >= this.departing && this.kit.soundIdle()) this.complete();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // « go » et sortie (`1158:1429` région 2, `[94c6]`)

  /** « go » (actif) : sans effet pendant un tour ; sinon le son 996 part et les trois premiers wagonnets quittent la voie. */
  private pressGo(): boolean {
    if (this.leaving) return true;
    if (this.locked) return true;
    this.kit.pressGo({ end: "depart", depart: () => this.startDeparture() });
    return true;
  }

  private startDeparture(): void {
    this.leaving = true;
    this.dancing = false;
    this.kit.endCarry();
    let count = 0;
    for (let i = 0; i < DEPARTING; i++) {
      const wagon = this.parked[i];
      if (!wagon) continue;
      count += 1;
      this.play(wagon, SCRB.departure + i, (n) => {
        if (n === EVENT.departed) this.departed += 1;
      });
    }
    this.departing = count;
    this.savedOrder.slice(0, DEPARTING).forEach((index, i) => {
      const member = this.kit.members[index];
      if (!member) return;
      const { snoid } = member;
      const at = this.rideEnds.get(index);
      if (at) snoid.setPosition(at);
      snoid.onEvent = undefined;
      snoid.onEnd = undefined;
      snoid.play(SCRS_ID.departure + i, F.stopAtEnd, { kind: "normal" });
    });
  }

  /** Écran suivant (`[8556] = 0x12`) : les sauvés restent (`present`), les autres sont perdus. */
  private complete(): void {
    if (this.finished) return;
    this.finished = true;
    this.kit.finish("success");
  }

  leaveScene(): void {
    this.kit.leave();
  }
}

/** Écran du piège de cristal (`SMOKE.MHK`, écran 17), à enregistrer par `engine.register(ScreenId.smoke, () => createSmokeScene())`. */
export function createSmokeScene(): SmokeScene {
  const name = screenInfo(SCREEN)?.archive;
  if (!name) throw new Error("createSmokeScene : pas d'archive pour l'écran 17");
  let archive: Archive;
  let run: SmokeRun | null = null;
  return {
    get probe() {
      return run;
    },
    async load(ctx: SceneContext) {
      archive = await ctx.resources.open(name);
    },
    enter(ctx: SceneContext) {
      run = new SmokeRun(ctx, archive);
    },
    leave(ctx: SceneContext) {
      run?.leaveScene();
      run = null;
      closeScreen(ctx);
    },
    tick() {
      run?.tick();
    },
    key(event, ctx: SceneContext) {
      if (!run || run.kit.left) return false;
      if (event.ctrl || event.alt) return false;
      if (ctx.services.tryGet(DIALOG)?.isOpen) return false;
      if (run.testKeys(event)) return true;
      return run.kit.key(event);
    },
  };
}
