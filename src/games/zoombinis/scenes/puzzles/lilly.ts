/**
 * Têtards tatoués (`LILLY.MHK`, écran 11 ; vague H, tâche H5) : écran de l'épreuve. Règles dans `game/puzzles/lilly.ts`, étude dans `docs/zoombinis/puzzles/lilly.md`,
 * kit commun dans `scenes/puzzle-kit.ts`.
 *
 * Ce que l'écran porte (adresses de l'original entre parenthèses) :
 *  - fond / palette 5000, trois groupes de formes (11000 la fée, 14000 les avant-plans des berges, 10000 les crapauds, jetons, grenouilles et jauge, avec les ancres
 *    `REGS` 10000 / 10001), plages de `SCRB` 11000, 14000 à 14004 et 10000 à 10166 (`10f8:0000`) ;
 *  - l'étang de 12 × 12 nénuphars dessiné d'après l'état : image `B + 1` de `tBMP` 13000 puis le motif (`10f8:4f53`, `4d54`), halo des nénuphars choisis (`51c3`, `54b9`) ;
 *  - 12 crapauds sur la berge gauche (`SCRB 10043 + rangée`), tatoués d'après `DS:14b6` (image du tatouage = 79 + t, 67 + t, 91 + t, 103 + t selon le cap : `10f0:0ac1`) ;
 *  - la file de jetons des Zoombinis (`SCRB 10109 + i`, ceux de l'entrée du niveau 1 : `10089 + i`) : la variante du jeton est les cheveux − 1 (`10f8:3ea3`) ;
 *  - le glisser-déposer d'un crapaud sur un nénuphar de la première colonne (`10f8:6cdf`, `1b3a`) : la zone survolée est éclairée si le dépôt est valide ; le jeton marche
 *    jusqu'au crapaud (`10019 + rangée`, événement 26), le crapaud se tend (`10000`, événement 20) puis saute de nénuphar en nénuphar (`10001` à `10004`, événement 10 :
 *    prochain pas 30 ticks plus tard, `10f8:20bc`), arrive à la berge droite (`10031 + rangée`, événement 30 : `arrive`), le Zoombini y marche (`10129 + rangée`) ;
 *  - la sortie du crapaud : première traversée `10057`, scène de la berge (`10060` à `10065`), retour `10058` puis repos ; deuxième traversée `10059` puis le crapaud disparaît
 *    (un crapaud ne fait que deux traversées) ;
 *  - la fée (niveaux 2 à 4) : baguette-jauge `SCRB 10078 + g` qu'on prend et qui choisit deux nénuphars libres de l'étang, échange après une courte animation de halo, sons
 *    12000 à 12003 ; la fée de la berge `SCRB 11000` se pose à l'entrée ;
 *  - les grenouilles (niveaux 3 et 4) : création toutes les 480 ticks (la première à 600), sauts `10071` / `10077` / `10073` / `10075`, sortie `10069` ;
 *  - le verrou d'introduction (`DS:9702`), le bouton « suite » (actif dès la première arrivée), le bouton carte, l'enregistrement pendant l'épreuve, l'aide F1 (par le kit) ;
 *  - les voix : accueil 20075 à 20077, réussite complète 20055 à 20063, regret 20045 à 20048 (`10f8:7866`).
 *
 * Écarts et lectures « probables » : voir `docs/zoombinis/engine-ts.md`, « Têtards (tâche H5) ».
 */
import { drawShape } from "../../../../engine/mohawk/graphics/blit";
import type { Surface } from "../../../../engine/mohawk/graphics/surface";
import type { Archive } from "../../../../engine/mohawk/resources";
import type { Shape } from "../../../../data/mohawk/shap";
import type { Point } from "../../data/zoombini";
import { DIALOG } from "../../engine/dialog";
import { FEATURE_END, FEATURES, FeatureFlag, type Feature, type FeaturePart } from "../../engine/features";
import { ZOOMBINIS_GAME } from "../../engine/game";
import { regs } from "../../engine/resources";
import { ScreenId, type Scene, type SceneContext } from "../../engine/scene";
import { ZOOMBINIS_SOUND } from "../../engine/sound";
import {
  FAIRY_GAUGE,
  FROG_FIRST_TICKS,
  FROG_PERIOD_TICKS,
  FROG_STEP_TICKS,
  TOAD_STEP_TICKS,
  arrive,
  canDrop,
  canLeave,
  cellIndex,
  createLilly,
  drop,
  exchange,
  hasFairy,
  lilyOrigin,
  releaseLanding,
  settleFrog,
  settleToad,
  spawnFrog,
  stepFrog,
  stepToad,
  type Cell,
  type Frog,
  type LillyLevel,
  type LillyState,
  type LillyTemplates,
  type Toad,
} from "../../game/puzzles/lilly";
import { currentLevel, dialogMemoryIndex } from "../../game/route";
import type { Zoombini } from "../../game/state";
import { createPuzzleKit, sheetButtonImages, type ObjectCarrySpec, type PointerInfo, type PuzzleKit } from "../puzzle-kit";
import { closeScreen, openScreen } from "../screen-kit";
import { dialogChoice } from "../xfer";

// ---------------------------------------------------------------------------------------------------------------------------
// Constantes de l'original

const SCREEN = ScreenId.lilly;
/** Fond `tBMP` 640 × 480 et palette `SHPL` de même id. */
const BACKGROUND = 5000;
/** Planche des boutons : 1 « go » grisé, 2 « go », 3 « go » enfoncé, 5 carte, 6 carte enfoncée (`10f8:09e1`). */
const BUTTON_SHEET = 7000;
/** Planche des nénuphars (37 images : 1 à 4 les formes, 5 à 19 les motifs, 20 à 35 les halos) et ses ancres `REGS 200` / `201`. */
const LILY_SHEET = 13000;
const LILY_ANCHORS = { x: 200, y: 201 } as const;
/** Gabarits des chemins `REGS 15000` à `15002`. */
const TEMPLATES = [15000, 15001, 15002] as const;
/** Origine des 12 rangées : `REGS 100` (x) et `101` (y). */
const ROW_ORIGINS = { x: 100, y: 101 } as const;

/** Le bouton reste enfoncé 2 ticks (`1090:00c1(1, 0, 2, 0, 0)`). */
const PRESS_TICKS = 2;

/** Scripts (`SCRB`). */
const TOAD_REST = 10043;
const TOAD_STRETCH = 10000;
const TOAD_JUMP = 10001;
const TOAD_ARRIVAL = 10031;
const TOAD_EXIT_FIRST = 10057;
const TOAD_RETURN = 10058;
const TOAD_EXIT_SECOND = 10059;
const TOAD_SCENE = 10060;
const TOKEN_WALK = 10019;
const TOKEN_ENTRY = 10089;
const TOKEN_QUEUE = 10109;
const TOKEN_LANDING = 10129;
const FROG_ARRIVAL = 10067;
const FROG_EXIT = 10069;
/** Sauts des grenouilles par cap (haut, droite, bas, gauche) : `10f0:1207` (`274f + 8`, `+ 0xe`, `+ 10`, `+ 0xc`). */
const FROG_JUMPS = [10071, 10077, 10073, 10075] as const;
const GAUGE = 10078;
const FAIRY_FLIGHT = 11000;
const FOREGROUNDS = [14000, 14001, 14002, 14003, 14004] as const;

/** Positions de repos des crapauds sur la berge gauche (`DS2:23e8`). */
const REST_POSITIONS: readonly Point[] = [
  { x: 66, y: 118 },
  { x: 60, y: 147 },
  { x: 46, y: 177 },
  { x: 58, y: 205 },
  { x: 44, y: 232 },
  { x: 52, y: 262 },
  { x: 39, y: 289 },
  { x: 18, y: 313 },
  { x: 47, y: 327 },
  { x: 17, y: 345 },
  { x: 43, y: 363 },
  { x: 53, y: 393 },
];
/** Zones de dépôt (`DS2:241c`) : un rectangle (gauche, haut, droite, bas) par rangée, comparé au pointeur. */
const DROP_ZONES: readonly (readonly [number, number, number, number])[] = [
  [134, 65, 168, 93],
  [131, 94, 165, 122],
  [129, 122, 163, 150],
  [127, 152, 161, 180],
  [124, 181, 158, 209],
  [117, 210, 151, 238],
  [113, 239, 147, 267],
  [109, 268, 143, 296],
  [100, 297, 134, 331],
  [93, 326, 127, 354],
  [91, 355, 125, 383],
  [88, 384, 120, 532],
];
/** Repos de la baguette-jauge (`10f8:0000`, `10f8:6cdf`). */
const WAND_REST: Point = { x: 0x26, y: 0x19f };
/** Étang de la fée (`DS2:2498`, `24a0`, `24a8`) : rectangle et deux bords obliques (`10f8:6cdf`). */
const POND_RECT = { left: 83, top: 62, right: 556, bottom: 430 };
/** Point chaud de la baguette pour trouver un nénuphar (`+0x1b`, `+0x16`). */
const WAND_HOT: Point = { x: 0x1b, y: 0x16 };
/** Halo d'un nénuphar : image `HALO_BASE[B] + HALO_PHASE[cycle]` de la planche 13000 (`DS2:24b2`, `24c4`) ; le cycle change toutes les `HALO_TICKS`. */
const HALO_BASE: readonly number[] = [20, 22, 24, 26];
const HALO_PHASE: readonly number[] = [0, 0, 1, 1];
const HALO_TICKS = 10;
/** Animation de l'échange : 5 battements (`DS:82dc`), `EXCHANGE_BEAT` ticks chacun. */
const EXCHANGE_BEATS = 5;
const EXCHANGE_BEAT = 6;
/** Sons du choix d'un nénuphar : `12000 + (compteur mod 4)`. */
const SOUND_PICK = 12000;
/** Voix d'accueil : 20075 au niveau 1, sinon 20075 à 20077 (20076 ou 20077 à la première visite du niveau 2). */
const WELCOME_FIRST = 20075;
const WELCOME_LAST = 20077;
/** Voix de regret (`10f8:7866`). */
const REGRET_FIRST = 20045;
const REGRET_LAST = 20048;
/** Une seule exécution du délai entre images : 6 ticks (décor), 7 (crapauds, `rand(3, 6)` en réalité), 8 (grenouilles : `rand(4, 7)`). */
const FRAME_DELAY = 6;

/** Profondeurs (les crapauds sont à `0.3 + rangée / 100`, celui qu'on tient à `CARRY_DEPTH` du kit). */
const DEPTH_POND = 0.1;
const DEPTH_TOAD = 0.3;
const DEPTH_FROG = 0.5;
const DEPTH_TOKEN = 0.6;
const DEPTH_FAIRY = 0.65;
const DEPTH_FOREGROUND = 0.9;
const DEPTH_BUTTONS = 0.95;

/** Drapeaux de création : première image seule, position relative ; lecture complète ensuite par `setScript`. */
const STATIC_FLAGS = FeatureFlag.relative | FeatureFlag.stopAtEnd | FeatureFlag.noReplay | FeatureFlag.firstImage;

/** Premier tatouage de chaque caractéristique (A, B, C) dans `TATTOOS`. */
const KIND_BASE: Readonly<Record<number, number>> = { 1: 0, 2: 3, 3: 7 };

/** Numéro du tatouage `(kind, value)` (image `272 + t`). */
function tattooOf(kind: number, value: number): number {
  return (KIND_BASE[kind] ?? 0) + value;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Modèle de l'écran

type ToadPhase =
  /** Au repos sur la berge gauche, saisissable. */
  | "rest"
  /** Déposé : le jeton marche vers lui, puis il se tend. */
  | "setup"
  /** Prêt à sauter : il attend son tour. */
  | "ready"
  | "hop"
  /** Il saute vers la berge droite (`10031 + rangée`). */
  | "arriving"
  /** Sortie, scène de berge, retour. */
  | "leaving"
  /** Sorti pour de bon (deuxième traversée). */
  | "gone";

interface ToadView {
  toad: Toad;
  feature: Feature;
  phase: ToadPhase;
  /** Prochain pas permis (ticks). */
  nextAt: number;
  /** Variante du Zoombini porté (cheveux − 1). */
  rider: number;
  /** Sortie en attente de son tour (un seul crapaud à la fois par file de sortie). */
  waitingExit: boolean;
}

interface TokenView {
  index: number;
  feature: Feature | null;
  variant: number;
}

interface FrogView {
  frog: Frog;
  feature: Feature;
  phase: "arriving" | "ready" | "hop" | "exit";
  nextAt: number;
}

/** Ce que l'écran laisse voir à l'extérieur (tests, outils de développement). Rempli à l'entrée. */
export interface LillyProbe {
  kit: PuzzleKit;
  state: LillyState;
  /** Zoombinis du groupe de la scène (même ordre que les jetons). */
  party: Zoombini[];
  toads: ToadView[];
  frogs: FrogView[];
  tokens: TokenView[];
  /** Baguette-jauge (niveaux 2 à 4). */
  wand: Feature | null;
  /** Origine d'un nénuphar à l'écran. */
  origin(col: number, row: number): Point;
  /** Verrou d'introduction (`DS:9702`). */
  readonly lock: number;
  readonly carrying: "toad" | "fairy" | null;
  /** Échange en cours (`DS:82ec`). */
  readonly exchanging: boolean;
  /** Nénuphars déjà choisis par la fée (`DS:82e4` : 4 aucun, 5 un, 6 deux). */
  readonly picks: readonly Cell[];
  readonly leaving: boolean;
  /** Nénuphar de la première colonne éclairé par le survol d'un dépôt valide. */
  readonly haloRow: number | null;
  /** Voix d'accueil jouée à l'entrée. */
  readonly welcome: number;
  /** Premier pas d'un crapaud (ticks) : instants du début de chaque saut. */
  readonly hops: readonly { toad: number; at: number }[];
}

/** Scène des têtards tatoués. `probe` (facultatif) reçoit l'état interne à chaque entrée. */
export function createLillyScene(probe?: (probe: LillyProbe) => void): Scene {
  let archive: Archive;
  let running: Running | null = null;

  return {
    async load(ctx: SceneContext) {
      archive = await ctx.resources.open("LILLY.MHK");
    },
    enter(ctx: SceneContext) {
      running = start(ctx, archive, probe);
    },
    leave(ctx: SceneContext) {
      running?.stop();
      running = null;
      closeScreen(ctx);
    },
    tick() {
      running?.tick();
    },
    key(event, ctx: SceneContext) {
      const kit = running?.kit;
      if (!running || !kit || kit.left) return false;
      if (event.ctrl || event.alt) return false;
      if (ctx.services.tryGet(DIALOG)?.isOpen) return false;
      return kit.key(event);
    },
  };
}

interface Running {
  kit: PuzzleKit;
  tick(): void;
  stop(): void;
}

function inRect(x: number, y: number, rect: readonly [number, number, number, number]): boolean {
  return x >= rect[0] && x < rect[2] && y >= rect[1] && y < rect[3];
}

function start(ctx: SceneContext, archive: Archive, probe?: (probe: LillyProbe) => void): Running {
  const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
  const { game, session } = zoombinis;
  const features = ctx.services.get(FEATURES);
  const sound = ctx.services.get(ZOOMBINIS_SOUND);
  const { rng } = ctx;
  session.screen = SCREEN;
  const level = currentLevel(game, session, SCREEN) as LillyLevel;

  // --- Décor, groupes de formes, scripts (`10f8:0000`) ---
  openScreen(ctx, archive, { background: BACKGROUND });
  features.defineGroup(0, FAIRY_FLIGHT);
  features.defineGroup(1, FOREGROUNDS[0]);
  features.defineGroup(2, 10000, true);
  features.setScripts(FAIRY_FLIGHT, 1);
  features.addScripts(FOREGROUNDS[0], 5);
  features.addScripts(10000, 167);
  const buttons = sheetButtonImages(archive.tbmpImages(BUTTON_SHEET));
  const lilySheet: readonly Shape[] = archive.tbmpImages(LILY_SHEET);
  const lilyAnchorX = regs(archive, LILY_ANCHORS.x);
  const lilyAnchorY = regs(archive, LILY_ANCHORS.y);
  const rowX = regs(archive, ROW_ORIGINS.x);
  const rowY = regs(archive, ROW_ORIGINS.y);
  const origin = (col: number, row: number): Point => lilyOrigin(col, row, rowX, rowY);

  // Groupe de la scène : copie des présents du tampon (le kit ne crée que ceux-là).
  const party: Zoombini[] = game.group.members
    .filter((z) => z.present)
    .map((z) => ({ ...z, attrs: [...z.attrs] as Zoombini["attrs"], state: z.state.slice() }));
  const templates = TEMPLATES.map((id) => regs(archive, id)) as unknown as LillyTemplates;
  const state = createLilly(rng, level, party.length, templates);

  // --- Variables de l'écran (`DS:xxxx`) ---
  /** `9702` : verrou d'introduction, tant qu'il est positif seule la fée se prend. */
  let lock = party.length > 0 ? 1 : 0;
  /** `82ec` : échange en cours, tout est figé. */
  let exchanging = false;
  /** Sortie demandée (`8556`). */
  let leaving = false;
  /** Nénuphars choisis par la fée (au plus deux) et animation de l'échange. */
  const picks: Cell[] = [];
  let exchangeBeat = -1;
  let exchangeAt = 0;
  /** `14f2` : cycle des sons de choix. */
  let pickSound = 0;
  let haloRow: number | null = null;
  /** Objet tenu (transport porté par le kit : `kit.carryObject`) : un crapaud ou la baguette. */
  let carrying: "toad" | "fairy" | null = null;
  let turn = 0;
  let nextFrogAt = ctx.clock.ticks + FROG_FIRST_TICKS;
  let regretDone = false;
  const startedAt = ctx.clock.ticks;
  const hops: { toad: number; at: number }[] = [];
  /** Files de sortie : un seul crapaud à la fois jouant `10057` (première traversée) et `10059` (deuxième) (`DS:7c6e`, `7c70`). */
  const exitBusy = { first: false, second: false };

  // --- Voix d'accueil (`DS:a2c4`) ---
  const slot = dialogMemoryIndex(SCREEN);
  const choice = dialogChoice(game.dialogMemory[slot]!, level, session.training !== 0);
  game.dialogMemory[slot] = choice.memory;
  const visits = choice.memory & 0xfff;
  const welcome = choice.choice === 2 ? rng.range(WELCOME_FIRST + 1, WELCOME_LAST) : level === 0 ? WELCOME_FIRST : rng.range(WELCOME_FIRST, WELCOME_LAST);

  // --- Étang ---
  const drawLily = (screen: Surface, col: number, row: number, halo: boolean): void => {
    const lily = state.pond.cells[cellIndex(col, row)]!;
    const { x, y } = origin(col, row);
    const form = lily.attrs[1] + 1;
    const image = halo ? HALO_BASE[lily.attrs[1]]! + HALO_PHASE[Math.floor(ctx.clock.ticks / HALO_TICKS) % 4]! : form;
    const draw = (id: number): void => {
      const shape = lilySheet[id - 1];
      if (shape) drawShape(screen, shape, x - (lilyAnchorX[id] ?? 0), y - (lilyAnchorY[id] ?? 0), 8);
    };
    draw(image);
    if (lily.motif > 0 && lily.motif < 0x24) draw(lily.motif);
  };
  const isHalo = (col: number, row: number): boolean => (col === 0 && row === haloRow) || picks.some((c) => c.col === col && c.row === row);
  features.create({
    script: 0,
    delay: 0,
    depth: DEPTH_POND,
    flags: 0,
    onAfterDraw: (_feature, screen) => {
      for (let row = 0; row < 12; row++) for (let col = 0; col < 12; col++) drawLily(screen, col, row, isHalo(col, row));
    },
  });
  /** Les halos battent : l'étang est redessiné à chaque changement de phase. */
  let lastHaloPhase = -1;
  const haloShown = (): boolean => haloRow !== null || picks.length > 0;

  // --- Avant-plans des berges (`SCRB 14000` à `14004`) ---
  for (const script of FOREGROUNDS) {
    features.create({ script, delay: FRAME_DELAY, depth: DEPTH_FOREGROUND, flags: FeatureFlag.still | FeatureFlag.firstImage });
  }

  // --- Crapauds (`10f8:484e`) ---
  const toadViews: ToadView[] = [];
  const isRiderScript = (id: number): boolean => (id >= TOAD_STRETCH && id <= TOAD_STRETCH + 16) || (id >= TOAD_ARRIVAL && id < TOAD_ARRIVAL + 12);
  for (const toad of state.toads) {
    const view: ToadView = { toad, feature: undefined as unknown as Feature, phase: "rest", nextAt: 0, rider: 0, waitingExit: false };
    view.feature = features.create({
      script: TOAD_REST + toad.index,
      delay: toad.frameDelay,
      depth: DEPTH_TOAD + toad.index / 100,
      position: REST_POSITIONS[toad.index],
      flags: STATIC_FLAGS,
      // `10f0:0ac1` : le tatouage est la deuxième case (famille de cap + t), le Zoombini porté la troisième (+ cheveux − 1).
      onImage: (feature, parts: FeaturePart[]) => {
        const tattoo = parts[1];
        if (tattoo && tattoo.w >= 67 && tattoo.w <= 114) tattoo.w += toad.tattoo;
        const rider = parts[2];
        if (rider && isRiderScript(feature.scriptId)) rider.w += view.rider;
        return parts;
      },
    });
    toadViews.push(view);
  }

  // --- Jetons des Zoombinis (`10f8:0000`, `10f8:3ea3`) ---
  const tokens: TokenView[] = party.map((z, index) => ({ index, feature: null, variant: Math.max(0, z.attrs[0] - 1) }));
  const introTokens = level === 0 ? tokens.slice(-2) : [];
  for (const token of tokens) {
    const intro = introTokens.includes(token);
    token.feature = features.create({
      script: (intro ? TOKEN_ENTRY : TOKEN_QUEUE) + token.index,
      delay: FRAME_DELAY,
      depth: DEPTH_TOKEN,
      flags: FeatureFlag.stopAtEnd | FeatureFlag.noReplay | FeatureFlag.firstImage,
      onImage: (_feature, parts: FeaturePart[]) => {
        if (parts[0]) parts[0].w += token.variant;
        return parts;
      },
    });
    if (intro) {
      // L'entrée des deux derniers jetons ferme l'introduction : l'événement 1 de leur script retire un du verrou.
      const feature = token.feature;
      feature.onEvent = (_image, n) => {
        if (n === 1) releaseLock();
      };
      features.setScript(feature, TOKEN_ENTRY + token.index);
    }
  }

  // --- La baguette et la fée (niveaux 2 à 4) ---
  let wand: Feature | null = null;
  if (hasFairy(state)) {
    wand = features.create({
      script: GAUGE + state.fairy.gauge,
      delay: FRAME_DELAY,
      depth: DEPTH_FAIRY,
      position: WAND_REST,
      flags: STATIC_FLAGS,
    });
    wand.onEvent = (_image, n) => {
      if (n === 1) releaseLock();
    };
    // `10078` : son événement 1 lève le verrou d'introduction aux niveaux 2 à 4.
    features.setScript(wand, GAUGE + state.fairy.gauge);
    const flight = features.create({ script: FAIRY_FLIGHT, delay: 5, depth: DEPTH_FAIRY - 0.01, flags: FeatureFlag.stopAtEnd | FeatureFlag.noReplay });
    features.setScript(flight, FAIRY_FLIGHT);
  }

  function releaseLock(): void {
    if (lock > 0) lock -= 1;
  }

  // --- Grenouilles ---
  const frogViews: FrogView[] = [];

  // --- Kit des épreuves ---
  const kit: PuzzleKit = createPuzzleKit(ctx, {
    screen: SCREEN,
    party,
    places: [],
    introVoice: welcome,
    buttons: {
      map: { images: buttons.map, hold: PRESS_TICKS },
      go: {
        images: buttons.go,
        hold: PRESS_TICKS,
        onPress: () => {
          pressGo();
          return true;
        },
      },
      depth: DEPTH_BUTTONS,
    },
    onPointer: (event) => pointer(event),
  });
  kit.playMusic();
  if (level === 0) kit.playEntryJingle();
  sound.queue(welcome);
  ctx.requestPresent();

  // ------------------------------------------------------------------------------------------------------------------------
  // Aides

  const now = (): number => ctx.clock.ticks;

  /** Joue `script` sur `feature` en position relative `at`, avec son rappel d'événements (installé avant, `finish` le vide à la fin). */
  function play(feature: Feature, script: number, at: Point | null, onEvent: ((n: number) => void) | null): void {
    if (at) {
      feature.position.x = at.x;
      feature.position.y = at.y;
    }
    feature.onEvent = onEvent ? (_image, n) => onEvent(n) : undefined;
    features.setScript(feature, script);
  }

  function syncGo(): void {
    kit.goEnabled = canLeave(state);
  }

  /** Éclaire (ou non) l'étang : un halo qui bat doit être redessiné. */
  function refreshPond(): void {
    features.invalidate();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Dépôt d'un crapaud (`10f8:1b3a` région 3, `10f8:6cdf`)

  /** Rangée de la zone de dépôt qui contient le pointeur (`DS2:241c`). */
  function dropRowAt(x: number, y: number): number | null {
    for (let row = 0; row < DROP_ZONES.length; row++) if (inRect(x, y, DROP_ZONES[row]!)) return row;
    return null;
  }

  function dropToad(view: ToadView, row: number): boolean {
    const { toad } = view;
    if (!drop(state, toad.index, row)) return false;
    view.phase = "setup";
    view.rider = tokens[toad.token]?.variant ?? 0;
    // Le crapaud se pose sur le nénuphar de la première colonne (position de la case) et se met à sa profondeur de rangée.
    features.restack(view.feature, DEPTH_TOAD + row / 100);
    play(view.feature, TOAD_REST + toad.index, origin(0, row), null);
    // Le jeton suivant de la file marche jusqu'à lui ; à son événement 26 il monte dessus (`10f0:1134`) et le crapaud se tend.
    const token = tokens[toad.token];
    if (token?.feature) {
      play(token.feature, TOKEN_WALK + row, null, (n) => {
        if (n === 26) stretchToad(view, row);
        else if (n === FEATURE_END) {
          if (token.feature) features.destroy(token.feature);
          token.feature = null;
        }
      });
    } else stretchToad(view, row);
    if (hasFairy(state) && state.fairy.gauge === FAIRY_GAUGE && state.launched === state.group) regret();
    return true;
  }

  /** Le crapaud se tend (`SCRB 10000`, événement 20) : il sautera dès ce moment. */
  function stretchToad(view: ToadView, row: number): void {
    if (view.phase !== "setup") return;
    play(view.feature, TOAD_STRETCH, origin(0, row), (n) => {
      if (n === 20) {
        view.phase = "ready";
        view.nextAt = now();
      }
    });
  }

  /** `10f8:7866` : baguette épuisée et tous les jetons lancés, la voix de regret si des Zoombinis manquent. */
  function regret(): void {
    if (regretDone) return;
    regretDone = true;
    const saved = state.saved.filter(Boolean).length;
    if (saved >= state.group) return;
    const draw = rng.range(0, 4);
    if (level < draw || visits < 4) sound.queue(rng.range(REGRET_FIRST, REGRET_LAST));
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Sauts, arrivée, sortie

  function stepToadView(view: ToadView): void {
    const { toad } = view;
    const result = stepToad(state, toad);
    if (result.kind === "wait") {
      view.nextAt = now();
      return;
    }
    if (result.kind === "jump") {
      view.phase = "hop";
      hops.push({ toad: toad.index, at: now() });
      play(view.feature, TOAD_JUMP + result.heading, origin(result.from.col, result.from.row), (n) => {
        if (n === 12) settleToad(state, toad);
        else if (n === 10) {
          // Fin du saut : le crapaud est posé, il attend 30 ticks avant le suivant (`10f8:20bc` cas 10).
          view.phase = "ready";
          view.nextAt = now() + TOAD_STEP_TICKS;
        }
      });
      return;
    }
    // Sortie vers la berge droite : l'arrivée est `SCRB 10031 + rangée`, son événement 30 sauve le Zoombini.
    view.phase = "arriving";
    play(view.feature, TOAD_ARRIVAL + result.row, origin(11, result.row), (n) => {
      if (n === 30) arrived(view, result.row);
    });
  }

  /** Événement 30 (`10f8:3c03`) : le Zoombini est sauvé et marche sur la berge droite ; le crapaud part. */
  function arrived(view: ToadView, row: number): void {
    const { toad } = view;
    const saved = toad.token;
    if (!arrive(state, toad)) return;
    syncGo();
    // Le Zoombini débarque (`SCRB 10129 + rangée`) sur la berge droite.
    const variant = tokens[saved]?.variant ?? 0;
    const bank = features.create({
      script: TOKEN_LANDING + row,
      delay: FRAME_DELAY,
      depth: DEPTH_TOKEN,
      flags: FeatureFlag.stopAtEnd | FeatureFlag.noReplay | FeatureFlag.firstImage,
      onImage: (_feature, parts: FeaturePart[]) => {
        if (parts[0]) parts[0].w += variant;
        return parts;
      },
    });
    features.setScript(bank, TOKEN_LANDING + row);
    if (state.arrivals === state.group) kit.playSuccessVoice();
    view.phase = "leaving";
    view.waitingExit = true;
  }

  /** Lance les sorties en attente : une par file (`DS:7c6e`, `7c70`). */
  function startExits(): void {
    for (const view of toadViews) {
      if (!view.waitingExit) continue;
      const second = view.toad.trips >= 2;
      const key = second ? "second" : "first";
      if (exitBusy[key]) continue;
      exitBusy[key] = true;
      view.waitingExit = false;
      const row = view.toad.row;
      const done = (): void => {
        releaseLanding(state, row);
        exitBusy[key] = false;
      };
      if (second) {
        // Deuxième traversée : `10059`, puis l'objet est détruit (événement 54).
        play(view.feature, TOAD_EXIT_SECOND, null, (n) => {
          if (n !== 54) return;
          done();
          view.phase = "gone";
          features.destroy(view.feature);
        });
      } else {
        // Première traversée : `10057`, la scène de la berge (une des trois du kind, `10f8:0bd7`), puis `10058` ramène le crapaud au repos.
        play(view.feature, TOAD_EXIT_FIRST, null, (n) => {
          if (n === 44) done();
          else if (n === FEATURE_END) {
            const scene = TOAD_SCENE + 2 * rng.range(0, 2) + (view.toad.kind === 3 ? 1 : 0);
            play(view.feature, scene, null, (m) => {
              if (m === FEATURE_END) returnToad(view);
            });
          }
        });
      }
    }
  }

  /** `SCRB 10058` : le crapaud revient le long de la berge gauche ; à son événement 49 (`10f8:3b23`) il est au repos et peut être repris. */
  function returnToad(view: ToadView): void {
    play(view.feature, TOAD_RETURN, null, (n) => {
      if (n !== 49) return;
      view.phase = "rest";
      features.restack(view.feature, DEPTH_TOAD + view.toad.index / 100);
      play(view.feature, TOAD_REST + view.toad.index, REST_POSITIONS[view.toad.index]!, null);
    });
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Grenouilles (`10f8:0bd7`, `10f8:4a84`, `10f0:1207`)

  const frogPosition = (col: number, row: number): Point => {
    const o = origin(col, row);
    return { x: o.x + 2, y: o.y - 17 };
  };

  function spawnFrogView(): void {
    const frog = spawnFrog(state);
    if (!frog) return;
    nextFrogAt = now() + FROG_PERIOD_TICKS;
    const tattoo = (): number => tattooOf(frog.kind, frog.value);
    const feature = features.create({
      script: FROG_ARRIVAL,
      delay: rng.range(4, 7),
      depth: DEPTH_FROG + frog.row / 100,
      position: frogPosition(frog.col, frog.row),
      flags: STATIC_FLAGS,
      // `10f0:0c4f` : la variante n'a que sa première case ; sinon la deuxième (image 272) devient le tatouage.
      onImage: (_feature, parts: FeaturePart[]) => {
        if (frog.variant) return parts.slice(0, 1);
        for (const part of parts.slice(1)) if (part.w === 272) part.w += tattoo();
        return parts;
      },
    });
    const view: FrogView = { frog, feature, phase: "arriving", nextAt: 0 };
    frogViews.push(view);
    play(feature, FROG_ARRIVAL, frogPosition(frog.col, frog.row), (n) => {
      if (n === FEATURE_END || n === 70) {
        view.phase = "ready";
        view.nextAt = now() + FROG_STEP_TICKS;
      }
    });
  }

  function stepFrogView(view: FrogView): void {
    const { frog } = view;
    const result = stepFrog(state, frog);
    if (result.kind === "wait") {
      view.nextAt = now() + FROG_STEP_TICKS;
      return;
    }
    if (result.kind === "exit") {
      view.phase = "exit";
      play(view.feature, FROG_EXIT, null, (n) => {
        if (n === FEATURE_END || n === 80) {
          features.destroy(view.feature);
          frogViews.splice(frogViews.indexOf(view), 1);
        }
      });
      return;
    }
    view.phase = "hop";
    features.restack(view.feature, DEPTH_FROG + result.to.row / 100);
    play(view.feature, FROG_JUMPS[result.heading]!, frogPosition(result.from.col, result.from.row), (n) => {
      if (n !== FEATURE_END) return;
      settleFrog(state, frog);
      view.phase = "ready";
      view.nextAt = now() + FROG_STEP_TICKS;
    });
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Pointeur : prise, transport, dépôt (`10f8:6cdf`, `1168:58c7`)

  function overFeature(feature: Feature | null, x: number, y: number): boolean {
    const rect = feature?.rect;
    return !!rect && x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
  }

  /** Premier crapaud au repos sous le pointeur (le plus en avant). */
  function toadAt(x: number, y: number): ToadView | null {
    let found: ToadView | null = null;
    for (const view of toadViews) {
      if (view.phase !== "rest" || !overFeature(view.feature, x, y)) continue;
      if (!found || view.feature.depth >= found.feature.depth) found = view;
    }
    return found;
  }

  /** Prend un crapaud ou la baguette : le kit porte l'objet (souris aimantée, auto-aimantation, curseur masqué : `1168:58c7`). */
  function startCarry(kind: "toad" | "fairy", view: ToadView | null): void {
    const feature = kind === "fairy" ? wand! : view!.feature;
    const origin = { x: feature.position.x, y: feature.position.y };
    carrying = kind;
    if (kind === "fairy") {
      // `82e4 = 4` : reprendre la baguette annule un choix à moitié fait (`10f8:6cdf`).
      cancelPicks();
    }
    kit.carryObject(kind === "toad" ? toadCarry(view!, feature, origin) : fairyCarry(feature, origin));
  }

  /** Le transport est fini (déposé, refusé, ou abandonné par la sortie). */
  function endCarry(): void {
    carrying = null;
    haloRow = null;
    refreshPond();
  }

  function cancelPicks(): void {
    picks.length = 0;
    refreshPond();
  }

  /** Remet le crapaud sur la berge, à sa place de repos. */
  function restToad(view: ToadView): void {
    view.phase = "rest";
    features.restack(view.feature, DEPTH_TOAD + view.toad.index / 100);
    play(view.feature, TOAD_REST + view.toad.index, REST_POSITIONS[view.toad.index]!, null);
  }

  function restWand(): void {
    if (!wand) return;
    features.restack(wand, DEPTH_FAIRY);
    play(wand, GAUGE + state.fairy.gauge, WAND_REST, null);
  }

  /**
   * Le pointeur est-il dans l'étang de la fée ? Rectangle `DS2:2498` moins deux coins coupés en biais (`DS2:24a0`, `24a8` ; pente `0x21b / 100`, `10f8:6cdf`).
   */
  function inPond(x: number, y: number): boolean {
    const { left, top, right, bottom } = POND_RECT;
    if (x < left || x >= right || y < top || y >= bottom) return false;
    if (inRect(x, y, [83, 62, 130, 337]) && y - 62 < (Math.abs(123 - x) * 0x21b) / 100) return false;
    if (inRect(x, y, [509, 155, 556, 430]) && Math.abs(y - 430) < ((x - 509) * 0x21b) / 100) return false;
    return true;
  }

  /** Nénuphar sous la baguette (point chaud décalé de `(+27, +22)`), s'il est libre. */
  function lilyUnderWand(x: number, y: number): Cell | null {
    const hx = x + WAND_HOT.x;
    const hy = y + WAND_HOT.y;
    for (let row = 0; row < 12; row++)
      for (let col = 0; col < 12; col++) {
        const o = origin(col, row);
        if (hx >= o.x + 4 && hx <= o.x + 32 && hy >= o.y + 4 && hy <= o.y + 26) return state.pond.cells[cellIndex(col, row)]!.occupied ? null : { col, row };
      }
    return null;
  }

  function chooseLily(cell: Cell): void {
    sound.queue(SOUND_PICK + (pickSound % 4));
    pickSound = (pickSound + 1) % 4;
    picks.push(cell);
    exchanging = true;
    if (picks.length === 2) {
      exchangeBeat = 0;
      exchangeAt = now() + EXCHANGE_BEAT;
    }
    refreshPond();
  }

  /** Le crapaud tenu : suit le pointeur et éclaire le nénuphar de dépôt valide ; relâché sur une rangée libre il part, sinon il rentre. */
  function toadCarry(view: ToadView, feature: Feature, origin: Point): ObjectCarrySpec {
    const validRow = (x: number, y: number): number | null => {
      const row = dropRowAt(x, y);
      return row !== null && canDrop(state, view.toad.index, row) ? row : null;
    };
    return {
      origin,
      feature,
      onMove: ({ x, y }) => {
        play(feature, TOAD_REST + view.toad.index, { x, y }, null);
        const next = validRow(x, y);
        if (next !== haloRow) {
          haloRow = next;
          refreshPond();
        }
      },
      decide: ({ position }) => validRow(position.x, position.y) !== null,
      onDrop: ({ position }) => {
        const row = validRow(position.x, position.y)!;
        endCarry();
        if (!dropToad(view, row)) restToad(view);
      },
      onReturn: () => {
        endCarry();
        restToad(view);
      },
    };
  }

  /**
   * La baguette tenue : hors de l'étang elle retourne à son repos ; sur un nénuphar libre elle le choisit et reste en main (transport collé : le
   * choix suivant demande un clic, `8546 = 1`) ; pendant l'échange elle ne fait rien.
   */
  function fairyCarry(feature: Feature, origin: Point): ObjectCarrySpec {
    return {
      origin,
      feature,
      onMove: ({ x, y }) => play(feature, GAUGE + state.fairy.gauge, { x, y }, null),
      decide: ({ position }) => {
        if (exchangeBeat >= 0) return "keep";
        if (!inPond(position.x, position.y)) return false;
        if (state.fairy.gauge < FAIRY_GAUGE && picks.length < 2) {
          const cell = lilyUnderWand(position.x, position.y);
          if (cell) chooseLily(cell);
        }
        return "keep";
      },
      onReturn: () => {
        endCarry();
        cancelPicks();
        exchanging = false;
        restWand();
      },
    };
  }

  /** Les crapauds et la baguette se prennent à l'appui ; la suite du transport est celle du kit. */
  function pointer(event: PointerInfo): boolean {
    if (event.button !== "left" || leaving || !event.down || kit.carryingObject) return false;
    if (exchanging) return false;
    if (wand && overFeature(wand, event.x, event.y)) {
      startCarry("fairy", null);
      return true;
    }
    if (lock > 0) return false;
    const view = toadAt(event.x, event.y);
    if (view) {
      startCarry("toad", view);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Échange de la fée (`10f8:5743`, `10f8:5831`)

  function advanceExchange(): void {
    if (exchangeBeat < 0 || now() < exchangeAt) return;
    exchangeBeat += 1;
    exchangeAt = now() + EXCHANGE_BEAT;
    refreshPond();
    if (exchangeBeat < EXCHANGE_BEATS) return;
    exchangeBeat = -1;
    const [a, b] = picks;
    picks.length = 0;
    const before = state.fairy.gauge;
    if (a && b) exchange(state, a, b);
    if (wand && state.fairy.gauge !== before) {
      // Le cran de la jauge change : `SCRB 10078 + g`.
      const at = carrying ? { x: Math.max(0, Math.min(639, ctx.input.mouseX)), y: Math.max(0, Math.min(479, ctx.input.mouseY)) } : null;
      play(wand, GAUGE + state.fairy.gauge, at, null);
    }
    exchanging = false;
    if (state.fairy.gauge === FAIRY_GAUGE && state.launched === state.group) regret();
    refreshPond();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Sortie par « suite » (`10f8:1b3a` région 2)

  function pressGo(): void {
    if (leaving || !canLeave(state)) return;
    kit.pressGo({
      depart: () => {
        leaving = true;
        lock = 0;
        exchanging = false;
        if (carrying) {
          kit.cancelObjectCarry();
          endCarry();
        }
        // `+0x127` de chaque Zoombini : sauvé s'il est arrivé (ou compté par `10f8:7866`).
        party.forEach((z, i) => {
          z.present = state.saved[i] ?? false;
        });
      },
    });
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Tick (`10f8:0bd7`)

  function tick(): void {
    // Le kit gère les clics (boutons, pointeur) et la sortie ; gelé, il ne transmet que le pointeur.
    kit.tick();
    if (kit.left || leaving) return;
    turn += 1;
    // Niveaux 2 à 4 : l'événement 1 de la jauge lève le verrou ; si on a pris la baguette avant, personne ne le lève (le script est rejoué à chaque tick).
    if (lock > 0 && level >= 1 && now() - startedAt > 4 * FRAME_DELAY) lock = 0;
    advanceExchange();
    startExits();
    if (haloShown()) {
      const phase = Math.floor(now() / HALO_TICKS) % 4;
      if (phase !== lastHaloPhase) {
        lastHaloPhase = phase;
        refreshPond();
      }
    }
    if (exchanging) return;
    if (turn % 2 === 0) {
      // Pas des crapauds, un tour sur deux (`DS:852e`).
      for (const view of toadViews) if (view.phase === "ready" && now() >= view.nextAt) stepToadView(view);
    } else if (hasFairy(state) && state.info.entries.length > 0 && lock < 1) {
      // Grenouilles (niveaux 3 et 4) : création à l'échéance puis pas, l'autre tour.
      if (now() >= nextFrogAt) spawnFrogView();
      for (const view of [...frogViews]) if (view.phase === "ready" && now() >= view.nextAt) stepFrogView(view);
    }
  }

  probe?.({
    kit,
    state,
    party,
    toads: toadViews,
    frogs: frogViews,
    tokens,
    wand,
    origin,
    get lock() {
      return lock;
    },
    get carrying() {
      return carrying;
    },
    get exchanging() {
      return exchanging;
    },
    get picks() {
      return picks;
    },
    get leaving() {
      return leaving;
    },
    get haloRow() {
      return haloRow;
    },
    get welcome() {
      return welcome;
    },
    hops,
  });

  return {
    kit,
    tick,
    stop() {
      kit.leave();
    },
  };
}
