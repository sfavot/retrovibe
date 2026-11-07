/**
 * Transition (`XFER.MHK`, écran 2, `11b0:00c4` Enter, `11b0:1326` Exit, `11b0:139b` Tick, `11b0:16e9` clic, `11b0:175c` niveaux de la carte, `11b0:1a1a`, `11b0:1ccf`,
 * `11b0:1e5f`, `11b0:1e7b`, `11b0:2406`) : intercalée par `1108:0000` entre un camp, le choix ou une épreuve et l'écran suivant, elle fait marcher le groupe courant
 * sur un décor de la région traversée, dit une phrase du narrateur puis envoie à la vraie destination (`goTo`). Détail et confiance : `docs/zoombinis/screens.md` §5.1
 * et `docs/zoombinis/engine-ts.md` « Transitions ».
 *
 * ## Ce que fait l'original (sûr sauf mention)
 *
 * - `DS:4180` (le numéro de trajet 1 à 16) n'est posé que par le mode de test (touches `a` à `p` de la carte, `1110:0b02`) : en jeu normal il vaut 0, et tout vient de
 *   `[855a]` (écran quitté) et `[8558]` (destination). La **région** (`DS:ad26`, 0 à 5) est celle de la destination, avec `[855a]` pour le camp 2 (3 depuis Net, 2 depuis
 *   Slides) ; elle choisit le jeu de décors : fond et `SHPL` 5000, 1000, 2000, 3000, 4000, 6000, planche `tBMP` fond + 100 et `SCRB` fond + 100…, scripts `SCRS`
 *   5199…5204 (début) ou 6200…6204 (ville).
 * - Régions 1 à 4 (cartes) : un `SCRB` d'une image (fond + 100) dont les parties sont des **numéros d'emplacement**, traduits par `11b0:1a1a` d'après le niveau de chaque étape
 *   (`11b0:175c`, 17 octets : 1 à 4 = niveau atteint, 0 = jamais) en images de la planche (bornes d'étape, monuments de niveau 1 à 4) ; l'étape qu'on vient d'atteindre
 *   (`ad2c`) apparaît au niveau précédent ; un `SCRB` fond + 200 d'une image de 4 parties dont `11b0:2406` ne garde que la partie de l'étape atteinte ; le titre de l'étape
 *   (`STRL` 2006, rectangle de `DS:41ce`, texte cerné de quatre copies décalées d'un pixel, `10a8:0cd2`) ; les Zoombinis en petit... non : en grand, posés hors de l'écran
 *   à gauche (`-22, 445`), partent un à un (écart de 90 ticks, `1168:2982`, le dernier du groupe en premier, **probable**) vers `(670, 445)` en ligne droite ; deux
 *   `SCRB` (fond + 101 et + 102) posés devant eux couvrent les coins bas.
 * - Région 0 : fond 5000, Zoombinis en petit posés tous à `(200, 235)` (`1168:5a13(0)`) ; toutes les `ad28` à `ad28 + 1` échéances de `acf0` (`now + 30 × [3, 6]`), un Zoombini
 *   joue le `SCRS` 5199 + pieds (203 images, `1168:3f76`), ou (40 % des tirages, dès le premier départ passé) une animation de décor `SCRB` 5104 à 5107 est relancée.
 *   `SCRB` 5102 et 5103 se déclenchent une seule fois aux évènements 10 et 11 d'un `SCRS` ; 5100, créé après les Zoombinis, les cache à (200, 235) ; au deuxième évènement 0 d'un `SCRS`, `11a8:2a0a(5100, 1, Zoombini)` remet ce Zoombini juste après 5100
 *   dans la liste (juste devant lui) : ceux qui attendent restent cachés.
 * - Région 5 : fond 6000, même départ échelonné (`now + 40 × [3, 6]`, sans animation de décor) ; les évènements 26 d'un `SCRS` 6200 à 6204 (en fin de marche) font passer 6104
 *   devant lui et comptent ; au cinquième, `SCRB` 6108 est joué et son évènement 30 termine la transition ; l'évènement 50 compte une arrivée de plus à Zoombiniville
 *   (`S+0x4E`, affiché sur `SCRB` 6105 avec `STRL` 2008, `11b0:1e7b`).
 * - Fin (`11b0:139b`) : `now − début > 300` ticks ET plus de voix en cours (ou voix coupées), puis envoi à la destination ; un clic gauche l'écourte (`11b0:16e9`) ; les touches ne
 *   font rien (`11b0:1748`). Le son d'ambiance `ad24` (20000 à 20100) est tiré au hasard (`10a8:04e8`, bornes 1…n) d'après région, destination, niveau et mémoire de dialogue.
 * - La mémoire de dialogue `S+0x28 + 2k` est lue puis passée à `1168:5c57` **sur une copie** : XFER n'écrit pas le résultat dans la partie (l'écran d'arrivée le fait).
 *
 * ## Écarts
 *
 * - Fondu de palette d'entrée (`11a8:302b`) et animation d'attente des Zoombinis (état 0) non portés. Titre et texte de population : police et couleurs de l'original non relevées
 *   (grande police, blanc cerné de noir), rectangle de population déduit du `SCRB` 6105.
 */
import type { Rect, Surface } from "../../../engine/mohawk/graphics/surface";
import type { Archive } from "../../../engine/mohawk/resources";
import { FEATURES, FeatureFlag, type Feature, type FeatureOptions, type FeaturePart } from "../engine/features";
import { ZOOMBINIS_GAME } from "../engine/game";
import { ScreenId, type Scene, type SceneContext } from "../engine/scene";
import { ZOOMBINIS_SOUND } from "../engine/sound";
import { TextFlags, ZOOMBINIS_TEXT } from "../engine/text";
import { currentLevel, dialogMemoryIndex } from "../game/route";
import { createSnoid, screenScripts, type Snoid } from "./snoid";
import { TrailColoring, TRAIL_DELAY, TRAIL_STARTS, trailStartIndex } from "./xfer-trail";
import { closeScreen, openScreen } from "./screen-kit";

const ARCHIVE = "XFER.MHK";
/** Fonds de chaque région (`DS:ad26` 0 à 5) : `tBMP` et `SHPL` du jeu de décors. */
export const XFER_BACKGROUNDS: readonly number[] = [5000, 1000, 2000, 3000, 4000, 6000];
/** Nombre de `SCRB` de la plage principale : 9 aux régions 0 et 5, 3 aux régions 1 à 4. */
const MAIN_SCRIPTS: readonly number[] = [9, 3, 3, 3, 3, 9];

/** Durée minimale (`11a8:22ad` > 300) avant la fin, en ticks. */
export const MIN_TICKS = 300;
/** Écart de départ entre deux Zoombinis des régions 1 à 4 (`1168:2982(0x5a, …)`). */
const STAGGER_TICKS = 90;
/** Taille maximale d'un groupe. */
const GROUP_MAX = 16;
/** Départ (région 1 à 4) et arrivée de la marche (`1168:2982(…, 0x1bd, 0x29e)`). */
const ROAD_START = { x: -22, y: 445 };
const ROAD_END = { x: 670, y: 445 };
/** Région 0 : tous les Zoombinis à ce point (`11b0:0cb3`), en petit. */
const CLIFF_START = { x: 200, y: 235 };
/** Région 5 : abscisse de départ, ordonnée `282 + 6 × [0, 3]` (`11b0:0e05`). */
const TOWN_START_X = -22;
const TOWN_START_Y = 282;
/** `SCRS` du départ : 5199 + pieds (région 0), 6199 + pieds (région 5). */
const WALK_SCRIPT_BASE: readonly number[] = [5199, 0, 0, 0, 0, 6199];
/** Profondeurs : décor derrière les Zoombinis (0, ordre de création), Zoombinis, décor devant eux. */
const MEMBERS = 10;
const FRONT = 1000;
/** Région 0 : profondeur de `SCRB` 5100 (pan de falaise), entre les Zoombinis et 5101. */
const CLIFF_DEPTH = FRONT - 1;

const STRL_TITLES = 2006;
const STRL_POPULATION = 2008;
/** Rectangles des titres de région 1 à 4 (`DS:41d6…41ee`, gauche, haut, droite, bas). */
const TITLE_RECTS: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 0, 0],
  [43, 54, 226, 107],
  [371, 33, 613, 65],
  [127, 29, 299, 81],
  [135, 29, 323, 82],
];
/** Indices de palette du texte (hypothèse : 255 blanc, 0 noir) et couleur du cerne. */
const TEXT_COLOR = 255;
const OUTLINE_COLOR = 0;

// ---------------------------------------------------------------------------------------------------------------------------
// Règles (fonctions pures)

/** Région (`DS:ad26`) d'une transition vers `target` depuis `previous`, ou `undefined` si `target` n'a pas de décor. */
export function regionOf(previous: number, target: number): number | undefined {
  if (target === ScreenId.baseCamp || target === ScreenId.tunnels || target === ScreenId.pizza) return 1;
  if (target === ScreenId.bcTwo) return previous === ScreenId.net ? 3 : 2;
  if (target === ScreenId.town) return 5;
  if (target === ScreenId.bridge) return 0;
  if (target >= ScreenId.ferry && target <= ScreenId.slides) return 2;
  if (target >= ScreenId.fleens && target <= ScreenId.net) return 3;
  if (target >= ScreenId.caves && target <= ScreenId.maze2) return 4;
  return undefined;
}

/**
 * `1168:5c57` sur le mot de mémoire de dialogue `memory` : compte une visite (12 bits), puis rend 0 (rien à dire de particulier), 1 (niveau 0), 2 puis 12 (niveau 1,
 * première puis deuxième visite à ce niveau, bits `0x1000` et `0x2000`) ou 5 (entraînement). `level` est celui de la destination (`1168:515d`).
 */
export function dialogChoice(memory: number, level: number, training: boolean): { choice: number; memory: number } {
  if (training) return { choice: 5, memory };
  let word = memory;
  if ((word & 0xfff) < 0xfff) word += 1;
  if (level === 0) return { choice: 1, memory: word };
  if (level === 1) {
    if ((word & 0x1000) === 0) return { choice: 2, memory: word | 0x1000 };
    if ((word & 0x2000) === 0) return { choice: 0xc, memory: word | 0x2000 };
  }
  return { choice: 0, memory: word };
}

/** Choix « 1 à n » de l'original (`10a8:04e8(n, 1)`), à la même place dans l'arbre pour garder le même nombre de tirages. */
type Pick = (max: number) => number;

/**
 * Son d'ambiance (`DS:ad24`, 0 = aucun) du début de `11b0:00c4` : `region`, destination `target`, `choice` = résultat de `1168:5c57` (0, 1, 2, 5 ou 12), `level` = niveau de la
 * destination plus 1 (`1168:515d` + 1). `pick(n)` rend un entier de 1 à `n`.
 */
export function narratorSound(region: number, target: number, choice: number, level: number, pick: Pick): number {
  const memoryIs = (...values: number[]) => values.includes(choice);
  const table = (ids: readonly number[]): number => ids[pick(ids.length) - 1]!;
  switch (region) {
    case 0:
      if (choice === 0) return level < 2 || level > 3 ? table([0x4e7e, 0x4e7f, 0x4e80, 0x4e81, 0x4e83]) : table([0x4e7e, 0x4e7f, 0x4e80, 0x4e81, 0x4e82, 0x4e83]);
      if (choice === 1) return 0x4e7e;
      if (memoryIs(2, 0xc)) return 0x4e82;
      if (choice === 5) return level < 2 || level > 3 ? 0x4e7e : 0x4e82;
      return 0;
    case 1:
      if (target === ScreenId.baseCamp) return table([0x4e29, 0x4e2c]);
      if (target === ScreenId.tunnels) return memoryIs(1, 2, 5) ? 0x4e28 : table([0x4e27, 0x4e28, 0x4e29]);
      if (target === ScreenId.pizza) {
        if (choice === 1) return 0x4e2a;
        if (memoryIs(2, 0xc)) return 0x4e2b;
        if (choice === 5) return level < 2 ? 0x4e2a : 0x4e2b;
        return level < 2 ? table([0x4e2a, 0x4e2c]) : table([0x4e2b, 0x4e2c]);
      }
      return 0;
    case 2:
      if (target === ScreenId.bcTwo) return table([0x4e30, 0x4e34, 0x4e38]);
      if (target === ScreenId.ferry) {
        if (choice === 0) return level < 2 ? table([0x4e2d, 0x4e2e, 0x4e30]) : table([0x4e2d, 0x4e2e, 0x4e2f, 0x4e30]);
        if (memoryIs(1, 5)) return 0x4e2e;
        if (memoryIs(2, 0xc)) return 0x4e2f;
        return 0;
      }
      if (target === ScreenId.lilly) {
        if (choice === 0) return level < 2 ? table([0x4e31, 0x4e32, 0x4e34]) : table([0x4e31, 0x4e32, 0x4e33, 0x4e34]);
        if (choice === 1) return 0x4e32;
        if (memoryIs(2, 0xc)) return 0x4e33;
        if (choice === 5) return level < 2 ? 0x4e32 : 0x4e33;
        return 0;
      }
      if (target === ScreenId.slides) {
        if (choice === 0) return table([0x4e35, 0x4e36, 0x4e38]);
        return memoryIs(1, 2, 5, 0xc) ? 0x4e36 : 0;
      }
      return 0;
    case 3:
      if (target === ScreenId.bcTwo) return table([0x4e3c, 0x4e3f, 0x4e42]);
      if (target === ScreenId.fleens) {
        if (choice === 0) return level === 1 || level === 3 ? table([0x4e39, 0x4e3a, 0x4e3c]) : table([0x4e39, 0x4e3a, 0x4e3b, 0x4e3c]);
        return memoryIs(1, 5, 2, 0xc) ? 0x4e3a : 0;
      }
      if (target === ScreenId.hotel) {
        if (choice === 0) return table([0x4e3d, 0x4e3e, 0x4e3f]);
        return memoryIs(1, 2, 5, 0xc) ? 0x4e3e : 0;
      }
      if (target === ScreenId.net) {
        if (choice === 0) return table([0x4e40, 0x4e41, 0x4e42]);
        return memoryIs(1, 2, 5, 0xc) ? 0x4e41 : 0;
      }
      return 0;
    case 4:
      if (target === ScreenId.caves) {
        if (choice === 0) return table([0x4e43, 0x4e44, 0x4e45]);
        return memoryIs(1, 2, 5, 0xc) ? 0x4e44 : 0;
      }
      if (target === ScreenId.smoke) {
        if (choice === 0) return level < 2 ? table([20000, 0x4e21, 0x4e23]) : table([20000, 0x4e21, 0x4e22, 0x4e23]);
        if (choice === 1) return 0x4e22;
        if (memoryIs(2, 5, 0xc)) return level < 2 ? 0x4e21 : 0x4e22;
        return 0;
      }
      if (target === ScreenId.maze2) {
        if (choice === 0) return table([0x4e24, 0x4e25, 0x4e26]);
        return memoryIs(1, 2, 5, 0xc) ? 0x4e25 : 0;
      }
      return 0;
    default:
      // Ville : un tirage 1 à 4 (sauf choix 1 et 5) dont le résultat est écrasé par 20100 (0x4e84) ; le son vaut donc toujours 20100.
      if (choice !== 1 && choice !== 5) pick(4);
      return 0x4e84;
  }
}

/** Nombre d'étapes du tableau de `11b0:175c`. */
const STAGE_COUNT = 17;

/**
 * `11b0:175c`, première moitié : niveau atteint (1 à 4, 0 = jamais) de chacune des 17 « étapes » de la carte : 0 départ, 1 à 3 Bridge, Tunnels, Pizza, 4 camp 1, 5 à 7 Ferry,
 * Lilly, Slides, 8 à 10 Fleens, Hotel, Net, 11 camp 2 (chemin Ferry), 12 à 14 Caves, Smoke, Maze2, 15 ville, 16 camp 2 (chemin Net). Entraînement : tout au niveau d'entraînement.
 */
export function stageLevels(game: { successes: readonly number[]; masks: { stage1: number; stage2: number; stage3: number; stage4: number } }, training: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < STAGE_COUNT; i++) {
    if (training >= 1 && training <= 4) {
      out.push(training);
      continue;
    }
    let bits = 0;
    if (i === 0) bits = 1;
    else if (i <= 3) bits = game.successes[i - 1]!;
    else if (i === 4) bits = game.masks.stage1;
    else if (i <= 10) bits = game.successes[i - 2]!;
    else if (i === 11) bits = game.masks.stage2;
    else if (i <= 14) bits = game.successes[i - 3]!;
    else if (i === 15) bits = game.masks.stage4;
    else bits = game.masks.stage3;
    bits &= 0xf;
    out.push(bits & 8 ? 4 : bits & 4 ? 3 : bits & 2 ? 2 : bits & 1 ? 1 : 0);
  }
  return out;
}

/** État des étapes pour le décor des régions 1 à 4 : octets signés de `DS:acf4` (255 = −1), `DS:acee`, `DS:ad2c`. */
export interface StageState {
  levels: Int8Array;
  /** `DS:acee` : niveau de repli de l'étape atteinte, −1 si inconnu. */
  fallback: number;
  /** `DS:ad2c` : étape qu'on vient d'atteindre (0 = aucune). */
  arrived: number;
  /** `DS:ad2e` : valeur (niveau + 1) de l'étape atteinte, qui choisit les couleurs du trait (`xfer-trail.ts`) ; 0 si aucune. */
  value: number;
}

/**
 * `11b0:175c`, seconde moitié : étape atteinte par la destination et son niveau. `levelPlusOne` est `1168:515d` + 1 (niveau de la destination). L'étape atteinte reçoit
 * le niveau précédent (valeur − 1), ou −1 (« à dessiner au niveau de repli ») s'il n'y en a pas.
 */
export function stageState(levels: readonly number[], previous: number, target: number, levelPlusOne: number): StageState {
  const state: StageState = { levels: Int8Array.from(levels), fallback: -1, arrived: 0, value: 0 };
  let stage = 0;
  let value = 0;
  switch (target) {
    case ScreenId.baseCamp: [stage, value] = [4, levels[3]!]; break;
    case ScreenId.bcTwo: [stage, value] = previous === ScreenId.slides ? [0xb, levels[7]!] : [0x10, levels[10]!]; break;
    case ScreenId.town: [stage, value] = [0xf, levels[0xe]!]; break;
    case ScreenId.bridge: [stage, value] = [1, levelPlusOne]; break;
    case ScreenId.tunnels: [stage, value] = [2, levels[1]!]; break;
    case ScreenId.pizza: [stage, value] = [3, levels[2]!]; break;
    case ScreenId.ferry: [stage, value] = [5, levelPlusOne]; break;
    case ScreenId.lilly: [stage, value] = [6, levels[5]!]; break;
    case ScreenId.slides: [stage, value] = [7, levels[6]!]; break;
    case ScreenId.fleens: [stage, value] = [8, levelPlusOne]; break;
    case ScreenId.hotel: [stage, value] = [9, levels[8]!]; break;
    case ScreenId.net: [stage, value] = [10, levels[9]!]; break;
    case ScreenId.caves: [stage, value] = [0xc, levelPlusOne]; break;
    case ScreenId.smoke: [stage, value] = [0xd, levels[0xc]!]; break;
    case ScreenId.maze2: [stage, value] = [0xe, levels[0xd]!]; break;
    default: return state;
  }
  state.arrived = stage;
  state.value = value;
  state.levels[stage] = value - 1;
  if (state.levels[stage]! < 1) {
    if (state.fallback < 0) state.fallback = value - 1;
    state.levels[stage] = -1;
  }
  return state;
}

/** Table `DS:41f6` : étapes des emplacements (`11b0:1a1a`), indexée par `région-décalage + emplacement` ; le mot 0 est le drapeau de réentrée du Tick. */
const SLOT_STAGES: readonly number[] = [0, 0, 1, 2, 3, 4, 4, 5, 6, 7, 0xb, 4, 8, 9, 0xa, 0x10, 0xb, 0xc, 0xd, 0xe, 0xf];
/** Par région 1 à 4 : décalage dans la table, nombre d'emplacements fixes + 1 (`K`), dernier numéro d'emplacement (`M`). */
const SLOT_LAYOUT: readonly (readonly [number, number, number] | undefined)[] = [undefined, [0, 5, 8], [5, 6, 9], [10, 6, 9], [15, 6, 9]];

export interface SlotTranslation {
  /** Image de la planche pour chaque numéro d'emplacement (0 = partie retirée). */
  map: number[];
  /** `DS:ad38` : 1 à 4, partie de `SCRB` fond + 200 à garder ; 0 si l'étape atteinte n'a pas d'emplacement. */
  keep: number;
  /** `DS:ad2c` après la traduction (remis à 0 si l'étape atteinte a un emplacement). */
  arrived: number;
}

/** `11b0:1a1a` : traduit les numéros d'emplacement de la région `region` (1 à 4) d'après `state`. */
export function translateSlots(region: number, state: StageState): SlotTranslation {
  const layout = SLOT_LAYOUT[region];
  if (!layout) return { map: [0], keep: 0, arrived: state.arrived };
  const [offset, fixed, last] = layout;
  const map: number[] = [0];
  let keep = 0;
  let arrived = state.arrived;
  let fallback = state.fallback;
  for (let k = 1; k <= last; k++) {
    map[k] = 0;
    if (k < fixed) {
      if (offset === 0) {
        if (state.levels[k] !== 0) map[k] = k;
      } else {
        const stage = SLOT_STAGES[offset + k]!;
        if (state.levels[stage] !== 0) map[k] = k;
        else if (stage === 0xb) {
          if (state.levels[0x10] !== 0) map[k] = k;
        } else if (stage === 0x10 && state.levels[0xb] !== 0) map[k] = k;
      }
      continue;
    }
    const stage = SLOT_STAGES[2 + offset + k - fixed]!;
    if (arrived !== 0 && stage === arrived) {
      arrived = 0;
      keep = k - fixed + 1;
    }
    const level = state.levels[stage]!;
    if (level < 1) {
      if (fallback < 0) fallback = 0;
      if (k === fixed) map[k] = fallback * 4 + k;
      else if (k > fixed && level === -1 && last < map[k - 1]!) map[k] = fallback * 4 + k;
    } else map[k] = level * 4 + k;
  }
  return { map, keep, arrived };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Scène

interface Member {
  snoid: Snoid;
  depth: number;
  /** Régions 1 à 4 : tick de départ. */
  startAt: number;
  started: boolean;
  /** Région 0 : évènements 0 reçus (`+0xf0`). */
  turns: number;
}

export function createXferScene(): Scene {
  let archive: Archive;
  let region = 0;
  let target: number = ScreenId.map;
  let previous = 0;
  let startTick = 0;
  let voice = 0;
  let left = false;
  let nextTimer = 0;
  let released = 0;
  /** Régions 1 à 4 : remplissage du trait du tronçon atteint (`11b0:24ed`) et prochaine échéance (`11b0:26ec`, délai 4). */
  let trail: TrailColoring | null = null;
  let trailNext = 0;
  /** Région 0 : Zoombinis déjà passés devant 5100. */
  let cliffPassed = 0;
  let wasIdle = false;
  let arrivals = 0;
  let finalStarted = false;
  let onceFlags = [true, true];
  const members: Member[] = [];
  let ambient: Feature[] = [];
  let once: (Feature | undefined)[] = [];
  let stackable: Feature | undefined;
  let finale: Feature | undefined;
  let population = 0;

  /** Écran quitté et destination (`[855a]`, `[8558]`) : le dernier changement d'écran s'il a intercalé `XFER`, sinon la session. */
  const resolveTransition = (ctx: SceneContext): void => {
    const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
    const change = zoombinis.lastChange;
    previous = zoombinis.session.previous;
    target = change && change.screen === ScreenId.xfer && change.target !== null ? change.target : zoombinis.session.finalTarget;
  };

  function createFeature(ctx: SceneContext, options: FeatureOptions): Feature {
    return ctx.services.get(FEATURES).create(options);
  }

  function restack(ctx: SceneContext, depth: number): void {
    if (!stackable) return;
    ctx.services.get(FEATURES).restack(stackable, depth);
  }

  function shadowText(ctx: SceneContext, surface: Surface, text: string, rect: Rect): void {
    const drawer = ctx.services.tryGet(ZOOMBINIS_TEXT);
    if (!drawer) return;
    const flags = TextFlags.center | TextFlags.vcenter;
    // `10a8:0cd2` : quatre copies décalées d'un pixel (`10a8:0d9e`), puis le texte.
    for (const [dx, dy] of [[-1, 0], [0, -1], [1, 0], [0, 1]] as const) drawer.drawText(surface, "large", text, { ...rect, x: rect.x + dx, y: rect.y + dy }, flags, OUTLINE_COLOR);
    drawer.drawText(surface, "large", text, rect, flags, TEXT_COLOR);
  }

  function finish(ctx: SceneContext): void {
    if (left) return;
    left = true;
    ctx.services.get(ZOOMBINIS_GAME).goTo(ctx, target);
  }

  return {
    async load(ctx: SceneContext) {
      archive = await ctx.resources.open(ARCHIVE);
    },

    enter(ctx: SceneContext) {
      const { game, session } = ctx.services.get(ZOOMBINIS_GAME);
      const features = ctx.services.get(FEATURES);
      const sound = ctx.services.get(ZOOMBINIS_SOUND);
      const { rng } = ctx;
      resolveTransition(ctx);
      left = false;
      members.length = 0;
      ambient = [];
      once = [];
      stackable = undefined;
      finale = undefined;
      released = 0;
      trail = null;
      trailNext = 0;
      cliffPassed = 0;
      arrivals = 0;
      finalStarted = false;
      wasIdle = false;
      onceFlags = [true, true];
      nextTimer = 0;
      population = game.counters.town;
      const known = regionOf(previous, target);
      region = known ?? 0;
      if (known === undefined) {
        // Sans destination connue, rien à animer : le Tick de l'original quitte dès les 300 ticks vers la destination demandée.
        target = target >= 0 ? target : ScreenId.map;
      }

      // Narrateur : `1168:515d` et `1168:5c57` avec l'écran d'arrivée comme écran courant.
      const level = currentLevel(game, session, target);
      const slot = dialogMemoryIndex(target);
      const memory = slot >= 0 ? game.dialogMemory[slot]! : 0;
      const { choice } = dialogChoice(memory, level, session.training !== 0);
      voice = narratorSound(region, target, choice, level + 1, (max) => rng.range(1, max));

      // Décor : fond, palette, planche et plages de scripts.
      const bg = XFER_BACKGROUNDS[region]!;
      const background = openScreen(ctx, archive, { background: bg });
      features.defineGroup(0, bg + 100);
      features.setScripts(bg + 100, MAIN_SCRIPTS[region]!);
      if (region >= 1 && region <= 4) {
        features.defineGroup(1, bg + 200);
        features.addScripts(bg + 200, 1);
      }
      const scripts = screenScripts(archive);
      const present = game.group.flagA ? [] : game.group.members.filter((member) => member.present);
      const { staticFirst, stopAtEnd, noReplay, active, firstImage } = FeatureFlag;
      const hold = staticFirst | stopAtEnd | noReplay | active;

      const addMembers = (positions: { x: number; y: number }[]): void => {
        present.forEach((zoombini, i) => {
          const depth = MEMBERS + i;
          const snoid = createSnoid(ctx, zoombini, { position: positions[i]!, small: region === 0, depth, scripts, idleVariant: 0 });
          const member: Member = { snoid, depth, startAt: 0, started: false, turns: 0 };
          snoid.onEvent = (n) => onSnoidEvent(ctx, member, n);
          members.push(member);
        });
      };

      if (region === 0) {
        for (const id of [5102, 5103]) once.push(createFeature(ctx, { script: id, delay: 6, flags: hold }));
        for (const id of [5104, 5105, 5106, 5107]) ambient.push(createFeature(ctx, { script: id, delay: 6, flags: hold }));
        createFeature(ctx, { script: 5108, delay: 6, flags: hold });
        addMembers(present.map(() => ({ ...CLIFF_START })));
        // Créés après les Zoombinis, donc devant eux (`11a8:0ad6` ajoute en fin de liste) : 5100 cache ceux qui attendent à (200, 235), 5101 vient encore devant.
        const options: FeatureOptions = { script: 5100, delay: 0, flags: 0, depth: CLIFF_DEPTH };
        stackable = createFeature(ctx, options);
        createFeature(ctx, { script: 5101, delay: 0, flags: 0, depth: FRONT });
      } else if (region === 5) {
        finale = createFeature(ctx, { script: 6108, delay: 6, flags: hold });
        const sign = createFeature(ctx, { script: 6105, delay: 0, flags: 0 });
        sign.onAfterDraw = (feature, screen) => {
          const text = ctx.services.tryGet(ZOOMBINIS_TEXT);
          const rect = feature.rect;
          if (!text || !rect) return;
          const line = text.strings.get(STRL_POPULATION, 1) ?? "";
          shadowText(ctx, screen, `${line} ${population}`, { x: rect.left + 10, y: rect.top + 4, w: rect.right - rect.left - 20, h: rect.bottom - rect.top - 8 });
        };
        const options: FeatureOptions = { script: 6104, delay: 0, flags: 0 };
        stackable = createFeature(ctx, options);
        // Seize tirages, quel que soit le nombre de Zoombinis (`11b0:0dfb`).
        const starts = Array.from({ length: GROUP_MAX }, () => ({ x: TOWN_START_X, y: TOWN_START_Y + 6 * rng.range(0, 3) }));
        addMembers(starts);
        for (const id of [6100, 6101, 6102, 6103]) createFeature(ctx, { script: id, delay: 0, flags: 0, depth: FRONT });
        createFeature(ctx, { script: 6106, delay: 6, flags: stopAtEnd | noReplay });
        createFeature(ctx, { script: 6107, delay: 6, flags: stopAtEnd | noReplay });
      } else {
        const state = stageState(stageLevels(game, session.training), previous, target, level + 1);
        const translation = translateSlots(region, state);
        createFeature(ctx, {
          script: bg + 100,
          delay: 6,
          flags: stopAtEnd | active | firstImage,
          onImage: (_feature, parts) => parts.flatMap((part): FeaturePart[] => {
            const w = translation.map[part.w] ?? 0;
            return w === 0 ? [] : [{ ...part, w }];
          }),
        });
        // `11b0:2406` garde la partie du tronçon atteint ; `11b0:24ed` la colore de proche en proche à chaque dessin (toutes les 4 ticks, `26ec`).
        createFeature(ctx, {
          script: bg + 200,
          delay: 4,
          flags: firstImage,
          onImage: (_feature, parts) => {
            const part = parts.length > 0 ? (parts[Math.max(translation.keep, 1) - 1] ?? parts[0]!) : undefined;
            if (!part || part.w <= 0) return parts;
            const sheet = features.group(1);
            const shape = sheet?.images[part.w - 1];
            if (!sheet || !shape) return [part];
            // Premier dessin (`24ed`, `ad3a` = 0) : le trait passe aux couleurs « avant » ; la suite avance dans `tick` (`26ec`).
            if (!trail) {
              trail = new TrailColoring(shape, TRAIL_STARTS[trailStartIndex(region, translation.keep)]!, state.value);
              trail.step();
            }
            const images = sheet.images.slice();
            images[part.w - 1] = trail.shape;
            return [{ ...part, sheet: { images, anchors: sheet.anchors } }];
          },
        });
        addMembers(present.map(() => ({ ...ROAD_START })));
        present.forEach((_, i) => {
          // Le dernier du groupe part le premier (`1168:2982` parcourt la liste à rebours, probable).
          members[i]!.startAt = ctx.clock.ticks + STAGGER_TICKS * (present.length - 1 - i);
        });
        createFeature(ctx, { script: bg + 101, delay: 0, flags: 0, depth: FRONT });
        createFeature(ctx, { script: bg + 102, delay: 0, flags: 0, depth: FRONT });
        const title = ctx.services.tryGet(ZOOMBINIS_TEXT)?.strings.get(STRL_TITLES, region) ?? "";
        const [x0, y0, x1, y1] = TITLE_RECTS[region]!;
        if (title) shadowText(ctx, background, title, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      }

      features.invalidate();
      if (voice !== 0) sound.queue(voice);
      startTick = ctx.clock.ticks;
      ctx.requestPresent();
    },

    leave(ctx: SceneContext) {
      closeScreen(ctx);
      members.length = 0;
    },

    tick(ctx: SceneContext) {
      if (left) return;
      if (ctx.input.buttonEvents.some((event) => event.down && event.button === "left")) return finish(ctx);

      const now = ctx.clock.ticks;
      const sound = ctx.services.get(ZOOMBINIS_SOUND);
      const speaking = voice !== 0 && sound.effectsEnabled && (sound.pending.effects > 0 || sound.effectsPlaying > 0);
      if (now - startTick > MIN_TICKS && !speaking) return finish(ctx);

      const { rng } = ctx;
      const features = ctx.services.get(FEATURES);
      // `11b0:26ec` : la feature du trait se redessine toutes les 4 ticks, et chaque dessin colore une étape de plus (`24ed`).
      if (trail && now >= trailNext) {
        trailNext = now + TRAIL_DELAY;
        trail.step();
        features.invalidate();
      }
      if (region >= 1 && region <= 4) {
        for (const member of members) {
          if (member.started || now < member.startAt) continue;
          member.started = true;
          member.snoid.walkTo({ ...ROAD_END });
        }
        return;
      }
      if (now <= nextTimer) return;
      if (region === 5 && arrivals > 4 && !finalStarted) {
        finalStarted = true;
        if (finale) {
          finale.onEvent = (_image, n) => {
            if (n === 30) finish(ctx);
          };
          features.setScript(finale, 0, true);
        }
      }
      if (region === 0) {
        nextTimer = now + rng.range(3, 6) * 30;
        if (rng.range(1, 100) > 40 || !wasIdle) {
          wasIdle = true;
          release();
        } else {
          const k = rng.range(0, 4);
          const feature = ambient[k];
          if (feature && !feature.active) features.setScript(feature, 0, true);
        }
      } else if (region === 5) {
        nextTimer = now + rng.range(3, 6) * 40;
        release();
      }
    },

    key() {
      // `11b0:1748` : renvoie 0, aucune touche n'est consommée.
      return false;
    },
  };

  /** `11b0:139b` : lâche le Zoombini suivant du groupe (`ad28`), qui joue son `SCRS` de départ à sa position. */
  function release(): void {
    const member = members[released++];
    if (!member) return;
    member.turns = 0;
    member.snoid.play(WALK_SCRIPT_BASE[region]! + member.snoid.traits.feet, FeatureFlag.stopAtEnd);
  }

  /** `11b0:1ccf` : évènements des `SCRS` de départ. */
  function onSnoidEvent(ctx: SceneContext, member: Member, n: number): void {
    const features = ctx.services.get(FEATURES);
    switch (n) {
      case 0:
        // `+0xf2` inversé ; deuxième évènement : `11a8:2a0a(5100, 1, Zoombini)` le réinsère juste après 5100 dans la liste, donc juste devant lui ; les
        // Zoombinis qui attendent restent derrière 5100, ceux déjà partis restent devant celui-ci (chacun est inséré contre 5100).
        member.snoid.setFacing(member.snoid.facing === 0 ? 1 : 0);
        member.turns++;
        if (region === 0 && member.turns === 2) {
          cliffPassed++;
          ctx.services.get(FEATURES).restack(member.snoid.feature, CLIFF_DEPTH + 0.5 / cliffPassed);
        }
        break;
      case 10:
      case 11: {
        const slot = n - 10;
        const feature = once[slot];
        if (onceFlags[slot] && feature) {
          onceFlags[slot] = false;
          feature.flags = FeatureFlag.stopAtEnd | FeatureFlag.noReplay | FeatureFlag.active;
          features.setScript(feature, 0, true);
        }
        break;
      }
      case 26:
        // 6104 passe devant lui ; le cinquième évènement lance la fin.
        restack(ctx, member.depth + 0.5);
        if (!finalStarted) arrivals++;
        break;
      case 50:
        population++;
        features.invalidate();
        break;
      case 250:
      case 251:
      case 252:
        // `1168:4dc9(n − 250)` : pose 0, 1 ou 2.
        member.snoid.setPose(n - 250);
        break;
      default:
        break;
    }
  }
}
