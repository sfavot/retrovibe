/**
 * Écran de la hutte à pizza (`PIZZA.MHK`, écran 9 ; tâche H3 de la vague H ; `docs/zoombinis/puzzles/pizza.md`). Les règles sont dans `game/puzzles/pizza.ts` ;
 * ce fichier est le décor, les boutons d'ingrédients, le four, les trolls et leurs réactions, les assiettes de l'historique, la scène de départ et les sorties.
 *
 * Image : fond `tBMP` 5000 (palette `SHPL` 5000) ; groupes de formes 0 = `tBMP` 7000 (`SCRB` 7000–7068 : four, boutons), 1 = 8000 (Arno, `SCRB` 8000–8035), 2 = 12000
 * (assiettes, `SCRB` 12000–12044), 3 = 9000 (Willa, niveaux 1 à 3, `SCRB` 9000–9034), 4 = 10000 (Shyler, niveaux 2 et 3, `SCRB` 10000–10038). Les boutons carte et « go »
 * viennent de la planche 6000 (images 5 / 6 : carte normal / appuyé ; 1 / 2 / 3 : « go » grisé / actif / appuyé), dessinés par le kit aux rectangles des régions 1 et 2.
 *
 * Déroulé (`1130:0000`, `0d85`) :
 *  1. entrée : narrateur (`5358`, voix `15000…15006`), puis chaque troll joue son introduction (`SCRB` 8032, 9034, 10038), puis une réplique d'attente (`4de0`) ; ensuite le
 *     service est permis. Les boutons peuvent être basculés dès l'entrée (la bascule n'attend que la fin de l'animation du four) ;
 *  2. service (régions 3 et 12) : les boutons repartent à zéro, le four joue (`SCRB` 7066 et 7057 / 7058) ; à son évènement 33 la pizza sort
 *     (`SCRB` 12000), à son évènement 61 le livreur la prend (`SCRS` 13000 + pieds − 1), à sa fin il la porte jusqu'au premier troll à servir (13005 / 13010 / 13015) pendant
 *     que la pizza suit (12001 / 12006 / 12011, au rythme du livreur : groupe `1f5c`) ; le livreur (premier Zoombini du groupe) attend au comptoir (`DS:1b6e`), où il
 *     monte dès l'arrivée du groupe (`4cb5`) et revient après chaque repas (`4571`) ;
 *  3. verdicts (`serveMeal`) : les trolls réagissent à tour de rôle ; un troll content part avec sa pizza (`SCRB` 8021 / 9027 / 10031, parties filtrées par ses ingrédients
 *     aimés) et arrête la chaîne ; si aucun n'est content le dernier qui a réagi (celui du premier verdict « incomplet » sinon) lance l'assiette (`SCRB` 8020 / 9026 / 10030),
 *     qui tombe dans l'historique (`SCRB` 12016–12040), le livreur revient au comptoir sauf après l'épuisement du budget (le premier troll présent joue alors la fureur) ;
 *  4. tous partis : scène de départ (`3893`), « go » actif ; la voix de réussite suit la scène d'Arno. « Go » sauve le groupe entier, la carte le perd entièrement.
 *
 * Boutons carte et « go » : rectangles `(600, 403)–(639, 440)` et `(600, 441)–(639, 478)`, gérés par le kit (images de la planche 6000 fournies ici, image appuyée tenue 6 ticks) ;
 * « go » sauve le groupe entier (`pressGo({ saveAll })`). Le glisser-déposer d'un Zoombini est coupé (région 13 inerte dans cette version, `pizza.md` §4.2).
 */
import type { Archive } from "../../../../engine/mohawk/resources";
import { TAG_SCRB } from "../../data/archives";
import type { Script } from "../../data/script";
import { scriptAnchorOffset, type Point } from "../../data/zoombini";
import { screenInfo } from "../../data/archives";
import { DIALOG } from "../../engine/dialog";
import { FEATURE_END, FEATURES, FeatureFlag, type Feature, type FeatureImageHook, type FeaturePart, type Features } from "../../engine/features";
import { ZOOMBINIS_GAME } from "../../engine/game";
import type { Scene, SceneContext } from "../../engine/scene";
import { ScreenId } from "../../engine/scene";
import { node, path, scrs } from "../../engine/resources";
import { GRAPHICS } from "../../engine/services";
import { ZOOMBINIS_SOUND } from "../../engine/sound";
import { TextFlags, ZOOMBINIS_TEXT } from "../../engine/text";
import { dialogMemoryIndex, currentLevel } from "../../game/route";
import {
  PIZZA_LEVELS,
  TROLL_LEAVE,
  TROLL_OBJECT,
  TROLL_THROW,
  allSatisfied,
  ambientScript,
  availableIngredients,
  departureScripts,
  has,
  hintScript,
  newPizza,
  serveMeal,
  toggleIngredient,
  type PizzaPlate,
  type PizzaServe,
  type PizzaState,
} from "../../game/puzzles/pizza";
import type { Zoombini } from "../../game/state";
import { createPuzzleKit, sheetButtonImages, type KitMember, type PuzzleKit, type Rect } from "../puzzle-kit";
import { closeScreen, openScreen } from "../screen-kit";
import { dialogChoice } from "../xfer";
import { screenScripts } from "../snoid";

// ---------------------------------------------------------------------------------------------------------------------------
// Constantes de l'écran (`1130:0000`, `1130:1803`)

/** Fond `tBMP` / palette `SHPL` de l'archive. */
const BACKGROUND = 5000;
/** Planche de boutons carte et « go » (6 images de 38 × 36). */
const BUTTON_SHEET = 6000;
/** Ticks pendant lesquels un bouton reste dessiné appuyé. */
const PRESSED_TICKS = 6;

/** Premier `SCRB` des boutons d'ingrédients de chaque niveau (état éteint ; +1 allumé), 2 scripts par bouton (`1130:0000`). */
const BUTTON_BASE: readonly number[] = [7005, 7015, 7027, 7041];
/** `SCRB` de la pizza en préparation dans le four (`1130:1c58` : 7001 + niveau) et de la porte pendant le service (`1130:1e08` : 7057 au niveau 0, 7058 ensuite). */
const PREVIEW_BASE = 7001;
const OVEN_SERVE = 7066;
const DOOR_SERVE = [7057, 7058] as const;
/** Table des trolls (`8033`, `DS:8d50`), planche 8000 image 1 en (419, 295). */
const TABLE_SCRIPT = 8033;
/** Pizza qui sort du four (`12000`, créée à l'évènement 33 du four), puis portée par le livreur jusqu'au troll servi : `12001`, `12006` ou `12011` (`1130:37b2`). */
const FLIGHT_FIRST = 12000;
const FLIGHT_CARRIED = [12001, 12006, 12011] as const;
/**
 * Gestes du livreur (`SCRS` NORMAL de `PIZZA.MHK`, + pieds − 1) : il prend la pizza (`13000`, évènement 61 du four, `1130:374b`), puis la porte jusqu'au
 * premier troll encore à servir (`13005`, `13010` ou `13015`, à la fin du four, `1130:37b2`), en même temps que la pizza.
 */
const DELIVERER_TAKE = 13000;
const DELIVERER_CARRY = [13005, 13010, 13015] as const;
/** Évènements du four (`SCRB` 7066, rappel `1130:367c`, table `CS:3883`, octet bas − 1) : la pizza sort (`e33`), le livreur la prend (`e61`). */
const OVEN_EVENT_PIZZA = 32;
const OVEN_EVENT_TAKE = 60;
/** Délai entre images du livreur pendant sa première montée au comptoir (`1130:4cb5` : `+0x28 = 2`) ; ensuite 6 (`1130:4571`). */
const DELIVERER_FIRST_DELAY = 2;

/**
 * Touches du mode de test (`1130:1a66`, table `CS:1c1c`). `R`, `O`, `D` (majuscules seulement) font monter `DS:8d22` (0 au départ, `1130:0000`) ; les autres touches
 * à effet en exigent au moins 3. Codes de `WM_CHAR`.
 */
const KEY = (letter: string): number => letter.charCodeAt(0);
/** Valeur de `DS:8d22` à partir de laquelle les touches `N`, `P`, `S`, `W` et Espace agissent. */
const DEBUG_UNLOCKED = 3;
/**
 * Parcours des scripts des trolls par `N` (Arno), `W` (Willa) et `S` (Shyler) : premier `SCRB` (`0x1f40`, `0x2328`, `0x2710`) et nombre de scripts parcourus
 * (`CS:1b88`, `1b8a`, `1b8c` : remis à 0 à `0x24`, `0x23`, `0x27`).
 */
const PROBE_TROLLS = [
  { base: 8000, count: 36 },
  { base: 9000, count: 34 },
  { base: 10000, count: 39 },
] as const;
/** Libellés de `1130:3355` (`wsprintf` « %s%d %d … » : huit drapeaux 0 / 1 par ligne). */
const SET_LABELS = ["Arno    ", "Willa   ", "Shyler  "] as const;
const MEAL_LABEL = "Meal     ";
/** Lignes de l'affichage de mise au point : en haut à gauche, 310 × 16 chacune (le rectangle exact de `1130:3355`, lu dans `DS:1b8e`, n'est pas relu). */
const SETS_LINE = { x: 0, w: 310, h: 16 } as const;

/** Délai entre deux images (`11a8:0ad6` : 6). */
const DELAY = 6;
/** Flags des objets de décor (`0x188000`) et des assiettes ou de la pizza en vol (`0x4108000`, qui jouent dès la création). */
const STATIC = FeatureFlag.noReplay | FeatureFlag.stopAtEnd | FeatureFlag.active;
const PLAYING = FeatureFlag.stopAtEnd | FeatureFlag.active;
/** Profondeurs : le décor, le four, les boutons, la table, la pizza, les trolls, les assiettes ; les Zoombinis du kit sont à 1 + y / 1000. */
const DEPTH = { oven: 0, preview: 0.1, buttons: 0.2, table: 0.3, flight: 0.35, trolls: 0.4, plates: 0.5, deliverer: 1 } as const;

/** Rectangles de prise des ingrédients, par niveau et indice `k` (régions 4 à 11 de `1130:1803`, §4.2). `null` : pas de bouton à ce niveau. */
export const PIZZA_INGREDIENT_REGIONS: readonly (readonly (Rect | null)[])[] = [
  [r(48, 185, 100, 210), r(48, 211, 100, 236), r(48, 237, 100, 263), r(48, 264, 100, 288), r(48, 289, 100, 317), null, null, null],
  [r(33, 196, 85, 221), r(33, 222, 85, 247), r(33, 248, 85, 275), r(33, 276, 85, 301), null, r(88, 215, 115, 254), r(88, 255, 115, 294), null],
  [r(33, 182, 85, 210), r(33, 211, 85, 236), r(33, 237, 85, 262), r(33, 263, 85, 288), r(33, 289, 85, 316), r(88, 215, 115, 254), r(88, 255, 115, 295), null],
  [r(33, 182, 85, 210), r(33, 211, 85, 236), r(33, 237, 85, 262), r(33, 263, 85, 288), r(33, 289, 85, 316), r(88, 195, 115, 232), r(88, 237, 115, 274), r(88, 276, 115, 314)],
];
/** Régions « servir » : la bouche du four (3) et la bande de comptoir (12). */
export const PIZZA_SERVE_REGIONS: readonly Rect[] = [r(33, 97, 120, 157), r(130, 99, 174, 308)];

function r(left: number, top: number, right: number, bottom: number): Rect {
  return { left, top, right, bottom };
}

function inside(rect: Readonly<Rect>, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** Places d'attente du groupe (`1130:0000` : `11a8:0ed9(1, 1478:0a04, 16)`), lues dans le segment de données de l'exécutable. Le livreur part de la première. */
export const PIZZA_PLACES: readonly Point[] = [
  { x: 288, y: 389 }, { x: 240, y: 386 }, { x: 257, y: 434 }, { x: 202, y: 396 }, { x: 224, y: 437 }, { x: 186, y: 443 }, { x: 158, y: 400 }, { x: 151, y: 455 },
  { x: 126, y: 391 }, { x: 118, y: 446 }, { x: 89, y: 403 }, { x: 86, y: 456 }, { x: 48, y: 396 }, { x: 51, y: 440 }, { x: 20, y: 416 }, { x: 18, y: 457 },
];
/** Arrivée échelonnée (`1168:274e(30, 45)`) et marche de sortie (`1168:2982(45, 0, 250, 690)` : x = 690, y = 250). */
const START_DELAY = 30;
const STEP_DELAY = 45;
const EXIT_WALK = { x: 690, y: 250, step: 45 } as const;
/** `NODE` / `PATH` de l'écran (`1168:2a5c(1000)`), suivis par la marche de sortie. */
const WALK_MAP = 1000;
/** Pieds du livreur au comptoir (`DS:1b6e`, lu dans le segment de données de l'exécutable). */
export const PIZZA_COUNTER: Point = { x: 270, y: 334 };
/** Voix d'introduction rejouée par F1 (`DS:a2c4`) : niveau 0 `20071`, sinon `20072`. */
const INTRO_VOICES = [20071, 20072] as const;
/** Ambiance : une animation de troll toutes les 3600 ticks quand rien ne joue (`1130:0d85`, `0xe10`). */
const AMBIENT_TICKS = 3600;

/** Voix du narrateur à l'entrée (`1130:5358`, ids `15000…15006`) selon le code. **Probable** pour l'enchaînement : l'original coupe la suite si une voix est interrompue. */
const NARRATION: readonly (readonly number[])[] = [[15005, 15006], [15000, 15001], [15002], [15003, 15004], [15003, 15004, 15005, 15006]];

/** Position des pieds à la dernière image d'un `SCRS` posé en `start` (`1168:4741` suit la première case de chaque image). */
function scriptEnd(script: Script, start: Point): Point {
  const origin = scriptAnchorOffset(script.images, start, false);
  let last = script.images[0]?.cells[0];
  for (const image of script.images) {
    const first = image.cells[0];
    if (first && first.w > 0) last = first;
  }
  return last ? { x: origin.x + last.x, y: origin.y + last.y } : start;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Parties des pizzas (filtres d'image)

/**
 * Couche d'une pizza dans une planche : 0 la base, 1 à 5 les pizzas k4 à k0, 6 la base des sundaes (hors niveau 0), 7 à 9 les sundaes k7 à k5 (`1130:3bbf`, `1130:1ce0`).
 * Renvoie vrai si la couche se dessine pour l'ensemble `mask`.
 */
function layerShown(layer: number, mask: number, level: number): boolean {
  if (layer === 0) return true;
  if (layer <= 5) return has(mask, 5 - layer);
  if (layer === 6) return level !== 0;
  return level !== 0 && has(mask, 14 - layer);
}

/** Planches des trolls : les couches sont les images 152 à 191 (4 variantes par couche). */
function trollLayers(parts: FeaturePart[], mask: number, level: number): FeaturePart[] {
  return parts.filter((p) => p.w < 152 || p.w > 191 || layerShown((p.w - 152) >> 2, mask, level));
}

/** Planche des assiettes (12000) : toutes les parties sont des couches (images 1 à 40, 4 variantes par couche). */
function plateLayers(parts: FeaturePart[], mask: number, level: number): FeaturePart[] {
  return parts.filter((p) => layerShown((p.w - 1) >> 2, mask, level));
}

/** Pizza en préparation dans le four : parties 57 à 61 (k0 à k4) et 67 à 69 (k5 à k7) selon les bascules, le reste est fixe (`1130:1ce0`). */
function previewLayers(parts: FeaturePart[], meal: number): FeaturePart[] {
  return parts.filter((p) => {
    if (p.w >= 57 && p.w <= 61) return has(meal, p.w - 57);
    if (p.w >= 67 && p.w <= 69) return has(meal, 5 + p.w - 67);
    return true;
  });
}

// ---------------------------------------------------------------------------------------------------------------------------

const STATES = new WeakMap<Scene, () => PizzaState | null>();

/** Règles en cours d'une scène de pizza (tests et robot) ; null avant l'entrée. */
export function pizzaStateOf(scene: Scene): PizzaState | null {
  return STATES.get(scene)?.() ?? null;
}

/** Scène de l'épreuve de la hutte à pizza (écran 9). À enregistrer à la place de l'épreuve provisoire : `engine.register(ScreenId.pizza, createPizzaScene)`. */
export function createPizzaScene(): Scene {
  const name = screenInfo(ScreenId.pizza)?.archive;
  if (!name) throw new Error("createPizzaScene : pas d'archive pour l'écran 9");
  let archive: Archive;
  let ctx: SceneContext;
  let kit: PuzzleKit | null = null;
  let party: Zoombini[] = [];
  let state: PizzaState | null = null;
  let features: Features;
  /** Objets de l'écran. */
  let preview: Feature;
  let oven: Feature;
  let flight: Feature | null = null;
  const ingredientButtons = new Map<number, Feature>();
  const trolls: (Feature | null)[] = [null, null, null];
  /** Assiettes de l'historique par emplacement (type 4 : 0 à 15 ; types 5 à 7 : 3 emplacements chacun) et le masque qu'elles montrent. */
  const plateSlots = new Map<string, Feature>();
  const plateMasks = new Map<Feature, number>();
  /** L'écran est quitté (rappels ignorés). */
  let gone = true;
  /** Le service est permis (intro finie, rien ne joue) ; `busy` : un repas est en cours. */
  let ready = false;
  let ovenBusy = false;
  /** Le livreur a été appelé au comptoir (`1130:4cb5`, `8d10`). */
  let delivererCalled = false;
  let nextAmbient = 0;
  /** `DS:8d22` : avancement de la saisie des touches de test (`R`, `O`, `D`, puis `R` en plus), remis à 0 à l'entrée (`1130:0000`). */
  let debugStage = 0;
  /** `DS:8d6e` : budget de repas manqués du début de l'écran (copie de `8d5a`, `1130:0000`). */
  let initialBudget = 0;
  /** `CS:1b88`, `1b8a`, `1b8c` : prochain script des trolls parcourus par `N`, `W`, `S` (dans le segment de code : conservés d'une entrée à l'autre, ici le temps de la scène). */
  const probe = [0, 0, 0];
  /** Attentes de silence (narrateur). */
  const silenceWaiters: (() => void)[] = [];

  // ------------------------------------------------------------------------------------------------------------------------
  // Aides

  const level = () => state!.level;
  const sound = () => ctx.services.get(ZOOMBINIS_SOUND);

  const soundIdle = (): boolean => kit?.soundIdle() ?? true;

  /** Joue le script `id` sur `feature`, avec son filtre d'image ; `done` est appelé à la fin de l'animation. */
  function play(feature: Feature, id: number, done?: () => void, hook?: FeatureImageHook): void {
    feature.onEvent = (_image, n) => {
      if (n === FEATURE_END && !gone) done?.();
    };
    feature.onImage = hook;
    features.setScript(feature, id);
  }

  /** Rappelle `done` après `count` appels de la fonction rendue. */
  function join(count: number, done: () => void): () => void {
    let left = count;
    return () => {
      left -= 1;
      if (left === 0 && !gone) done();
    };
  }

  /** Filtre des parties de pizza d'un troll d'après un ensemble. */
  const trollHook = (mask: () => number): FeatureImageHook => (_f, parts) => trollLayers(parts, mask(), level());

  /** Voix à la suite : chacune attend le silence. */
  function speak(ids: readonly number[], done: () => void): void {
    const [first, ...rest] = ids;
    if (first === undefined) {
      done();
      return;
    }
    sound().queue(first);
    silenceWaiters.push(() => speak(rest, done));
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Boutons d'ingrédients et four

  function buttonScript(k: number, on: boolean): number {
    const index = k > 4 && level() === 1 ? k - 1 : k;
    return BUTTON_BASE[level()]! + 2 * index + (on ? 1 : 0);
  }

  /** `1130:1c58` : la pizza du four reprend son script avec le filtre des bascules. */
  function refreshPreview(): void {
    play(preview, PREVIEW_BASE + level(), undefined, (_f, parts) => previewLayers(parts, state!.meal));
  }

  function toggle(k: number): void {
    const on = toggleIngredient(state!, k);
    if (on === null) return;
    play(ingredientButtons.get(k)!, buttonScript(k, on));
    refreshPreview();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Livreur (premier Zoombini du groupe, `pizza.md` §2.5)

  function deliverer(): KitMember | null {
    return kit?.members[state!.deliverer] ?? null;
  }

  /** `1130:4cb5` : le premier du groupe monte au comptoir dès qu'il est posé sur sa place, à pas rapides (délai 2). Une seule fois (`8d14` n'est jamais posé). */
  function callDeliverer(): void {
    if (delivererCalled) return;
    const member = deliverer();
    if (!member || member.snoid.destroyed || member.walking || !member.snoid.resting) return;
    delivererCalled = true;
    member.snoid.delay = DELIVERER_FIRST_DELAY;
    // Marche du kit, non comptée dans `walking` : le livreur ne bloque pas les autres.
    kit!.walk(member, PIZZA_COUNTER, undefined, { counted: false });
  }

  /**
   * Le livreur joue un de ses gestes (`1168:3f76` : depuis l'endroit où il est, la marche en cours s'arrête). À la fin il reste sur la dernière image ; sa position
   * est celle de la dernière case (`1168:4741`).
   */
  function delivererGesture(id: number, done?: () => void): void {
    const member = deliverer();
    if (!member || member.snoid.destroyed) {
      done?.();
      return;
    }
    const snoid = member.snoid;
    kit!.cancelWalk(member);
    const script = scrs(archive, id + snoid.traits.feet - 1);
    const start = { ...snoid.position };
    snoid.onEnd = () => {
      snoid.onEnd = undefined;
      snoid.setPosition(scriptEnd(script, start));
      if (!gone) done?.();
    };
    snoid.play(id + snoid.traits.feet - 1, FeatureFlag.stopAtEnd, { kind: "normal" });
  }

  /** `1130:4571` puis `0d85` : le livreur reprend la pose d'attente, au pas normal (délai 6), et retourne au comptoir (`DS:1b6e`), tout droit (`DS:970c = 1`). */
  function returnDeliverer(): void {
    const member = deliverer();
    if (!member || member.snoid.destroyed) return;
    member.snoid.delay = DELAY;
    kit!.walk(member, PIZZA_COUNTER, undefined, { counted: false });
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Trolls

  function troll(k: number): Feature {
    return trolls[k]!;
  }

  /** Enchaîne les réactions (une animation à la fois, `0d85`). */
  function playReactions(serve: PizzaServe, index: number, done: () => void): void {
    const reaction = serve.reactions[index];
    if (!reaction) {
      done();
      return;
    }
    const hook = trollHook(() => state!.served);
    play(troll(reaction.troll), reaction.script, () => playReactions(serve, index + 1, done), hook);
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Assiettes de l'historique (`478e`, `595f`)

  function plateKey(plate: PizzaPlate): string {
    return `${plate.type}:${plate.slot}`;
  }

  /** Pose l'assiette de l'historique ; `done` quand elle a fini de tomber. */
  function addPlateFeature(plate: PizzaPlate, done?: () => void): void {
    const hook: FeatureImageHook = (feature, parts) => plateLayers(parts, plateMasks.get(feature) ?? plate.mask, level());
    const existing = plateSlots.get(plateKey(plate));
    if (existing && !existing.destroyed) {
      plateMasks.set(existing, plate.mask);
      play(existing, plate.script, done, hook);
      return;
    }
    const feature = features.create({ script: plate.script, delay: DELAY, flags: plate.initial ? STATIC : PLAYING, depth: DEPTH.plates, onImage: hook });
    plateMasks.set(feature, plate.mask);
    plateSlots.set(plateKey(plate), feature);
    if (plate.initial) {
      done?.();
    } else if (done) {
      feature.onEvent = (_image, n) => {
        if (n === FEATURE_END && !gone) done();
      };
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Service

  /** `1130:367c` (évènement 33 du four) : la pizza sort du four (`SCRB` 12000), avec les couches du repas. */
  function drawFlight(mask: number): void {
    if (flight && !flight.destroyed) features.destroy(flight);
    const hook: FeatureImageHook = (_f, parts) => plateLayers(parts, mask, level());
    // `0x108000` sans `0x2000`, mais la feature, ajoutée en fin de liste pendant le tour du four, est lue dans le même passage de `11a8:04b9` : sa
    // première image (la pizza dans la bouche du four) s'affiche dans le tick même de l'évènement 33, pas au suivant.
    flight = features.create({ script: FLIGHT_FIRST, delay: DELAY, flags: PLAYING | FeatureFlag.firstImage, depth: DEPTH.flight, onImage: hook });
  }

  function removeFlight(): void {
    if (flight && !flight.destroyed) features.destroy(flight);
    flight = null;
  }

  /** Premier troll encore à servir (`8d52`, `8d54`, `8d56` = 1, dans cet ordre ; le troisième par défaut) : il choisit le trajet du livreur et de la pizza. */
  function servedTroll(): number {
    const trolls = state!.trolls;
    if (trolls[0] === "present") return 0;
    if (trolls[1] === "present") return 1;
    return 2;
  }

  function serve(): void {
    const s = state!;
    const previous = s.meal;
    const towards = servedTroll();
    const result = serveMeal(s, ctx.rng);
    if (!result) return;
    ready = false;
    ovenBusy = true;
    // `55d9` : les boutons allumés repartent à zéro.
    for (const k of availableIngredients(s.level)) if (has(previous, k)) play(ingredientButtons.get(k)!, buttonScript(k, false));
    // `1e08` (case 3) : porte du four et four (7066) ; ses évènements font sortir la pizza (33) et la font prendre au livreur (61) ; à sa fin (`37b2`), le livreur
    // la porte jusqu'au troll pendant que la pizza suit (12001 / 12006 / 12011) ; les réactions attendent les deux (`8d30`).
    play(preview, DOOR_SERVE[s.level === 0 ? 0 : 1], undefined, (_f, parts) => previewLayers(parts, 0));
    play(oven, OVEN_SERVE, () => {
      ovenBusy = false;
      if (!flight || flight.destroyed) drawFlight(result.meal);
      const both = join(2, () => verdicts(result));
      const hook: FeatureImageHook = (_f, parts) => plateLayers(parts, result.meal, level());
      // `1f5c(pizza, livreur)` (`1130:386a`) : un groupe avance au rythme de son meneur (`11a0:033a`, `1520:06da`), ici le livreur, placé avant la pizza
      // dans la liste (`2a0a`) : la pizza prend son délai (2 à la première livraison, `1130:4cb5` ; 6 ensuite, `1130:4571`). Les deux partent dans le même tick.
      flight!.delay = deliverer()?.snoid.delay ?? DELAY;
      play(flight!, FLIGHT_CARRIED[towards]!, both, hook);
      delivererGesture(DELIVERER_CARRY[towards]!, both);
    });
    const ovenEvents = oven.onEvent;
    oven.onEvent = (image, n, feature) => {
      if (n === OVEN_EVENT_PIZZA && !gone) drawFlight(result.meal);
      else if (n === OVEN_EVENT_TAKE && !gone) delivererGesture(DELIVERER_TAKE);
      ovenEvents?.(image, n, feature);
    };
  }

  /** Réactions des trolls puis la suite du repas. */
  function verdicts(result: PizzaServe): void {
    playReactions(result, 0, () => {
      if (result.perfect !== null) {
        // Le troll content part avec sa pizza ; le livreur revient tout de suite (`4571`).
        const k = result.perfect;
        removeFlight();
        returnDeliverer();
        play(troll(k), TROLL_LEAVE[k]!, () => (result.allSatisfied ? finale() : resume()), trollHook(() => state!.liked[k]!));
        return;
      }
      if (result.delivererReturns) returnDeliverer();
      const thrown = () => {
        if (result.thrower === null || !result.plate) {
          removeFlight();
          resume();
          return;
        }
        // Le troll lance l'assiette : elle tombe dans l'historique.
        const k = result.thrower;
        removeFlight();
        play(troll(k), TROLL_THROW[k]!, () => addPlateFeature(result.plate!, resume), trollHook(() => state!.served));
      };
      if (result.fury) {
        play(troll(result.fury.troll), result.fury.script, thrown);
      } else {
        thrown();
      }
    });
  }

  /** Le four est prêt à nouveau (`4ff7`) : un repas peut être préparé et servi. */
  function resume(): void {
    ready = true;
    ovenBusy = false;
    refreshPreview();
    nextAmbient = ctx.clock.ticks + AMBIENT_TICKS;
  }

  /** Scène de départ (`3893`) : « go » actif tout de suite ; la voix de réussite suit la scène d'Arno. */
  function finale(): void {
    ready = false;
    ovenBusy = false;
    refreshPreview();
    if (kit) kit.goEnabled = true;
    playDeparture();
  }

  /** `1130:3893` : les scènes de départ des trolls présents (la voix de réussite suit celle d'Arno, rappel `3bbf`). */
  function playDeparture(): void {
    const scripts = departureScripts(state!, ctx.rng);
    for (const { troll: k, script } of scripts) {
      const hook = trollHook(() => state!.liked[k]!);
      play(troll(k), script, k === 0 ? () => kit?.playSuccessVoice() : undefined, hook);
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Touches du mode de test (`1130:1a66`)

  /**
   * `1130:3355` (`A`, `a`) : affiche les ensembles aimés des trolls encore à servir et le repas en préparation, huit drapeaux 0 / 1 par ligne (ingrédients 0 à 7).
   * **Écart** : une ligne de texte par ligne de l'original en haut à gauche de l'écran, sans le cadre ni la mise en page de l'original ; effacé au prochain
   * redessin de la zone.
   */
  function showSets(): boolean {
    const screen = ctx.services.get(GRAPHICS).screen;
    const text = ctx.services.tryGet(ZOOMBINIS_TEXT);
    const flags = (mask: number): string => Array.from({ length: 8 }, (_, k) => (has(mask, k) ? 1 : 0)).join(" ");
    const lines: string[] = [];
    for (let k = 0; k < 3; k++) if (state!.trolls[k] === "present") lines.push(`${SET_LABELS[k]}${flags(state!.liked[k]!)}`);
    lines.push(`${MEAL_LABEL}${flags(state!.meal)}`);
    lines.forEach((line, row) => {
      const rect = { x: SETS_LINE.x, y: row * SETS_LINE.h, w: SETS_LINE.w, h: SETS_LINE.h };
      screen.fill(0xff, rect);
      text?.drawText(screen, "small", line, rect, TextFlags.center | TextFlags.vcenter, 0);
    });
    ctx.requestPresent();
    return true;
  }

  /** `R` : `8d22` repart à 1 (au plus 2), sinon monte d'un. `O` puis `D` le portent de 1 à 3 ; au-delà, `R` ne fait que monter (au-delà de 5 la région 13 serait active : code mort). */
  function raiseStage(): boolean {
    debugStage = debugStage <= 2 ? 1 : debugStage + 1;
    return true;
  }

  function stageStep(from: number): () => boolean {
    return () => {
      if (debugStage === from) debugStage += 1;
      return true;
    };
  }

  /** `N`, `W`, `S` (`8d22 ≥ 3`) : le troll joue le script suivant de sa série (`11a8:1be6(1, base + n, objet)`), la série repart au début après le dernier. */
  function probeTroll(k: number): () => boolean {
    return () => {
      if (debugStage < DEBUG_UNLOCKED) return false;
      const { base, count } = PROBE_TROLLS[k]!;
      if (probe[k]! >= count) probe[k] = 0;
      const script = base + probe[k]!;
      probe[k] = probe[k]! + 1;
      // L'objet d'un troll absent n'existe pas dans le port.
      if (trolls[k]) play(troll(k), script, undefined, trollHook(() => state!.liked[k]!));
      return true;
    };
  }

  const debugKeys: Readonly<Record<number, () => boolean>> = {
    [KEY("A")]: showSets,
    [KEY("a")]: showSets,
    [KEY("R")]: raiseStage,
    [KEY("O")]: stageStep(1),
    [KEY("D")]: stageStep(2),
    [KEY("N")]: probeTroll(0),
    [KEY("n")]: probeTroll(0),
    [KEY("W")]: probeTroll(1),
    [KEY("w")]: probeTroll(1),
    [KEY("S")]: probeTroll(2),
    [KEY("s")]: probeTroll(2),
    // `P` : rejoue la scène de départ (`3893`), sans rien changer d'autre (`8d26` est remis à 0 : plus de chaîne d'états en cours).
    [KEY("P")]: () => (debugStage < DEBUG_UNLOCKED ? false : (playDeparture(), true)),
    [KEY("p")]: () => (debugStage < DEBUG_UNLOCKED ? false : (playDeparture(), true)),
    // Espace : le budget de repas manqués tolérés redevient celui du début de l'écran (`8d5a ← 8d6e`).
    [0x20]: () => (debugStage < DEBUG_UNLOCKED ? false : ((state!.budget = initialBudget), true)),
  };

  // ------------------------------------------------------------------------------------------------------------------------
  // Entrée : narrateur, présentations des trolls, réplique d'attente

  function intro(): void {
    const s = state!;
    const memoryIndex = dialogMemoryIndex(ScreenId.pizza);
    const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
    let code: number;
    {
      const { game, session } = zoombinis;
      const memory = memoryIndex >= 0 ? game.dialogMemory[memoryIndex]! : 0;
      const result = dialogChoice(memory, s.level, session.training !== 0);
      if (memoryIndex >= 0) game.dialogMemory[memoryIndex] = result.memory;
      // `1130:0000` : choix 1, ou 5 au niveau 0 : code 0 ; sinon tirage 0 à 100 : plus de 75 → 3, plus de 50 → 2, plus de 25 → 1, sinon 0.
      if (result.choice === 1 || (result.choice === 5 && s.level === 0)) {
        code = 0;
      } else {
        const roll = ctx.rng.rand(100);
        code = roll > 75 ? 3 : roll > 50 ? 2 : roll > 25 ? 1 : 0;
      }
    }
    speak(NARRATION[code]!, () => introduce(0));
  }

  /** Chaque troll présent joue son introduction à son tour (`4ec8`), puis la réplique d'attente (`4de0`). */
  function introduce(k: number): void {
    if (gone) return;
    const s = state!;
    if (k >= 3 || s.trolls[k] === "absent") {
      if (k >= 3) {
        const hint = hintScript(s, ctx.rng);
        play(troll(hint.troll), hint.script, resume);
        return;
      }
      introduce(k + 1);
      return;
    }
    play(troll(k), TROLL_OBJECT[k]!, () => introduce(k + 1));
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Clics

  /** Clic hors des boutons carte et « go » (gérés par le kit) : service, ingrédients. */
  function onPointerDown(x: number, y: number): boolean {
    const k = kit;
    if (!k || k.left) return true;
    if (k.departing) return true;
    const s = state!;
    if (PIZZA_SERVE_REGIONS.some((rect) => inside(rect, x, y))) {
      if (ready && !ovenBusy && !allSatisfied(s)) serve();
      return true;
    }
    if (ovenBusy) return false;
    const regions = PIZZA_INGREDIENT_REGIONS[s.level]!;
    for (const index of availableIngredients(s.level)) {
      const rect = regions[index];
      if (rect && inside(rect, x, y)) {
        toggle(index);
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
      zoombinis.session.screen = ScreenId.pizza;
      const chosen = currentLevel(zoombinis.game, zoombinis.session, ScreenId.pizza);
      if (chosen < 0 || chosen >= PIZZA_LEVELS) throw new RangeError(`pizza : niveau ${chosen}`);
      state = newPizza(ctx.rng, chosen);
      debugStage = 0;
      initialBudget = state.budget;
      ready = false;
      ovenBusy = false;
      delivererCalled = false;
      flight = null;
      plateSlots.clear();
      plateMasks.clear();
      silenceWaiters.length = 0;
      openScreen(ctx, archive, { background: BACKGROUND });
      features = ctx.services.get(FEATURES);
      // Groupes de formes et plages de scripts (`1130:0000`).
      features.defineGroup(0, 7000);
      features.defineGroup(1, 8000);
      features.defineGroup(2, 12000);
      features.setScripts(7000, 69);
      features.addScripts(8000, 36);
      features.addScripts(12000, 45);
      if (state.level >= 1) {
        features.defineGroup(3, 9000);
        features.addScripts(9000, 35);
      }
      if (state.level >= 2) {
        features.defineGroup(4, 10000);
        features.addScripts(10000, 39);
      }
      for (const id of [TABLE_SCRIPT, TROLL_OBJECT[0], OVEN_SERVE]) if (!archive.has(TAG_SCRB, id)) throw new Error(`pizza : SCRB ${id} absent de ${name}`);

      // Four, pizza en préparation, boutons d'ingrédients, table, trolls (`1130:0000` : `0x188000`, délai 6).
      oven = features.create({ script: 7000, delay: DELAY, flags: STATIC, depth: DEPTH.oven });
      preview = features.create({ script: PREVIEW_BASE + state.level, delay: DELAY, flags: FeatureFlag.stopAtEnd | FeatureFlag.active, depth: DEPTH.preview });
      preview.onImage = (_f, parts) => previewLayers(parts, state!.meal);
      ingredientButtons.clear();
      for (const k of availableIngredients(state.level)) {
        ingredientButtons.set(k, features.create({ script: buttonScript(k, false), delay: DELAY, flags: STATIC, depth: DEPTH.buttons }));
      }
      features.create({ script: TABLE_SCRIPT, delay: DELAY, flags: STATIC, depth: DEPTH.table });
      for (let k = 0; k < 3; k++) {
        trolls[k] = state.trolls[k] === "absent" ? null : features.create({ script: TROLL_OBJECT[k]!, delay: DELAY, flags: STATIC, depth: DEPTH.trolls });
      }
      // Assiettes de départ du niveau 3 (`595f`).
      for (const plate of state.plates) addPlateFeature(plate);

      // Le groupe de la scène : copie des présents du tampon (`party` de `exitPuzzle`).
      party = zoombinis.game.group.members.filter((z) => z.present).map((z) => ({ ...z, attrs: [...z.attrs] as Zoombini["attrs"], state: z.state.slice() }));
      const places = party.map((_, i) => ({ ...PIZZA_PLACES[i % PIZZA_PLACES.length]! }));
      kit = createPuzzleKit(ctx, {
        screen: ScreenId.pizza,
        party,
        places: places.length > 0 ? places : [{ ...PIZZA_PLACES[0]! }],
        // Gestes du livreur (`SCRS` 13000 à 13039 de l'écran).
        snoid: { scripts: screenScripts(archive) },
        // Aucun glisser-déposer (région 13 inerte).
        canPick: () => false,
        // Boutons carte et « go » (planche 6000, `1130:0be6`), dessinés par le kit sous les objets de l'écran ; image enfoncée tenue 6 ticks.
        // `1168:3dd0(0, 1)` : « go » sauve le groupe entier avant la sortie.
        buttons: {
          map: { images: sheetButtonImages(archive.tbmpImages(BUTTON_SHEET)).map, hold: PRESSED_TICKS },
          go: {
            images: sheetButtonImages(archive.tbmpImages(BUTTON_SHEET)).go,
            hold: PRESSED_TICKS,
            onPress: (k) => {
              k.pressGo({ saveAll: true });
              return true;
            },
          },
          depth: DEPTH.buttons,
        },
        exitWalk: EXIT_WALK,
        // `1130:0000` charge `NODE` / `PATH` 1000 (`1168:2a5c`) ; « go » (`1130:1803`) remet `DS:970c` à 0 : la sortie suit les chemins.
        walkMap: { nodes: node(archive, WALK_MAP), paths: path(archive, WALK_MAP) },
        introVoice: INTRO_VOICES[state.level === 0 ? 0 : 1]!,
        onPointerDown,
      });
      kit.arrive({ startDelay: START_DELAY, step: STEP_DELAY });
      kit.playMusic();
      nextAmbient = Number.POSITIVE_INFINITY;
      STATES.set(scene, () => state);
      ctx.requestPresent();
      intro();
    },
    leave(c: SceneContext) {
      gone = true;
      kit?.leave();
      kit = null;
      silenceWaiters.length = 0;
      flight = null;
      plateSlots.clear();
      plateMasks.clear();
      closeScreen(c);
    },
    tick() {
      if (!kit || gone) return;
      kit.tick();
      callDeliverer();
      const now = ctx.clock.ticks;
      if (silenceWaiters.length > 0 && soundIdle()) silenceWaiters.shift()!();
      if (ready && !ovenBusy && now >= nextAmbient && !(ctx.services.tryGet(DIALOG)?.isOpen ?? false)) {
        nextAmbient = now + AMBIENT_TICKS;
        const ambient = ambientScript(state!, ctx.rng);
        if (ambient && trolls[ambient.troll]) play(troll(ambient.troll), ambient.script);
      }
    },
    key(event, c: SceneContext) {
      if (!kit || kit.left) return false;
      if (event.ctrl || event.alt) return false;
      if (c.services.tryGet(DIALOG)?.isOpen) return false;
      if (kit.testKey(event, debugKeys)) return true;
      return kit.key(event);
    },
  };
  return scene;
}
