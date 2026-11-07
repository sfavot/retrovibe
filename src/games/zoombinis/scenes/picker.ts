/**
 * Écran 3 : le choix des Zoombinis (`PICKER.MHK`, `docs/zoombinis/screens.md` §2). Portage de `1128:006d` (Enter), `1128:049a` (Exit),
 * `1128:0566` (Tick), `1128:05dc` (Key), `1128:061a` (clic sur un bouton d'attribut), `1128:079c` (clic sur une action, cas 1 à 7),
 * `1128:0eaf` / `1128:1122` / `1128:1302` (dessin des boutons et du Zoombini en cours de composition), `1128:13a4` / `1128:143a` /
 * `1128:16ac` / `1128:1b20` (disponibilité, « au hasard », exemplaires, groupe complet), `1128:187e` (places du groupe), `1128:17b9` /
 * `1128:1aa1` (décor animé) et `1168:1f84` (génération du nom).
 *
 * Décor (fond `tBMP` 4000 et palette `SHPL` 4000, formes `tBMP` 4100, `SCRB` 4100 à 4110), de l'arrière vers l'avant :
 *  - `SCRB` 4101 à 4103 : trois vagues, en boucle (délais 10, 11, 12) ; `SCRB` 4104 et 4105 : deux décors animés de la mer (délais 7 et 9),
 *    créés seulement sans l'option « moins d'action » (sinon par `Ctrl+W`), dont l'état (`S+0x26`, 0 à 3) dit lesquels jouent ;
 *  - `SCRB` 4100, 4110, 4106 à 4109 : l'arche de la grotte et les rochers du premier plan, images fixes ;
 *  - une feature sans script (rappels `1128:159d` / `1128:1578`) qui peint les boutons : 20 boutons d'attributs (`tBMP` 4400, 2 images par bouton,
 *    la seconde « enfoncée »), les 5 boutons d'action (`tBMP` 4200 : 1 à 3 ajouter, 4 à 7 au hasard, 8 à 10 départ, 11 et 12 carte), le Zoombini en cours
 *    de composition (`tBMP` 4300 : corps 1, cheveux 2 à 6, yeux 7 à 11, nez 12 à 16, pieds 17 à 21, ancres `DS:1ad8` / `DS:1aee`) et son nom sur une
 *    plaque (image 13 de `tBMP` 4200) ;
 *  - les Zoombinis du groupe (`scenes/snoid.ts`), sur les 16 places de `1470:03cc`, de l'arrière vers l'avant selon leur ordonnée.
 *
 * Boutons (rectangles de `1470:0000`, droit et bas exclus) : attributs 1 à 20 (4 lignes de 5, une ligne = un attribut : cheveux, yeux, nez, pieds),
 * puis les actions 1 (ajouter), 2 (le Zoombini en cours de composition : il parle), 3 (la plaque : nouveau nom), 4 (au hasard), 5 (carte), 6 (départ).
 *
 * Constats de lecture du code (qui corrigent `screens.md` §2) :
 *  - l'action 3 n'efface pas la sélection : elle tire un **nouveau nom** (`1168:1f84`, syllabes de `DS:14c8…14e0`) ; il n'y a pas de bouton « effacer » ;
 *  - le bouton « au hasard » avec `Maj` tenue remplit tout le groupe (le mode de test n'intervient que pour le raccourci de fin de jeu de l'action 1) ;
 *  - le départ ne fait embarquer qu'**un** Zoombini : le premier présent des places 11, 12, 6, 7 (`DS:1ac0`) marche vers la passerelle du bateau
 *    (544, 264, `NODE` 8) ; le groupe part quand il est arrivé et que le son 996 est fini (`1128:0566`) ; un clic pendant l'attente fait partir tout de suite ;
 *  - un Zoombini créé sort de la grotte (nœud 1 de `NODE` 1000, 148 × 215) et marche jusqu'à sa place par `PATH` 1000.
 *
 * Écarts : le retrait d'un Zoombini se fait au clic (l'original lance `1168:1742`, un glissement de la souris qui le ramène à sa place, et la condition
 * de retrait `1168:166e` demande une zone de dépôt que l'écran ne déclare pas : la cible exacte n'est pas établie) ; les Zoombinis retirés disparaissent
 * sans marcher ; pas d'animation d'attente des Zoombinis (clignements) ; l'enfoncement d'un bouton d'action dure 2 ticks comme `1090:00c1(1, 0, 2, …)` ;
 * mode de test `[a43f]` non porté ; le Zoombini qui embarque ne grimpe pas à l'échelle (il s'arrête au bout du chemin) ; le curseur n'est pas changé
 * (aucun appel dans `1128:*`, les zones de `1038:*` n'ont pas été décodées) ; phrase d'accueil de la première arrivée (`[384c]`, posé par le logo)
 * déduite de l'écran précédent (le logo).
 */
import { drawShape } from "../../../engine/mohawk/graphics/blit";
import type { Shape } from "../../../data/mohawk/shap";
import type { Surface } from "../../../engine/mohawk/graphics/surface";
import type { Archive } from "../../../engine/mohawk/resources";
import type { Point } from "../data/zoombini";
import { snoidVoiceId } from "../data/zoombini";
import { node, path } from "../engine/resources";
import { FEATURES, FeatureFlag, type Feature, type Features } from "../engine/features";
import { ZOOMBINIS_GAME } from "../engine/game";
import type { Scene, SceneContext } from "../engine/scene";
import { ScreenId } from "../engine/scene";
import { ZOOMBINIS_SOUND } from "../engine/sound";
import { TextFlags, ZOOMBINIS_TEXT } from "../engine/text";
import { addZoombini, groupComplete, isAvailable, pickerEnter, pickerLeave, pickRandomType, remainingToCreate, removeZoombini } from "../game/team";
import { STATE_BYTES, ZOOMBINI_TYPES, type Zoombini } from "../game/state";
import { closeScreen, openScreen } from "./screen-kit";
import { createSnoid, type Snoid } from "./snoid";

const ARCHIVE = "PICKER.MHK";
/** Fond et palette (`11a8:1475(4000)`), planche des formes du décor et ses 11 `SCRB` (`11a0:0000(0, 0, 4100)`, `11a8:14ab(11, 4100)`). */
const BACKGROUND = 4000;
const SHEET = 4100;
const SCRIPTS = 11;
const BUTTONS_SHEET = 4200;
const PARTS_SHEET = 4300;
const ATTRIBUTES_SHEET = 4400;

/** Scripts du décor. */
const WAVES = [4101, 4102, 4103] as const;
const MASCOT_A = 4104;
const MASCOT_B = 4105;
const ARCH = 4100;
const ARCH_DETAIL = 4110;
const ROCKS = [4106, 4107, 4108, 4109] as const;

/** Drapeaux inconnus du lecteur de features (`FeatureFlag.flag4000000` et deux bits jamais lus) : l'arche (`1128:006d`, `0x64000000`) et la couche des boutons (`0x4001000`). */
const ARCH_FLAGS = 0x64000000;
const BUTTON_LAYER_FLAGS = 0x4001000;
/** `0x108a000` : image fixe jouée une fois, dès la création. */
/**
 * Détail de l'arche (4110) : `0x108a000` dans l'original (`1128:006d`), donc avec le bit `0x1000000`. **Écart provisoire** : il reste dessiné (`still`) en attendant que
 * l'utilisatrice confirme l'aspect de l'original (l'ouverture sombre de la roche n'est pas dans le fond).
 */
const DETAIL_FLAGS = FeatureFlag.still | FeatureFlag.noReplay | FeatureFlag.active | FeatureFlag.firstImage;

/** Profondeurs : décor 0, décors animés créés par `Ctrl+W` 0,01 (ils sont créés avant les boutons à l'entrée), boutons 0,5, Zoombinis de 1 à 2. */
const BUTTON_LAYER_DEPTH = 0.5;

/** Sons : musique de l'écran (`0x7531`), phrases d'accueil et d'aide (`0x4e4a` à `0x4e4c`, lus comme les voix), sons des boutons (`ZOOMBINI.MHK` pour les ids sous 1000). */
const MUSIC = 30001;
const WELCOME = 20042;
const HINT_A = 20043;
const HINT_B = 20044;
const SOUND_SELECT = 1000;
const SOUND_ADD = 1005;
const SOUND_RANDOM = 1006;
const SOUND_REMOVE = 1007;
const SOUND_REFUSED = 1008;
const SOUND_MAP = 999;
const SOUND_GO = 996;

/** Indice de palette de l'encre du nom (`11e8:3034(…, 0x2d)`). */
const INK = 45;
/** Ticks d'enfoncement d'un bouton d'action (`1090:00c1(1, 0, 2, 0, 0)`). */
const PRESS_TICKS = 2;

/** `1470:0000` : 4 lignes de 5 boutons d'attributs de 39 × 42 (identifiants 1 à 20, `1128:061a`). */
const ATTRIBUTES = 4;
const VALUES = 5;
const ATTRIBUTE_ORIGIN = { x: 3, y: 304 } as const;
const ATTRIBUTE_STEP = { x: 39, y: 44 } as const;
const ATTRIBUTE_SIZE = { w: 39, h: 42 } as const;

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Actions (`1470:02ac` + 0x24 × k) ; les identifiants 1 à 6 sont ceux du `switch` de `1128:079c`. */
const Action = { add: 1, guide: 2, name: 3, random: 4, map: 5, go: 6 } as const;
const ACTION_BOXES: Readonly<Record<number, Box>> = {
  [Action.add]: { x1: 205, y1: 304, x2: 260, y2: 342 },
  [Action.guide]: { x1: 205, y1: 347, x2: 273, y2: 420 },
  [Action.name]: { x1: 201, y1: 419, x2: 287, y2: 437 },
  [Action.random]: { x1: 205, y1: 440, x2: 260, y2: 478 },
  [Action.map]: { x1: 600, y1: 403, x2: 639, y2: 440 },
  [Action.go]: { x1: 600, y1: 441, x2: 639, y2: 478 },
};
/** Images (1-based) de `tBMP` 4200 selon l'état (`1128:0eaf`) : prêt, enfoncé. */
const ADD_IMAGES = { disabled: 1, ready: 2, pressed: 3 } as const;
const RANDOM_IMAGES = { ready: 4, pressed: 5, fill: 6, fillPressed: 7 } as const;
const GO_IMAGES = { disabled: 8, ready: 9, pressed: 10 } as const;
const MAP_IMAGES = { ready: 11, pressed: 12 } as const;
const PLATE_IMAGE = 13;

/** Les 16 places du groupe (`1470:03cc`, pieds des Zoombinis) : trois rangées de 6, 5 et 5 de l'avant vers l'arrière. */
const SLOTS: readonly Point[] = [
  { x: 542, y: 446 },
  { x: 505, y: 447 },
  { x: 466, y: 451 },
  { x: 425, y: 448 },
  { x: 380, y: 450 },
  { x: 342, y: 451 },
  { x: 522, y: 402 },
  { x: 488, y: 408 },
  { x: 444, y: 416 },
  { x: 403, y: 413 },
  { x: 364, y: 413 },
  { x: 498, y: 360 },
  { x: 463, y: 367 },
  { x: 426, y: 370 },
  { x: 389, y: 373 },
  { x: 352, y: 374 },
];
/** Places que rejoint un Zoombini quand la place `i` se libère (`1128:187e` : le premier présent dans l'ordre, dans la même rangée). */
const PULL: readonly (readonly number[])[] = [
  [1, 2, 3, 4, 5],
  [1, 2, 3, 4],
  [1, 2, 3],
  [1, 2],
  [1],
  [],
  [1, 2, 3, 4],
  [1, 2, 3],
  [1, 2],
  [1],
  [],
  [1, 2, 3, 4],
  [1, 2, 3],
  [1, 2],
  [1],
];
/** `DS:1ac0` : places d'où part le Zoombini qui embarque (le premier présent). */
const DEPARTURE_SLOTS = [11, 12, 6, 7] as const;
/** Sortie de la grotte (`1168:0755(…, 0xd7, 0x94, …)` : nœud 1 de `NODE` 1000) et passerelle du bateau (`1128:079c` : `0x220`, `0x108`, nœud 8). */
const CAVE: Point = { x: 148, y: 215 };
const BOARDING: Point = { x: 544, y: 264 };
const NODE_PATH_ID = 1000;
/** Délai entre deux Zoombinis du remplissage (`Maj` + au hasard, `1128:079c` cas 4) : 60 à 120 ticks, ou 120 à 180 avec « moins d'action ». */
const FILL_GAP = { normal: [0x3c, 0x78], less: [0x78, 0xb4] } as const;

/** Le Zoombini en cours de composition (`1128:1302`) : pieds `+0xbf` (+16), corps 1, yeux `+0xbd` (+6), nez `+0xbe` (+11), cheveux `+0xbc` (+1). Position `(244, 378)`. */
const PREVIEW_ORIGIN: Point = { x: 244, y: 378 };
/** `DS:1ad8` / `DS:1aee` : décalage de chaque image de `tBMP` 4300 (image 1 à 21) soustrait à la position. */
const PART_DX = [22, 25, 28, 19, 10, 29, 15, 7, 17, 24, 24, 7, 7, 7, 7, 7, 23, 24, 13, 15, 23] as const;
const PART_DY = [23, 30, 29, 27, 31, 30, 11, 11, 11, 9, 6, -2, -2, -2, -2, -2, -22, -22, -20, -21, -23] as const;

// ---------------------------------------------------------------------------------------------------------------------------
// Noms (`1168:1f84`)

/** `DS:14c8` : 31 paires voyelle (seconde lettre « espace » = une seule lettre), `DS:14e0` : 40 paires de consonnes, `DS:14d0` : 32 consonnes seules, `DS:14d8` : 6 finales. */
const VOWEL_PAIRS = ["a ", "a ", "a ", "e ", "e ", "e ", "e ", "i ", "i ", "i ", "o ", "o ", "o ", "u ", "u ", "y ", "ee", "oo", "yo", "ya", "ye", "ei", "ie", "ai", "ia", "au", "ua", "uo", "ou", "ae", "ea"] as const;
const CONSONANT_PAIRS = ["bl", "br", "ch", "cl", "cr", "dr", "dw", "fl", "fr", "gh", "gl", "gr", "kl", "kn", "kr", "kw", "ld", "mp", "nd", "nh", "nn", "ph", "pl", "pr", "qu", "qu", "rh", "rn", "sc", "sl", "sm", "sn", "sp", "sr", "st", "sw", "th", "tr", "tw", "wr"] as const;
const SINGLE_CONSONANTS = "bbccdddfghjkkllmmnnprrssssttvwxz";
const ENDING_VOWELS = "aeiouy";

/** Un tirage `10a8:04e8(max, min)` = `range(min, max)`. */
interface Random {
  range(lo: number, hi: number): number;
}

/**
 * `1168:1f84(10, nom)` : nom de 4 à 8 lettres. Alterne des voyelles et des consonnes (le départ est une voyelle 4 fois sur 10) ; une consonne en tête peut
 * être seule (2 fois sur 3 pour les deux premières lettres) ; si la dernière syllabe est une paire de consonnes, sa dernière lettre devient une voyelle ;
 * une même lettre doublée en tête revient à une seule.
 */
export function generateName(rng: Random): string {
  const buffer: string[] = new Array<string>(STATE_BYTES).fill("");
  const target = rng.range(4, STATE_BYTES - 2);
  let at = 0;
  let vowelNext = rng.range(1, 100) < 40;
  while (at < target) {
    let endsInPair = false;
    let letter: string;
    if (vowelNext) {
      vowelNext = false;
      const pair = VOWEL_PAIRS[rng.range(1, 31) - 1]!;
      letter = pair[0]!;
      if (pair[1] !== " ") {
        buffer[at++] = letter;
        letter = pair[1]!;
      }
    } else {
      vowelNext = true;
      if (at <= 1 && rng.range(1, 100) > 0x21) {
        letter = SINGLE_CONSONANTS[rng.range(1, 32) - 1]!;
      } else {
        const pair = CONSONANT_PAIRS[rng.range(1, 40) - 1]!;
        letter = pair[0]!;
        buffer[at++] = letter;
        letter = pair[1]!;
        endsInPair = true;
      }
    }
    buffer[at++] = letter;
    if (endsInPair && at >= target) buffer[at - 1] = ENDING_VOWELS[rng.range(1, 6) - 1]!;
    if (at === 2 && buffer[1] === buffer[0]) at = 1;
  }
  return buffer.join("");
}

/** Nom d'une fiche (les 10 octets d'état, terminés par un zéro). */
export function nameOf(state: Uint8Array): string {
  let name = "";
  for (const byte of state) {
    if (byte === 0) break;
    name += String.fromCharCode(byte);
  }
  return name;
}

function stateOf(name: string): Uint8Array {
  const state = new Uint8Array(STATE_BYTES);
  for (let i = 0; i < Math.min(name.length, STATE_BYTES - 1); i++) state[i] = name.charCodeAt(i);
  return state;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Écran

/** Un Zoombini du groupe sur sa place : la fiche, et son personnage à l'écran (absent tant que sa sortie de la grotte n'est pas lancée). */
interface Occupant {
  zoombini: Zoombini;
  snoid: Snoid | null;
  /** Marche de la grotte à la place ou d'une place à l'autre : le Zoombini n'est pas cliquable. */
  walking: boolean;
}

/** Le départ en cours : le Zoombini qui embarque (s'il y en a un) et son arrivée. */
interface Departure {
  arrived: boolean;
  boarder: Snoid | null;
}

const contains = (box: Box, x: number, y: number): boolean => x >= box.x1 && x < box.x2 && y >= box.y1 && y < box.y2;

function attributeBox(index: number): Box {
  const row = Math.floor(index / VALUES);
  const column = index % VALUES;
  const x1 = ATTRIBUTE_ORIGIN.x + ATTRIBUTE_STEP.x * column;
  const y1 = ATTRIBUTE_ORIGIN.y + ATTRIBUTE_STEP.y * row;
  return { x1, y1, x2: x1 + ATTRIBUTE_SIZE.w, y2: y1 + ATTRIBUTE_SIZE.h };
}

/** Profondeur d'un Zoombini sur la place `slot` : devant le décor (0), les plus bas à l'écran devant. */
const depthOf = (y: number): number => 1 + y / 1000;

export function createPickerScene(): Scene {
  let archive: Archive;
  let map: PickerMap;
  let view: PickerView | undefined;

  return {
    async load(ctx: SceneContext) {
      archive = await ctx.resources.open(ARCHIVE);
      map = { nodes: node(archive, NODE_PATH_ID), paths: path(archive, NODE_PATH_ID) };
    },
    enter(ctx: SceneContext) {
      view = start(ctx, archive, map);
    },
    leave(ctx: SceneContext) {
      view?.leave(ctx);
      view = undefined;
    },
    tick() {
      view?.tick();
    },
    key(event) {
      return view?.key(event.code, event.ctrl, event.alt) ?? false;
    },
  };
}

type PickerMap = { nodes: ReturnType<typeof node>; paths: ReturnType<typeof path> };
type PickerView = ReturnType<typeof start>;

function start(ctx: SceneContext, archive: Archive, map: PickerMap) {
  const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
  const initial = zoombinis.game;
  const { session } = zoombinis;
  const features: Features = ctx.services.get(FEATURES);
  const sound = ctx.services.get(ZOOMBINIS_SOUND);
  const text = ctx.services.get(ZOOMBINIS_TEXT);
  const attributeImages = archive.tbmpImages(ATTRIBUTES_SHEET);
  const buttonImages = archive.tbmpImages(BUTTONS_SHEET);
  const partImages = archive.tbmpImages(PARTS_SHEET);

  openScreen(ctx, archive, { background: BACKGROUND });
  features.defineGroup(0, SHEET);
  features.setScripts(ARCH, SCRIPTS);

  // --- État (`1128:0000`) ---
  /** `DS:8c7c…8c7f` : valeur choisie (1 à 5, 0 = aucune) de chaque attribut. */
  const selection: number[] = [0, 0, 0, 0];
  /** `DS:8cb9` : nom du prochain Zoombini. */
  let name = generateName(ctx.rng);
  /** `DS:8cf2` : phrase d'accueil ou d'aide en cours, coupée au prochain clic. */
  let speaking = 0;
  /** Zoombinis qui sortent de la grotte (`DS:9702` hors départ) : tant qu'il y en a, aucun ne peut être retiré. */
  let creating = 0;
  let pressed: { action: number; until: number } | null = null;
  let shiftFill = false;
  let departure: Departure | null = null;
  let left = false;
  const slots: (Occupant | null)[] = new Array<Occupant | null>(SLOTS.length).fill(null);
  const pending: { tick: number; occupant: Occupant; slot: () => number }[] = [];
  let mascotA: Feature | undefined;
  let mascotB: Feature | undefined;

  // --- Décor (`1128:006d`) ---
  WAVES.forEach((script, i) => features.create({ script, delay: 10 + i, flags: FeatureFlag.active }));
  if (!initial.options.lessAction) createMascots();
  features.create({ script: ARCH, delay: 0, flags: ARCH_FLAGS });
  features.create({ script: ARCH_DETAIL, delay: 6, flags: DETAIL_FLAGS });
  for (const script of ROCKS) features.create({ script, delay: 0, flags: 0 });
  features.create({ script: 0, delay: 0, depth: BUTTON_LAYER_DEPTH, flags: BUTTON_LAYER_FLAGS, onAfterDraw: (_feature, screen) => paint(screen) });

  // --- Groupe repris (`1128:006d` : réserve `S+0xA1FC`) ---
  pickerEnter(initial);
  const party = (): Zoombini[] => zoombinis.game.group.members;
  party().forEach((zoombini, slot) => {
    const occupant: Occupant = { zoombini, snoid: null, walking: false };
    slots[slot] = occupant;
    occupant.snoid = createSnoid(ctx, zoombini, { position: SLOTS[slot]!, depth: depthOf(SLOTS[slot]!.y) });
  });
  if (initial.options.lessAction) initial.mascots = 1;
  applyMascots();

  sound.queue(MUSIC);
  announce();
  session.resuming = false;
  features.invalidate();
  ctx.requestPresent();

  // ------------------------------------------------------------------------------------------------------------------------
  // Décor animé

  function createMascots(): void {
    mascotA ??= features.create({ script: MASCOT_A, delay: 7, depth: 0.01, flags: FeatureFlag.region | FeatureFlag.noDraw | FeatureFlag.active });
    mascotB ??= features.create({ script: MASCOT_B, delay: 9, depth: 0.01, flags: FeatureFlag.region | FeatureFlag.active });
  }

  /** `1128:17b9` : l'état `S+0x26` dit quels décors jouent (0 : les deux, 1 : aucun, 2 : le premier, 3 : le second). */
  function applyMascots(): void {
    if (!mascotA || !mascotB) return;
    const state = zoombinis.game.mascots;
    mascotA.active = state === 0 || state === 2;
    mascotB.active = state === 0 || state === 3;
    features.invalidate();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Phrase d'accueil (`1128:006d`, fin)

  function announce(): void {
    const game = zoombinis.game;
    let id = 0;
    if (session.previous === ScreenId.map) {
      // Retour de la carte : une phrase rare (1 chance sur 20 chacune) s'il reste des Zoombinis à créer.
      if (remainingToCreate(game) > 0 && party().length < ZOOMBINI_TYPES) {
        const roll = ctx.rng.range(1, 20);
        if (roll === 1) id = HINT_A;
        else if (roll === 10) id = HINT_B;
      }
    } else {
      // `1168:5c57` : compteur de visites de l'écran (mémoire de dialogue 0, 12 bits) ; le résultat n'est pas lu par l'écran.
      if (session.training === 0 && (game.dialogMemory[0]! & 0xfff) < 0xfff) game.dialogMemory[0] = game.dialogMemory[0]! + 1;
      if (game.counters.created < ZOOMBINI_TYPES && (session.previous === ScreenId.logo || session.previous === ScreenId.logoAlias)) id = WELCOME;
    }
    if (id !== 0) {
      speaking = id;
      sound.queue(id);
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Dessin des boutons (`1128:0eaf`, `1128:1122`, `1128:1302`)

  const complete = (): boolean => groupComplete(zoombinis.game);
  const available = (): boolean => isAvailable(zoombinis.game, selection);
  const created = (): number => zoombinis.game.counters.created;

  function blit(screen: Surface, images: readonly Shape[], index: number, x: number, y: number): void {
    const image = images[index - 1];
    if (image) drawShape(screen, image, x, y, 8);
  }

  function paint(screen: Surface): void {
    const done = complete();
    const ready = available();
    const canAdd = created() < ZOOMBINI_TYPES && !done && ready;
    // Boutons d'attributs : l'image « enfoncée » marque la valeur choisie.
    for (let index = 0; index < ATTRIBUTES * VALUES; index++) {
      const box = attributeBox(index);
      const chosen = selection[Math.floor(index / VALUES)] === (index % VALUES) + 1;
      blit(screen, attributeImages, index * 2 + (chosen ? 2 : 1), box.x1, box.y1);
    }
    const isPressed = (action: number): boolean => pressed?.action === action;
    // Ajouter.
    const add = ACTION_BOXES[Action.add]!;
    blit(screen, buttonImages, canAdd ? (isPressed(Action.add) ? ADD_IMAGES.pressed : ADD_IMAGES.ready) : ADD_IMAGES.disabled, add.x1, add.y1);
    // Le Zoombini en cours de composition.
    const parts = [selection[3] ? selection[3] + 16 : 0, 1, selection[1] ? selection[1] + 6 : 0, selection[2] ? selection[2] + 11 : 0, selection[0] ? selection[0] + 1 : 0];
    for (const part of parts) {
      if (part !== 0) blit(screen, partImages, part, PREVIEW_ORIGIN.x - PART_DX[part - 1]!, PREVIEW_ORIGIN.y - PART_DY[part - 1]!);
    }
    // La plaque et le nom, seulement quand le type est disponible.
    const plate = ACTION_BOXES[Action.name]!;
    blit(screen, buttonImages, PLATE_IMAGE, plate.x1, plate.y1);
    if (ready && name !== "") {
      text.drawText(screen, "small", name, { x: plate.x1 + 4, y: plate.y1 + 1, w: plate.x2 - plate.x1 - 4, h: plate.y2 - plate.y1 - 1 }, TextFlags.center | TextFlags.vcenter, INK);
    }
    // Au hasard (jaune avec `Maj` : remplit le groupe).
    const random = ACTION_BOXES[Action.random]!;
    const fill = !done && shiftFill;
    const dice = fill ? (isPressed(Action.random) ? RANDOM_IMAGES.fillPressed : RANDOM_IMAGES.fill) : isPressed(Action.random) ? RANDOM_IMAGES.pressed : RANDOM_IMAGES.ready;
    blit(screen, buttonImages, dice, random.x1, random.y1);
    // Carte et départ.
    const mapBox = ACTION_BOXES[Action.map]!;
    blit(screen, buttonImages, isPressed(Action.map) ? MAP_IMAGES.pressed : MAP_IMAGES.ready, mapBox.x1, mapBox.y1);
    const go = ACTION_BOXES[Action.go]!;
    blit(screen, buttonImages, done ? (isPressed(Action.go) ? GO_IMAGES.pressed : GO_IMAGES.ready) : GO_IMAGES.disabled, go.x1, go.y1);
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Les places du groupe (`1128:187e`)

  function firstFreeSlot(): number {
    return slots.findIndex((occupant) => occupant === null);
  }

  /** Crée le personnage d'un Zoombini : il sort de la grotte et marche jusqu'à sa place (`1168:0755`, état 7). */
  function spawn(occupant: Occupant, slot: () => number): void {
    const snoid = createSnoid(ctx, occupant.zoombini, {
      position: CAVE,
      depth: depthOf(SLOTS[slot()]!.y),
      onArrive: () => {
        occupant.walking = false;
        creating = Math.max(0, creating - 1);
      },
    });
    occupant.snoid = snoid;
    snoid.walkTo(SLOTS[slot()]!, map);
  }

  /** Après un retrait : chaque place libre est prise par le premier Zoombini présent derrière elle dans la rangée, qui marche jusqu'à elle. */
  function compact(): void {
    for (let slot = 0; slot < PULL.length; slot++) {
      if (slots[slot]) continue;
      for (const offset of PULL[slot]!) {
        const occupant = slots[slot + offset];
        if (!occupant) continue;
        slots[slot] = occupant;
        slots[slot + offset] = null;
        if (occupant.snoid) {
          occupant.walking = true;
          occupant.snoid.onArrive = () => {
            occupant.walking = false;
          };
          occupant.snoid.walkTo(SLOTS[slot]!);
        }
        break;
      }
    }
  }

  const slotOf = (occupant: Occupant): number => slots.indexOf(occupant);

  // ------------------------------------------------------------------------------------------------------------------------
  // Clics

  function stopSpeaking(): void {
    if (speaking !== 0) {
      sound.stopEffects();
      speaking = 0;
    }
  }

  function press(action: number): void {
    pressed = { action, until: ctx.clock.ticks + PRESS_TICKS };
    features.invalidate();
  }

  /** `1128:061a` : un bouton d'attribut bascule sa valeur (la même valeur la retire). */
  function clickAttribute(index: number): void {
    stopSpeaking();
    const row = Math.floor(index / VALUES);
    const value = (index % VALUES) + 1;
    if (selection[row] === value) {
      sound.queue(SOUND_REFUSED);
      selection[row] = 0;
    } else {
      sound.queue(SOUND_SELECT);
      selection[row] = value;
    }
    features.invalidate();
  }

  /** Crée un Zoombini avec la sélection et le nom courants sur la première place libre (cas 1 de `1128:079c`) ; `start` : tick de sa sortie de la grotte. */
  function addOne(start: number): boolean {
    const game = zoombinis.game;
    const added = addZoombini(game, selection, ctx.rng);
    if (!added) return false;
    added.zoombini.state.set(stateOf(name));
    const slot = firstFreeSlot();
    const occupant: Occupant = { zoombini: added.zoombini, snoid: null, walking: true };
    slots[slot] = occupant;
    creating += 1;
    if (start <= ctx.clock.ticks) spawn(occupant, () => slotOf(occupant));
    else pending.push({ tick: start, occupant, slot: () => slotOf(occupant) });
    return true;
  }

  function clickAdd(): void {
    press(Action.add);
    if (complete() || !available() || created() >= ZOOMBINI_TYPES) return;
    sound.queue(SOUND_ADD);
    addOne(ctx.clock.ticks);
    name = generateName(ctx.rng);
    features.invalidate();
  }

  function clickGuide(): void {
    const code = ctx.rng.range(0, 12);
    sound.queue(snoidVoiceId(code, { hair: selection[0]!, nose: selection[2]! }, (lo, hi) => ctx.rng.range(lo, hi)));
  }

  function clickName(): void {
    if (!available()) return;
    sound.queue(SOUND_SELECT);
    name = generateName(ctx.rng);
    features.invalidate();
  }

  /** Cas 4 : un type au hasard ; avec `Maj` tenue, tous les Zoombinis qui manquent au groupe, sortant de la grotte à intervalles de 1 à 3 secondes. */
  function clickRandom(shift: boolean): void {
    const game = zoombinis.game;
    if (created() >= ZOOMBINI_TYPES) {
      sound.queue(SOUND_REFUSED);
      return;
    }
    sound.queue(SOUND_RANDOM);
    press(Action.random);
    if (!complete() && shift) {
      const gap = initial.options.lessAction ? FILL_GAP.less : FILL_GAP.normal;
      let start = ctx.clock.ticks;
      let pick = pickRandomType(game, ctx.rng, selection, true);
      selection.splice(0, 4, ...pick.attrs);
      name = generateName(ctx.rng);
      while (!complete() && pick.available) {
        if (!addOne(start)) break;
        start += ctx.rng.range(gap[0], gap[1]);
        pick = pickRandomType(game, ctx.rng, selection, true);
        selection.splice(0, 4, ...pick.attrs);
        name = generateName(ctx.rng);
      }
    } else {
      const pick = pickRandomType(game, ctx.rng, selection, available());
      selection.splice(0, 4, ...pick.attrs);
      if (pick.rerolled) name = generateName(ctx.rng);
    }
    features.invalidate();
  }

  /** Sortie de l'écran (`1128:049a`) : le groupe est rangé, puis l'écran demandé est ouvert. */
  function exit(screen: number, toMap: boolean): void {
    if (left) return;
    left = true;
    pickerLeave(zoombinis.game, session, party(), toMap);
    zoombinis.goTo(ctx, screen);
  }

  function clickMap(): void {
    sound.queue(SOUND_MAP);
    press(Action.map);
    exit(ScreenId.map, true);
  }

  /** Cas 6 : refusé tant que le groupe est incomplet (phrase d'aide s'il reste des Zoombinis à créer) ; sinon le premier Zoombini des places 11, 12, 6, 7 embarque. */
  function clickGo(): void {
    if (!complete()) {
      if (remainingToCreate(zoombinis.game) > 0 && party().length < ZOOMBINI_TYPES) {
        const roll = ctx.rng.range(1, 2);
        const id = roll === 1 ? HINT_A : roll === 2 ? HINT_B : 0;
        if (id !== 0) {
          speaking = id;
          sound.queue(id);
        }
      }
      return;
    }
    sound.queue(SOUND_GO);
    press(Action.go);
    let boarder: Snoid | null = null;
    for (const slot of DEPARTURE_SLOTS) {
      const occupant = slots[slot];
      if (occupant?.snoid && !occupant.walking) {
        boarder = occupant.snoid;
        break;
      }
    }
    departure = { arrived: boarder === null, boarder };
    if (boarder) {
      const current = departure;
      boarder.onArrive = () => {
        current.arrived = true;
      };
      boarder.walkTo(BOARDING, map);
    }
  }

  /** Cas 7 : un Zoombini du groupe est retiré ; ses valeurs et son nom reviennent dans les boutons. */
  function clickZoombini(occupant: Occupant): void {
    const game = zoombinis.game;
    const index = game.group.members.indexOf(occupant.zoombini);
    const removed = removeZoombini(game, index);
    if (!removed) return;
    slots[slotOf(occupant)] = null;
    occupant.snoid?.destroy();
    selection.splice(0, 4, ...removed.attrs);
    name = nameOf(removed.state);
    sound.queue(SOUND_REMOVE);
    compact();
    features.invalidate();
  }

  /** Le Zoombini sous la souris : le plus en avant, s'il est immobile. */
  function zoombiniAt(x: number, y: number): Occupant | null {
    let found: Occupant | null = null;
    for (const occupant of slots) {
      const rect = occupant?.snoid?.feature.rect;
      if (!occupant || !rect || occupant.walking) continue;
      if (x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) {
        if (!found || (occupant.snoid?.depth ?? 0) >= (found.snoid?.depth ?? 0)) found = occupant;
      }
    }
    return found;
  }

  function click(x: number, y: number, shift: boolean): void {
    // `1128:076c` : une demande de départ en attente est exécutée par le clic suivant.
    if (departure) {
      finishDeparture();
      return;
    }
    for (let index = 0; index < ATTRIBUTES * VALUES; index++) {
      if (contains(attributeBox(index), x, y)) {
        clickAttribute(index);
        return;
      }
    }
    for (const [key, box] of Object.entries(ACTION_BOXES)) {
      if (!contains(box, x, y)) continue;
      stopSpeaking();
      switch (Number(key)) {
        case Action.add:
          clickAdd();
          break;
        case Action.guide:
          clickGuide();
          break;
        case Action.name:
          clickName();
          break;
        case Action.random:
          clickRandom(shift);
          break;
        case Action.map:
          clickMap();
          break;
        case Action.go:
          clickGo();
          break;
      }
      return;
    }
    if (creating === 0) {
      const occupant = zoombiniAt(x, y);
      if (occupant) {
        stopSpeaking();
        clickZoombini(occupant);
      }
    }
  }

  function finishDeparture(): void {
    departure = null;
    exit(ScreenId.bridge, false);
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Tick (`1128:0566`) et touches (`1128:05dc`)

  return {
    tick(): void {
      const now = ctx.clock.ticks;
      // Bouton d'action enfoncé : 2 ticks.
      if (pressed && now >= pressed.until) {
        pressed = null;
        features.invalidate();
      }
      // `1128:159d` : avec `Maj` tenue, « au hasard » prend son aspect jaune.
      const fill = ctx.input.shift && created() < ZOOMBINI_TYPES;
      if (fill !== shiftFill) {
        shiftFill = fill;
        features.invalidate();
      }
      // Sorties de la grotte différées (remplissage).
      for (let i = pending.length - 1; i >= 0; i--) {
        const entry = pending[i]!;
        if (entry.tick > now) continue;
        pending.splice(i, 1);
        if (slotOf(entry.occupant) >= 0) spawn(entry.occupant, entry.slot);
      }
      if (left) return;
      for (const event of ctx.input.buttonEvents) {
        if (left) return;
        if (event.down && event.button === "left") click(event.x, event.y, event.shift);
      }
      // Départ : une fois le son de départ fini et le Zoombini arrivé sur le bateau.
      if (departure && !left && departure.arrived && sound.pending.effects === 0 && sound.effectsPlaying === 0) finishDeparture();
    },
    key(code: string, ctrl: boolean, alt: boolean): boolean {
      if (!ctrl || alt || code !== "KeyW") return false;
      // `Ctrl+W` (0x17) : fait avancer l'état des décors ; avec « moins d'action » ils sont créés à cette occasion.
      if (zoombinis.game.options.lessAction) createMascots();
      if (mascotA && mascotB) {
        zoombinis.game.mascots = (zoombinis.game.mascots + 1) % 4;
        applyMascots();
      }
      return true;
    },
    leave(leaveCtx: SceneContext): void {
      // Sortie par un autre chemin (partie chargée, nouvelle partie) : une partie remplacée ne reçoit pas le groupe de l'ancienne.
      if (!left && zoombinis.game === initial) pickerLeave(zoombinis.game, session, party(), false);
      left = true;
      closeScreen(leaveCtx);
    },
  };
}
