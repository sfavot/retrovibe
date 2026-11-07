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
 *  2. service (régions 3 et 12) : les boutons repartent à zéro, le four joue (`SCRB` 7066 et 7057 / 7058), le livreur (premier Zoombini du groupe) monte au comptoir, la
 *     pizza part du four vers la table des trolls (`SCRB` 12000 puis 12001, les parties filtrées par le repas) ;
 *  3. verdicts (`serveMeal`) : les trolls réagissent à tour de rôle ; un troll content part avec sa pizza (`SCRB` 8021 / 9027 / 10031, parties filtrées par ses ingrédients
 *     aimés) et arrête la chaîne ; si aucun n'est content le dernier qui a réagi (celui du premier verdict « incomplet » sinon) lance l'assiette (`SCRB` 8020 / 9026 / 10030),
 *     qui tombe dans l'historique (`SCRB` 12016–12040), le livreur revient à la file sauf après l'épuisement du budget (le premier troll présent joue alors la fureur) ;
 *  4. tous partis : scène de départ (`3893`), « go » actif ; la voix de réussite suit la scène d'Arno. « Go » sauve le groupe entier, la carte le perd entièrement.
 *
 * Boutons carte et « go » : rectangles `(600, 403)–(639, 440)` et `(600, 441)–(639, 478)`, gérés par le kit (images de la planche 6000 fournies ici, image appuyée tenue 6 ticks) ;
 * « go » sauve le groupe entier (`pressGo({ saveAll })`). Le glisser-déposer d'un Zoombini est coupé (région 13 inerte dans cette version, `pizza.md` §4.2).
 */
import type { Archive } from "../../../../engine/mohawk/resources";
import { TAG_SCRB } from "../../data/archives";
import type { Point } from "../../data/zoombini";
import { screenInfo } from "../../data/archives";
import { DIALOG } from "../../engine/dialog";
import { FEATURE_END, FEATURES, FeatureFlag, type Feature, type FeatureImageHook, type FeaturePart, type Features } from "../../engine/features";
import { ZOOMBINIS_GAME } from "../../engine/game";
import type { Scene, SceneContext } from "../../engine/scene";
import { ScreenId } from "../../engine/scene";
import { ZOOMBINIS_SOUND } from "../../engine/sound";
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
/** Pizza qui part du four (`12000`) puis traverse jusqu'à la table (`12001`). */
const FLIGHT_FIRST = 12000;
const FLIGHT_SECOND = 12001;

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

/** Places d'attente du groupe (le livreur, rang 0, est à gauche) : une rangée en bas de l'écran. **Choix** : le tableau `1478:0a04` de l'original n'est pas dans le corpus. */
const QUEUE_Y = 458;
const QUEUE_X = 30;
const QUEUE_STEP = 34;
/** Arrivée échelonnée (`1168:274e(30, 45)`) et marche de sortie (`1168:2982(45, 0, 250, 690)` : x = 690, y = 250). */
const START_DELAY = 30;
const STEP_DELAY = 45;
const EXIT_WALK = { x: 690, y: 250, step: 45 } as const;
/** Pieds du livreur au comptoir (`DS:1b6e`) : sous le point de départ de la pizza, `12000` finit en (247, 308). **Choix** : valeur non lue dans le corpus. */
export const PIZZA_COUNTER: Point = { x: 247, y: 338 };
/** Voix d'introduction rejouée par F1 (`DS:a2c4`) : niveau 0 `20071`, sinon `20072`. */
const INTRO_VOICES = [20071, 20072] as const;
/** Ambiance : une animation de troll toutes les 3600 ticks quand rien ne joue (`1130:0d85`, `0xe10`). */
const AMBIENT_TICKS = 3600;

/** Voix du narrateur à l'entrée (`1130:5358`, ids `15000…15006`) selon le code. **Probable** pour l'enchaînement : l'original coupe la suite si une voix est interrompue. */
const NARRATION: readonly (readonly number[])[] = [[15005, 15006], [15000, 15001], [15002], [15003, 15004], [15003, 15004, 15005, 15006]];

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
  let nextAmbient = 0;
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

  function walkDeliverer(to: Point, done: () => void): void {
    const member = deliverer();
    if (!member || member.walking || member.snoid.destroyed) {
      done();
      return;
    }
    const at = member.snoid.position;
    if (at.x === to.x && at.y === to.y) {
      done();
      return;
    }
    // Marche du kit, non comptée dans `walking` : le livreur ne bloque pas les autres.
    kit!.walk(
      member,
      to,
      () => {
        if (!gone) done();
      },
      { counted: false },
    );
  }

  function delivererHome(): Point | null {
    const member = deliverer();
    const place = member ? kit!.waitingPlaces[member.index] : null;
    return place ? { x: place.x, y: place.y } : null;
  }

  function returnDeliverer(): void {
    const home = delivererHome();
    if (home) walkDeliverer(home, () => {});
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

  function drawFlight(mask: number, done: () => void): void {
    if (flight && !flight.destroyed) features.destroy(flight);
    const hook: FeatureImageHook = (_f, parts) => plateLayers(parts, mask, level());
    flight = features.create({ script: FLIGHT_FIRST, delay: DELAY, flags: PLAYING, depth: DEPTH.flight, onImage: hook });
    flight.onEvent = (_image, n) => {
      if (n !== FEATURE_END || gone) return;
      play(flight!, FLIGHT_SECOND, done, hook);
    };
  }

  function removeFlight(): void {
    if (flight && !flight.destroyed) features.destroy(flight);
    flight = null;
  }

  function serve(): void {
    const s = state!;
    const previous = s.meal;
    const result = serveMeal(s, ctx.rng);
    if (!result) return;
    ready = false;
    ovenBusy = true;
    // `55d9` : les boutons allumés repartent à zéro.
    for (const k of availableIngredients(s.level)) if (has(previous, k)) play(ingredientButtons.get(k)!, buttonScript(k, false));
    // Le four joue (`1e08`, case 3) pendant que le livreur monte au comptoir ; ensuite la pizza part vers les trolls.
    const afterOven = join(2, () => {
      ovenBusy = false;
      drawFlight(result.meal, () => verdicts(result));
    });
    play(preview, DOOR_SERVE[s.level === 0 ? 0 : 1], undefined, (_f, parts) => previewLayers(parts, 0));
    play(oven, OVEN_SERVE, afterOven);
    walkDeliverer(PIZZA_COUNTER, afterOven);
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
    const scripts = departureScripts(state!, ctx.rng);
    for (const { troll: k, script } of scripts) {
      const hook = trollHook(() => state!.liked[k]!);
      play(troll(k), script, k === 0 ? () => kit?.playSuccessVoice() : undefined, hook);
    }
  }

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
      ready = false;
      ovenBusy = false;
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
      const places = party.map((_, i) => ({ x: QUEUE_X + i * QUEUE_STEP, y: QUEUE_Y }));
      kit = createPuzzleKit(ctx, {
        screen: ScreenId.pizza,
        party,
        places: places.length > 0 ? places : [{ x: QUEUE_X, y: QUEUE_Y }],
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
      return kit.key(event);
    },
  };
  return scene;
}
