/**
 * Les grottes de passe-clos (`TUNNELS.MHK`, écran 8, tâche H2) : écran complet de l'épreuve, d'après `docs/zoombinis/puzzles/tunnels.md`.
 * Les règles (tirage, acceptation, budget, arrivées) sont dans `game/puzzles/tunnels.ts` ; les mécanismes communs (arrivée du groupe, glisser-déposer,
 * sortie, enregistrement, aide F1) dans `scenes/puzzle-kit.ts`. Ce fichier porte le décor, les quatre entrées, la file de décisions, la marche dans
 * les tunnels, les quatre gardiens (crapauds de pierre) et leurs voix, l'effondrement et les deux boutons.
 *
 * ## Écran
 *
 *  - Fond `tBMP` 300 / palette `SHPL` 300, huit groupes de formes (`tBMP` 5000, 6000, 7000, 9000, 4000, 4200, 4400, 4600) et les `SCRB` du
 *    segment `1190:0107` : cave 9000, quatre entrées 5000–5003 (images fixes), quatre gardiens (`SCRB` 6000 + c, créés dans l'ordre 1, 2, 0, 3),
 *    pans de rocher 9001–9006, plafond 7000 (image fixe tant qu'il ne s'effondre pas) ; chute de pierres 7001–7003 créée à la demande.
 *  - 16 places d'attente en bas (`1510:0000`), 4 entrées d'accroche `DS:3bb6`, rayon de prise `DS:9706 = 40`, arrivée échelonnée `274e(30, 45)`.
 *
 * ## Déroulé (Tick `1190:06ff`, événements `1190:1673`, dépôt `1190:0be9`)
 *
 *  - Un Zoombini déposé sur une entrée y reste : sa décision (`judge`) est calculée au dépôt (réussites consécutives de l'entrée, choix des répliques
 *    des gardiens dans leurs tirages sans remise) et placée dans la **file** (5 entrées au plus, `QUEUE_LIMIT`). La tête de file part quand rien ne
 *    se déroule (`busy` = `DS:a0e4`) et que plus aucune voix ne joue : script de marche `SCRS` 8500 + 4 × (pieds − 1) + (entrée − 1) (correct) ou
 *    8519 + 5 × code + pieds (faux choix : marche partielle, choc du gardien à l'événement 13, puis retour par `SCRS` 8000 + code et marche vers une
 *    place d'attente). Une erreur coûte 1 au budget **dès le départ**.
 *  - Arrivée (événement −1 d'une marche correcte) : le Zoombini est sauvé, marche jusqu'à la prochaine place libre du tunnel (16 points par tunnel) ;
 *    réaction du gardien à la première réussite consécutive de l'entrée ; au dernier sauvé, voix de réussite ; animations de victoire des arrivés
 *    (quota 10, 12, 14 et fin), période 60 ticks (120 avec « moins d'action »).
 *  - Budget épuisé : plus personne n'est pris, dès qu'aucune marche n'est en cours les Zoombinis restés aux entrées sont renvoyés en bas (perdus), un
 *    gardien parle, puis le plafond s'effondre (`SCRB` 7000, son 7000). Le bouton « go » reste grisé tant qu'il n'y a aucun arrivé ou que l'effondrement dure.
 *  - Voix : phrases des gardiens (tables de `1190:2137`), aide vocale `a2c4 = rand(20069..20070)` sur F1, encouragement toutes les `rand(5400..10800)`
 *    ticks d'inaction.
 *
 * ## Écarts (voir `docs/zoombinis/puzzles/tunnels.md` §8)
 *
 *  - la compaction des places d'attente de `1190:1aff` n'est pas portée : le Zoombini renvoyé prend la première place libre de la liste préférée
 *    (15, 10 à gauche ; 11, 6 à droite), sinon la première libre ; une entrée de file pleine (5) refuse le dépôt au lieu de laisser le Zoombini bloqué ;
 *  - saisir un Zoombini pendant une phrase la coupe (l'original vide toute la file, Zoombinis en attente compris : défaut non reproduit) ;
 *  - les Zoombinis arrivés ne peuvent pas être repris ;
 *  - `DS:96ec` / `96f0` (règle du pont) sont lus dans la session (`bridgeAvoidCount`, écrite par les gorges) : le filtre du niveau 0 reçoit l'effectif de la règle des gorges.
 */
import { NoRepeatPool } from "../../../../engine/mohawk/rng";
import type { Archive } from "../../../../engine/mohawk/resources";
import { screenInfo } from "../../data/archives";
import type { Point } from "../../data/zoombini";
import { scriptAnchorOffset } from "../../data/zoombini";
import { DIALOG } from "../../engine/dialog";
import { FEATURE_END, FEATURES, FeatureFlag, type Feature } from "../../engine/features";
import { ZOOMBINIS_GAME } from "../../engine/game";
import { scrs } from "../../engine/resources";
import { ScreenId, type Scene, type SceneContext } from "../../engine/scene";
import { ZOOMBINIS_SOUND } from "../../engine/sound";
import { bridgeAvoidCount, dialogMemoryIndex, currentLevel } from "../../game/route";
import type { Zoombini } from "../../game/state";
import {
  ENTRANCES,
  FINAL_SUCCESS_VOICES,
  QUEUE_LIMIT,
  TUNNEL_PLACES,
  arrive,
  canContinue,
  createState,
  drawBlocked,
  drawEncouragementDelay,
  drawIntroVoice,
  drawRules,
  drop as dropOnEntrance,
  reactionAllowed,
  shouldCollapse,
  startWalk,
  type Entrance,
  type Level,
  type TunnelsRules,
  type TunnelsState,
  type Verdict,
} from "../../game/puzzles/tunnels";
import { createPuzzleKit, createTarget, sheetButtonImages, type DropInfo, type DropTarget, type KitMember, type OutsidePlacement, type PuzzleKit } from "../puzzle-kit";
import { closeScreen, openScreen } from "../screen-kit";
import { screenScripts } from "../snoid";

const SCREEN = ScreenId.tunnels;
const BACKGROUND = 300;

// ---------------------------------------------------------------------------------------------------------------------------
// Géométrie et tables de l'original

/** 16 places d'attente (`1510:0000`). */
const WAITING_PLACES: readonly Point[] = [
  { x: 399, y: 402 },
  { x: 367, y: 398 },
  { x: 337, y: 397 },
  { x: 306, y: 400 },
  { x: 274, y: 400 },
  { x: 240, y: 403 },
  { x: 381, y: 424 },
  { x: 351, y: 424 },
  { x: 322, y: 428 },
  { x: 292, y: 422 },
  { x: 261, y: 426 },
  { x: 371, y: 458 },
  { x: 342, y: 459 },
  { x: 310, y: 457 },
  { x: 277, y: 457 },
  { x: 245, y: 459 },
];
/** Points d'accroche des quatre entrées (`DS:3bb6`). */
const ENTRANCE_ANCHORS: readonly Point[] = [
  { x: 98, y: 424 },
  { x: 178, y: 415 },
  { x: 453, y: 421 },
  { x: 533, y: 430 },
];
/** Points d'arrivée du retour (`DS:3bec`, indice `⌊code / 2⌋`). */
const RETURN_POINTS: readonly Point[] = [
  { x: 145, y: 455 },
  { x: 210, y: 434 },
  { x: 430, y: 434 },
  { x: 476, y: 455 },
];
/** Places d'arrivée de chaque tunnel (`1510:0040` entrée 1, `0xc0` entrée 2, `0x100` entrée 3, `0x80` entrée 4), 16 points. */
const ARRIVAL_PLACES: readonly (readonly Point[])[] = [
  [[277, 62], [264, 63], [247, 64], [230, 66], [274, 84], [255, 86], [236, 90], [214, 92], [273, 102], [255, 104], [235, 108], [215, 112], [258, 120], [239, 128], [220, 130], [200, 133]],
  [[288, 213], [273, 219], [257, 223], [238, 226], [222, 230], [283, 235], [268, 239], [252, 245], [237, 248], [221, 252], [287, 257], [270, 260], [253, 262], [240, 265], [220, 270], [259, 280]],
  [[414, 217], [389, 223], [373, 228], [357, 233], [415, 238], [399, 247], [382, 249], [362, 255], [419, 259], [400, 263], [381, 267], [363, 276], [420, 271], [401, 278], [387, 283], [371, 268]],
  [[403, 60], [381, 61], [362, 64], [346, 69], [412, 80], [392, 84], [372, 87], [353, 93], [414, 98], [401, 103], [382, 107], [363, 110], [415, 118], [403, 121], [387, 123], [370, 127]],
].map((tunnel) => tunnel.map(([x, y]) => ({ x: x!, y: y! })));
/** Rayon de prise `DS:9706` (`1190:0000`). */
const DROP_RADIUS = 40;
/** Cible de la marche de sortie (`1190:0cae` : `1168:2982(45, …, 30, 670)`). */
const EXIT_WALK = { x: 670, y: 30, step: 45 };
/** Ordonnée de renvoi des Zoombinis restés aux entrées à l'effondrement (`1190:14bc` : `0x1cc`). */
const COLLAPSE_RETURN_Y = 460;
/** Places préférées du Zoombini renvoyé (`DS:3bfc` côté gauche : entrées 1 et 2 ; `DS:3c00` côté droit). */
const PREFERRED_LEFT = [15, 10] as const;
const PREFERRED_RIGHT = [11, 6] as const;

/** Gardien de chaque code de trajet 0 à 7 (`DS:3b96`). */
const PILLAR_OF_CODE = [0, 1, 0, 2, 2, 3, 1, 3] as const;
/** Ordre de création des quatre gardiens (`DS:3bc6`) : le gardien c est l'objet `SCRB` 6000 + c. */
const PILLAR_ORDER = [1, 2, 0, 3] as const;
/** Choc du gardien contre le Zoombini renvoyé : `SCRB` 6004 + code. */
const BUMP_BASE = 6004;
/** Pierres qui tombent à l'avertissement : `SCRB` 7001 + rand(0..2) (`1190:19fd`). */
const STONES_BASE = 7001;
const CEILING_SCRIPT = 7000;
/** Délais d'une feature du décor (`11a8:0ad6(…, 6, …)`) et d'un Zoombini sur le chemin correct (`+0x28 = 4`). */
const DECOR_DELAY = 6;
const CORRECT_DELAY = 4;
/** Animations de victoire des arrivés : période `DS:a1b0` (60, ou 120 avec « moins d'action »), `SCRS` 8559 + pieds. */
const DANCE_PERIOD = 60;
const DANCE_PERIOD_LESS = 120;
const DANCE_BASE = 8559;
/** Image enfoncée d'un bouton, en ticks (`1190:0574` suivi d'une pause). */
const PRESS_TICKS = 6;
/** Images de `tBMP` 400 (1 à 6) : 1 « go » grisé, 2 « go », 3 « go » enfoncé, 5 carte, 6 carte enfoncée (`1190:0574`). */
const BUTTON_SHEET = 400;

// Tirages sans remise des gardiens (`1098:0098`, tables `DS:3a5a…3ae2`) : les ids sont des `SCRB` des groupes 4000, 4200, 4400, 4600.
const range = (first: number, count: number): readonly number[] => Array.from({ length: count }, (_, i) => first + i);
/** Réponse du gardien 0 à un faux choix (10, `4005` limité à 3 répétitions), réaction du gardien extérieur gauche (11). */
const REPLY_PILLAR_0 = range(4000, 10);
const REACT_OUTER_LEFT = range(4010, 11);
/** Gardien 2 : réponse à un faux choix (8) et réaction à un bon choix (8). */
const REPLY_PILLAR_2 = range(4200, 8);
const REACT_PILLAR_2 = range(4208, 8);
/** Gardien 3 : réponse à un faux choix (7, `4416` limité), réaction du gardien extérieur droit (6). */
const REPLY_PILLAR_3 = [4404, 4403, 4413, 4414, 4415, 4416, 4400] as const;
const REACT_OUTER_RIGHT = [4417, 4405, 4406, 4407, 4401, 4418] as const;
/** Gardien 1 : réponse à un faux choix (4) et réaction à un bon choix (6). */
const REPLY_PILLAR_1 = range(4600, 4);
const REACT_PILLAR_1 = range(4604, 6);
/** Réponses à répétition limitée (`0xfa5` du gardien 0, `0x1140` du gardien 3) : au plus trois tirages consécutifs avant de les accepter. */
const LIMITED_REPLY_0 = 4005;
const LIMITED_REPLY_3 = 4416;

/** Une réplique d'une conversation : gardien (0 à 3) et `SCRB` à jouer sur lui. */
type Line = readonly [pillar: number, script: number];
/** Conversation : gardien A, gardien B, seconde réplique de A, seconde réplique de B (`1190:2137`, champs `a110…a11a`). */
interface Talk {
  a?: Line;
  b?: Line;
  a2?: number;
  b2?: number;
}

/** `2137(0)` : phrase d'encouragement, 10 variantes. */
const TALK_ENCOURAGE: readonly Talk[] = [
  { a: [1, 4610], b: [2, 4216] },
  { a: [2, 4217] },
  { a: [2, 4218] },
  { a: [2, 4219] },
  { a: [2, 4220] },
  { a: [0, 4021], b: [3, 4408] },
  { a: [0, 4022], b: [3, 4408] },
  { a: [3, 4402], b: [0, 4023], b2: 4029 },
  { a: [3, 4402], b: [0, 4023], b2: 4030 },
  { a: [3, 4419] },
];
/** `2137(1)` : introduction à la première visite de l'exécution (4 variantes), puis aux suivantes (8). */
const TALK_INTRO_FIRST: readonly Talk[] = [{ a: [2, 4221] }, { a: [0, 4024], a2: 4025 }, { a: [1, 4614] }, { a: [3, 4409] }];
const TALK_INTRO_LATER: readonly Talk[] = [
  { a: [1, 4611], b: [0, 4026] },
  { a: [1, 4611], b: [2, 4224] },
  { a: [3, 4411], b: [1, 4612] },
  { a: [1, 4613], b: [2, 4223] },
  { a: [1, 4613], b: [2, 4222] },
  { a: [3, 4410], b: [2, 4222] },
  { a: [0, 4027], b: [3, 4412] },
  { a: [0, 4028], b: [2, 4223] },
];
/** `2137(2)` : l'effondrement commence (3 variantes). */
const TALK_COLLAPSE: readonly Talk[] = [{ a: [3, 4420] }, { a: [3, 4421] }, { a: [3, 4422] }];
/** `2137(3)` : sortie par « go », tous sauvés (8), des perdus (9), après l'effondrement (7). */
const TALK_OUTRO_ALL: readonly Talk[] = [
  { a: [0, 4031] },
  { a: [1, 4617] },
  { a: [0, 4038] },
  { a: [0, 4034] },
  { a: [0, 4036] },
  { a: [0, 4037] },
  { a: [0, 4032] },
  { a: [0, 4033] },
];
const TALK_OUTRO_SOME: readonly Talk[] = [
  { a: [2, 4225] },
  { a: [2, 4226] },
  { a: [1, 4615] },
  { a: [1, 4616] },
  { a: [0, 4034] },
  { a: [0, 4036] },
  { a: [0, 4037] },
  { a: [0, 4032] },
  { a: [0, 4033] },
];
const TALK_OUTRO_COLLAPSED: readonly Talk[] = [
  { a: [0, 4035] },
  { a: [3, 4423] },
  { a: [0, 4034] },
  { a: [0, 4036] },
  { a: [0, 4037] },
  { a: [0, 4032] },
  { a: [0, 4033] },
];

/** Compteur de visites de l'exécution (`DS:a18e`, remis à 0 au lancement du programme seulement) : la première visite a une introduction plus courte. */
let visits = 0;
/** Pour les tests : remet le compteur de visites comme au lancement du programme. */
export function resetTunnelsVisits(): void {
  visits = 0;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Modèle de la scène

type SlotStatus = "waiting" | "queued" | "active" | "arrived" | "lost";

interface Slot {
  member: KitMember;
  status: SlotStatus;
}

/** Entrée de la file (`DS:a100`, 28 octets) : un Zoombini à faire partir, ou une conversation des gardiens (identifiant 0). */
interface WalkEntry {
  kind: "walk";
  slot: Slot;
  verdict: Verdict;
  /** Marche aller (`a10c`) et retour (`a10e`, 0 si correct). */
  walkScript: number;
  returnScript: number;
  /** Gardien du trajet (`a110`), réaction à l'arrivée ou choc (`a112`), réplique après le choc (`a114`). */
  pillar: number;
  scriptA: number;
  scriptA2: number;
  /** Gardien extérieur (`a116`) et sa réplique (`a118`), jouée au départ. */
  outer: number;
  scriptB: number;
  phase: "queued" | "out" | "back";
  /** Voix d'avertissement à jouer au retour (`a1a0`). */
  warning: number | null;
}

interface TalkEntry {
  kind: "talk";
  lines: Line[];
  next: number;
}

type Entry = WalkEntry | TalkEntry;

/** Réaction d'un gardien en attente (`a0e6` / `a0e8` / `a0ea`) : jouée dès qu'aucune voix ne joue ; `release` = fin de la file (rappel `15a2`). */
interface Reaction {
  pillar: number;
  script: number;
  release: boolean;
}

/** Ce que les tests peuvent lire sans toucher à la scène. */
export interface TunnelsDebug {
  readonly rules: TunnelsRules | null;
  readonly state: TunnelsState | null;
  readonly queueLength: number;
  readonly busy: boolean;
  readonly collapse: "none" | "talking" | "falling" | "done";
  /** Entrée (1 à 4) où ce membre est déposé ou en marche, ou null. */
  statusOf(index: number): SlotStatus | undefined;
  readonly kit: PuzzleKit | null;
  /** Position (pieds) du centre d'une entrée. */
  entranceAnchor(entrance: Entrance): Point;
}

export type TunnelsScene = Scene & { readonly debug: TunnelsDebug };

/** Fabrique de la scène de l'épreuve (écran 8). */
export function createTunnelsScene(): TunnelsScene {
  const name = screenInfo(SCREEN)?.archive;
  if (!name) throw new Error("createTunnelsScene : pas d'archive pour l'écran 8");
  let archive: Archive;
  let kit: PuzzleKit | null = null;
  let party: Zoombini[] = [];
  let rules: TunnelsRules | null = null;
  let state: TunnelsState | null = null;
  const debug = {
    get rules() {
      return rules;
    },
    get state() {
      return state;
    },
    get queueLength() {
      return queue.length;
    },
    get busy() {
      return busy;
    },
    get collapse() {
      return collapseStage === 0 ? "none" : collapseDone ? "done" : collapseStage === 1 ? "talking" : "falling";
    },
    statusOf: (index: number) => slots.get(kit?.members[index] as KitMember)?.status,
    get kit() {
      return kit;
    },
    entranceAnchor: (entrance: Entrance) => ENTRANCE_ANCHORS[entrance - 1]!,
  } satisfies TunnelsDebug;

  // État de l'écran (`DS:a0c6…a1b4`, remis à zéro par `1190:0000` à chaque entrée).
  const slots = new Map<KitMember, Slot>();
  let queue: Entry[] = [];
  /** `a0e4` : une marche ou une phrase est en cours. */
  let busy = false;
  /** Jeton de la phrase en cours : une phrase coupée ne libère plus `busy` à sa fin. */
  let talkToken = 0;
  /** `a0fe` : 0 rien, 1 effondrement lancé (phrase du gardien), 2 plafond à lancer, 3 plafond lancé. */
  let collapseStage = 0;
  let collapseDone = false;
  /** `a1a0` / `a19e` : voix d'avertissement en cours (son 4700 à 4703), 0 si aucune. */
  let warningVoice = 0;
  let reaction: Reaction | null = null;
  /** `a1a6` : voix de réussite en attente. */
  let finalVoice = 0;
  /** `a0f0` : inaction (ticks) avant la prochaine phrase d'encouragement, et dernier instant d'action. */
  let encourageAfter = 0;
  let lastAction = 0;
  /** Animations de victoire : quota `a1a8`, jouées `a1aa`, dernier instant `a1ac`. */
  let danceQuota = 0;
  let dancePlayed = 0;
  let danceAt = 0;
  let entranceTargets: DropTarget[] = [];
  let pillars: Feature[] = [];
  let ceiling: Feature | null = null;
  /** Tirages sans remise (`DS:3a6e…3aee`, `3c08…3c20`) : état conservé le temps de l'écran. */
  const pools = new Map<string, NoRepeatPool>();
  /** Compteurs de répétitions limitées (`a198`, `a19a`), remis à 0 par un bon choix. */
  const limited = { left: 0, right: 0 };
  let currentCtx: SceneContext | null = null;

  function pool(key: string, size: number): NoRepeatPool {
    let p = pools.get(key);
    if (!p) pools.set(key, (p = new NoRepeatPool(size)));
    return p;
  }

  const scene: Scene = {
      async load(ctx: SceneContext) {
        archive = await ctx.resources.open(name);
      },

      enter(ctx: SceneContext) {
        const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
        const { game, session } = zoombinis;
        session.screen = SCREEN;
        visits += 1;
        const features = ctx.services.get(FEATURES);
        const rng = ctx.rng;
        currentCtx = ctx;
        slots.clear();
        queue = [];
        busy = false;
        talkToken = 0;
        collapseStage = 0;
        collapseDone = false;
        warningVoice = 0;
        reaction = null;
        finalVoice = 0;
        danceQuota = 0;
        dancePlayed = 0;
        danceAt = 0;
        pools.clear();

        // `1190:0107` : niveau, archive, palette et fond, groupes de formes et plages de `SCRB`.
        const level = currentLevel(game, session, SCREEN) as Level;
        openScreen(ctx, archive, { background: BACKGROUND });
        [5000, 6000, 7000, 9000, 4000, 4200, 4400, 4600].forEach((id, k) => features.defineGroup(k, id));
        features.setScripts(5000, 4);
        features.addScripts(6000, 12);
        features.addScripts(7000, 5);
        features.addScripts(9000, 7);
        features.addScripts(4000, 39);
        features.addScripts(4200, 27);
        features.addScripts(4400, 24);
        features.addScripts(4600, 18);

        // `1190:0000` : `a0ce` est le premier tirage de l'entrée.
        const blocked = drawBlocked(rng);

        // Décor, dans l'ordre de création de l'original : cave, entrées, gardiens, pans de rocher, plafond. Profondeurs : tous derrière les Zoombinis (≥ 1).
        const still = FeatureFlag.staticFirst | FeatureFlag.stopAtEnd;
        features.create({ script: 9000, delay: DECOR_DELAY, depth: 0.1, flags: still });
        for (let e = 0; e < ENTRANCES; e++) features.create({ script: 5000 + e, delay: DECOR_DELAY, depth: 0.2, flags: still });
        pillars = [];
        for (const c of PILLAR_ORDER) pillars[c] = features.create({ script: 6000 + c, delay: DECOR_DELAY, depth: 0.3, flags: still });
        for (let id = 9001; id <= 9006; id++) features.create({ script: id, delay: DECOR_DELAY, depth: 0.4, flags: still });
        ceiling = features.create({ script: CEILING_SCRIPT, delay: DECOR_DELAY, depth: 3, flags: still });

        // Groupe de la scène : copie des présents du tampon (`party` de `exitPuzzle`).
        party = game.group.members.filter((z) => z.present).map((z) => ({ ...z, attrs: [...z.attrs] as Zoombini["attrs"], state: z.state.slice() }));
        entranceTargets = ENTRANCE_ANCHORS.map((anchor, i) => createTarget(anchor, (i + 1) as Entrance));
        const buttons = sheetButtonImages(archive.tbmpImages(BUTTON_SHEET));
        kit = createPuzzleKit(ctx, {
          screen: SCREEN,
          party,
          places: WAITING_PLACES,
          targets: (places) => [...places, ...entranceTargets],
          radius: DROP_RADIUS,
          snoid: { scripts: screenScripts(archive) },
          // Boutons de la planche 400 (`1190:0574`), dessinés par le kit devant les Zoombinis ; image enfoncée tenue 6 ticks ; « go » ajoute une phrase de sortie.
          buttons: { map: { images: buttons.map, hold: PRESS_TICKS }, go: { images: buttons.go, hold: PRESS_TICKS, onPress: () => pressGo(ctx) }, depth: 2.9 },
          exitWalk: EXIT_WALK,
          canPick: (member) => canPick(member),
          decide: (info) => decide(info),
          onPick: (member) => onPick(member),
          onDrop: (info) => onDrop(ctx, info),
          onDropOutside: (info) => onDropOutside(ctx, info),
        });
        kit.arrive({ startDelay: 30, step: 45 });
        kit.members.forEach((member) => slots.set(member, { member, status: "waiting" }));

        // Règles, après la création du groupe (`1168:365d` : les membres présents).
        // `1190:2748` : au niveau 0, l'effectif de la règle laissée par les gorges (`DS:96f0`) est évité.
        rules = drawRules(rng, level, party.filter((z) => z.present).map((z) => z.attrs), blocked, bridgeAvoidCount(session));
        state = createState(rules, party.filter((z) => z.present).length);
        // `1168:3dd0(0, 0)` : personne n'est sauvé.
        kit.markAll(false);
        kit.introVoice = drawIntroVoice(rng);
        if (session.training === 0) {
          const index = dialogMemoryIndex(SCREEN);
          if (index >= 0 && (game.dialogMemory[index]! & 0xfff) < 0xfff) game.dialogMemory[index] = game.dialogMemory[index]! + 1;
        }
        // `2137(1)` (introduction) puis `a0f0`.
        queueTalk(ctx, visits === 1 ? pick("introFirst", TALK_INTRO_FIRST, rng) : pick("introLater", TALK_INTRO_LATER, rng));
        encourageAfter = drawEncouragementDelay(rng);
        lastAction = ctx.clock.ticks;
        kit.playMusic();
        ctx.requestPresent();
      },

      leave(ctx: SceneContext) {
        kit?.leave();
        kit = null;
        closeScreen(ctx);
      },

      tick(ctx: SceneContext) {
        if (!kit) return;
        kit.tick();
        if (kit.left || (ctx.services.tryGet(DIALOG)?.isOpen ?? false)) return;
        const st = state!;
        kit.goEnabled = canContinue(st, collapseDone);
        // `DS:96f4` : le transport est fini d'office quand le budget est épuisé.
        if (st.budget === 0) kit.endCarry();
        if (warningVoice !== 0 && !ctx.services.get(ZOOMBINIS_SOUND).isPlaying(warningVoice)) warningVoice = 0;
        stepReaction(ctx);
        stepQueue(ctx);
        stepIdle(ctx);
        stepCeiling(ctx);
        stepDance(ctx);
      },

      key(event, ctx: SceneContext) {
        if (!kit || kit.left) return false;
        if (event.ctrl || event.alt) return false;
        if (ctx.services.tryGet(DIALOG)?.isOpen) return false;
        return kit.key(event);
      },
  };
  return Object.assign(scene, { debug });

  // -------------------------------------------------------------------------------------------------------------------------
  // Outils

  /**
   * `1190:06ff` : la « voix en cours » est le dernier son démarré (`DS:a402`) s'il joue encore, selon sa plage : 4000 à 4699 (consignes, gardiens :
   * `bVar4`) ou 7000 à 7099 (`bVar1`). Un pas en boucle d'un Zoombini (8500 à 8508) ou un autre effet ne retient rien.
   */
  function speaking(min: number, max: number): boolean {
    const sound = currentCtx!.services.get(ZOOMBINIS_SOUND);
    const id = sound.currentEffect;
    return id >= min && id <= max && sound.isPlaying(id);
  }

  /** `bVar4` : une voix 4000 à 4699 joue. */
  function voiceBusy(): boolean {
    return speaking(4000, 4699);
  }

  /** Ni `bVar4` ni `bVar1` : aucune voix 4000 à 4699 ni 7000 à 7099 ne joue. */
  function quiet(): boolean {
    return !voiceBusy() && !speaking(7000, 7099);
  }

  /** Tirage dans une table de répliques (`1098:0098` sans remise sur la taille de la table). */
  function pick<T>(key: string, table: readonly T[], rng: SceneContext["rng"]): T {
    return table[pool(key, table.length).pick(rng)]!;
  }

  function slotOf(member: KitMember): Slot {
    return slots.get(member)!;
  }

  function resetIdle(ctx: SceneContext): void {
    lastAction = ctx.clock.ticks;
  }

  function sideOf(entrance: Entrance): "left" | "right" {
    return entrance <= 2 ? "left" : "right";
  }

  /** Fait jouer `script` au gardien `pillar` (`11a8:1b89` puis `3533`) ; `onEnd` à la fin du script. */
  function speak(ctx: SceneContext, pillar: number, script: number, onEnd?: () => void): void {
    const feature = pillars[pillar];
    if (!feature) return;
    feature.onEvent = onEnd
      ? (_image, n) => {
          if (n === FEATURE_END) onEnd();
        }
      : undefined;
    ctx.services.get(FEATURES).setScript(feature, script);
  }

  function pop(): void {
    queue.shift();
  }

  // -------------------------------------------------------------------------------------------------------------------------
  // Boutons (le kit les dessine, tient l'image enfoncée et appelle `pressGo` à l'activation de « go »)

  /** Bouton Continuer (`1190:0be9`, région 2) : son 996 et marche des sauvés (kit), phrase de sortie (`2137(3)`). Rappel de pression : traite le clic seul. */
  function pressGo(ctx: SceneContext): boolean {
    if (!kit) return true;
    // Une phrase en cours est coupée ; la phrase de sortie passe en tête de file.
    queue = queue.filter((entry) => entry.kind !== "talk");
    busy = false;
    talkToken += 1;
    if (!kit.pressGo()) return true;
    const st = state!;
    const table = collapseDone ? TALK_OUTRO_COLLAPSED : st.saved === st.total ? TALK_OUTRO_ALL : TALK_OUTRO_SOME;
    const key = collapseDone ? "outroCollapsed" : st.saved === st.total ? "outroAll" : "outroSome";
    queue.unshift(talkEntry(pick(key, table, ctx.rng)));
    return true;
  }

  // -------------------------------------------------------------------------------------------------------------------------
  // Conversations des gardiens (`1190:2137`, `1190:2088`)

  function talkEntry(talk: Talk): TalkEntry {
    // `2088` : A, puis B, puis la seconde réplique de A, puis celle de B ; les répliques absentes sont sautées.
    const lines: Line[] = [];
    if (talk.a) lines.push(talk.a);
    if (talk.b) lines.push(talk.b);
    if (talk.a && talk.a2) lines.push([talk.a[0], talk.a2]);
    if (talk.b && talk.b2) lines.push([talk.b[0], talk.b2]);
    return { kind: "talk", lines, next: 0 };
  }

  function queueTalk(ctx: SceneContext, talk: Talk): void {
    if (queue.length >= QUEUE_LIMIT) return;
    queue.push(talkEntry(talk));
    void ctx;
  }

  function stepTalk(ctx: SceneContext, entry: TalkEntry): void {
    if (entry.next >= entry.lines.length) {
      pop();
    } else {
      const [pillar, script] = entry.lines[entry.next++]!;
      const token = ++talkToken;
      busy = true;
      speak(ctx, pillar, script, () => {
        if (token === talkToken) busy = false;
        if (collapseStage === 1) collapseStage = 2;
      });
    }
    resetIdle(ctx);
  }

  // -------------------------------------------------------------------------------------------------------------------------
  // Glisser-déposer (rappels du kit)

  function canPick(member: KitMember): boolean {
    const slot = slots.get(member);
    if (!slot || !kit) return false;
    if (state!.budget === 0 || state!.collapsed) return false;
    if (slot.status !== "waiting" && slot.status !== "queued") return false;
    return kit.walking < 1 && !member.snoid.walking && (member.snoid.resting || member.snoid.playingWait);
  }

  function entranceOf(target: DropTarget | null): Entrance | null {
    return target && typeof target.tag === "number" ? (target.tag as Entrance) : null;
  }

  function decide(info: DropInfo): boolean {
    const entrance = entranceOf(info.target);
    if (entrance === null) return info.target !== null;
    // Une file pleine (5) refuserait la décision dans l'original et laisserait le Zoombini bloqué : ici le dépôt est refusé.
    return queue.length < QUEUE_LIMIT && state!.budget > 0;
  }

  function onPick(member: KitMember): void {
    const slot = slotOf(member);
    resetIdle(ctxOf());
    // Une phrase en cours est coupée (`1190:0be9`, région 3).
    if (queue[0]?.kind === "talk") {
      queue = queue.filter((entry) => entry.kind !== "talk");
      busy = false;
      talkToken += 1;
    }
    const index = queue.findIndex((entry) => entry.kind === "walk" && entry.slot === slot);
    if (index >= 0) queue.splice(index, 1);
    slot.status = "waiting";
  }

  function onDrop(ctx: SceneContext, info: DropInfo): void {
    const slot = slotOf(info.member);
    const entrance = entranceOf(info.target);
    slot.status = "waiting";
    if (entrance !== null) enqueue(ctx, slot, entrance);
    resetIdle(ctx);
  }

  /**
   * Dépôt non accepté (`1190:0be9`) : reposé sur son entrée, il retente la décision (le retour par défaut le remet sur l'entrée) ; lâché ailleurs, ou
   * refusé (file pleine, budget épuisé), il rejoint une place d'attente (`1168:5cd1`) au lieu de retourner à son entrée.
   */
  function onDropOutside(ctx: SceneContext, info: DropInfo): OutsidePlacement | undefined {
    const slot = slotOf(info.member);
    const from = entranceOf(info.from);
    resetIdle(ctx);
    if (from === null) return undefined;
    if (info.target === info.from && queue.length < QUEUE_LIMIT && state!.budget > 0) {
      // Reposé sur la même entrée : nouvelle décision.
      enqueue(ctx, slot, from);
      return undefined;
    }
    slot.status = "waiting";
    const place = freePlace(from);
    return { at: { x: place.x, y: place.y }, place };
  }

  function ctxOf(): SceneContext {
    return currentCtx!;
  }

  /** Décision d'un dépôt (`1190:0be9`) : verdict, tirages des répliques dans l'ordre de l'original, entrée de file. */
  function enqueue(ctx: SceneContext, slot: Slot, entrance: Entrance): void {
    const st = state!;
    const member = slot.member;
    const verdict = dropOnEntrance(st, member.zoombini.attrs, entrance);
    const feet = member.zoombini.attrs[3];
    const code = verdict.code;
    const rng = ctx.rng;
    let outer = 0;
    let scriptB = 0;
    // Gardien extérieur (`local_24` / `local_26`) quand le premier embranchement est bon.
    if (verdict.first) {
      if (code < 4) {
        outer = 0;
        scriptB = pick("outerLeft", REACT_OUTER_LEFT, rng);
      } else {
        outer = 3;
        scriptB = pick("outerRight", REACT_OUTER_RIGHT, rng);
      }
    }
    const pillar = PILLAR_OF_CODE[code]!;
    let scriptA = 0;
    let scriptA2 = 0;
    let walkScript: number;
    let returnScript = 0;
    if (!verdict.wrong) {
      limited.left = 0;
      limited.right = 0;
      if (code === 1 || code === 6) scriptA = pick("reactPillar1", REACT_PILLAR_1, rng);
      else if (code === 3 || code === 4) scriptA = pick("reactPillar2", REACT_PILLAR_2, rng);
      walkScript = 8500 + (feet - 1) * 4 + (entrance - 1);
      // Le dernier à sauver n'a pas de réaction du gardien extérieur (`a1a4 ≤ sauvés + 1`).
      if (st.total <= st.saved + 1) {
        outer = 0;
        scriptB = 0;
      }
    } else {
      scriptA = BUMP_BASE + code;
      switch (pillar) {
        case 0: {
          limited.left += 1;
          do scriptA2 = pick("replyPillar0", REPLY_PILLAR_0, rng);
          while (scriptA2 === LIMITED_REPLY_0 && limited.left < 3);
          break;
        }
        case 1:
          scriptA2 = pick("replyPillar1", REPLY_PILLAR_1, rng);
          break;
        case 2:
          scriptA2 = pick("replyPillar2", REPLY_PILLAR_2, rng);
          break;
        default: {
          limited.right += 1;
          do scriptA2 = pick("replyPillar3", REPLY_PILLAR_3, rng);
          while (scriptA2 === LIMITED_REPLY_3 && limited.right < 3);
        }
      }
      walkScript = 8519 + code * 5 + feet;
      returnScript = 8000 + code;
    }
    queue.push({ kind: "walk", slot, verdict, walkScript, returnScript, pillar, scriptA, scriptA2, outer, scriptB, phase: "queued", warning: null });
    slot.status = "queued";
  }

  /** Place d'attente d'un Zoombini renvoyé (`1190:1aff`, version simplifiée) : la première libre de la liste préférée du côté, sinon la première libre. */
  function freePlace(entrance: Entrance): DropTarget {
    const places = kit!.waitingPlaces;
    const preferred = sideOf(entrance) === "left" ? PREFERRED_LEFT : PREFERRED_RIGHT;
    for (const i of preferred) if (places[i]!.owner === null) return places[i]!;
    return places.find((p) => p.owner === null) ?? places[preferred[0]]!;
  }

  // -------------------------------------------------------------------------------------------------------------------------
  // File de décisions (Tick `1190:06ff`)

  function stepQueue(ctx: SceneContext): void {
    const st = state!;
    if (kit!.departing) {
      const head = queue[0];
      if (head?.kind === "talk" && !busy) stepTalk(ctx, head);
      return;
    }
    if (st.budget === 0) {
      if (shouldCollapse(st, busy) && !voiceBusy()) startCollapse(ctx);
      else if (!busy && queue[0]?.kind === "talk" && !voiceBusy()) stepTalk(ctx, queue[0]);
      return;
    }
    if (warningVoice !== 0 || busy) return;
    const head = queue[0];
    if (!head) return;
    if (head.kind === "talk") stepTalk(ctx, head);
    else if (head.phase === "queued" && quiet()) startWalk_(ctx, head);
  }

  /** Départ de la tête de file (phase 0 de `1190:06ff`). */
  function startWalk_(ctx: SceneContext, entry: WalkEntry): void {
    const st = state!;
    const { slot, verdict } = entry;
    const { snoid } = slot.member;
    const entrance = verdict.entrance;
    entry.phase = "out";
    slot.status = "active";
    // Réponse du gardien extérieur, tant que l'entrée n'a pas eu deux réussites de suite (`a0f4[e] < 2`).
    if (entry.scriptB !== 0 && reactionAllowed(st, entrance)) speak(ctx, entry.outer, entry.scriptB);
    // L'entrée est libérée (`1168:170f`).
    const target = entranceTargets[entrance - 1]!;
    if (target.owner === slot.member) target.owner = null;
    slot.member.target = null;
    snoid.setFacing(sideOf(entrance) === "left" ? 0 : 1);
    if (!verdict.wrong) snoid.delay = CORRECT_DELAY;
    snoid.onEvent = (n) => onWalkEvent(ctx, entry, n);
    snoid.onEnd = () => onWalkEnd(ctx, entry);
    snoid.play(entry.walkScript, FeatureFlag.stopAtEnd);
    entry.warning = startWalk(st, verdict).warning;
    busy = true;
    resetIdle(ctx);
  }

  /** Événements des scripts de marche (`1190:1673`) : 0 = le Zoombini se retourne, 13 = le gardien réagit (choc puis réplique). */
  function onWalkEvent(ctx: SceneContext, entry: WalkEntry, n: number): void {
    const { snoid } = entry.slot.member;
    if (n === 0) {
      snoid.setFacing(snoid.facing === 0 ? 1 : 0);
    } else if (n === 13 && entry.verdict.wrong) {
      speak(ctx, entry.pillar, entry.scriptA, () => {
        if (entry.scriptA2 !== 0) reaction = { pillar: entry.pillar, script: entry.scriptA2, release: false };
      });
    }
  }

  /** Fin d'un script de marche ou de retour (événement −1, `1190:17e1`). */
  function onWalkEnd(ctx: SceneContext, entry: WalkEntry): void {
    const { slot, verdict } = entry;
    const { snoid } = slot.member;
    if (verdict.wrong && entry.phase === "out") {
      // Événement 10 : enchaînement sur le retour, qui finit au point `DS:3bec` du tunnel.
      entry.phase = "back";
      snoid.delay = 6;
      snoid.play(entry.returnScript, FeatureFlag.stopAtEnd, { kind: "reject", at: RETURN_POINTS[verdict.code >> 1]! });
      return;
    }
    reaction = null;
    if (!verdict.wrong) {
      arrived(ctx, entry);
    } else {
      returned(ctx, entry);
    }
    if (reaction === null) {
      pop();
      busy = false;
    }
    if (collapseStage === 1) collapseStage = 2;
    resetIdle(ctx);
  }

  /** Arrivée correcte : place du tunnel, voix, quota d'animations de victoire, réaction du gardien. */
  function arrived(ctx: SceneContext, entry: WalkEntry): void {
    const st = state!;
    const { slot, verdict } = entry;
    const { snoid } = slot.member;
    const entrance = verdict.entrance;
    const first = reactionAllowed(st, entrance);
    const n = arrive(st, entrance);
    slot.status = "arrived";
    slot.member.zoombini.present = true;
    // Position finale du script (la dernière image est à `origine + dernière case`), puis marche vers la place d'arrivée du tunnel.
    snoid.setPosition(scriptEnd(snoid.position, entry.walkScript));
    snoid.delay = 6;
    const place = ARRIVAL_PLACES[entrance - 1]![Math.min(n, TUNNEL_PLACES - 1)]!;
    snoid.onEnd = undefined;
    snoid.onEvent = undefined;
    snoid.walkTo({ x: place.x, y: place.y });
    ctx.services.get(FEATURES).restack(snoid.feature, 1 + place.y / 1000);
    // `1190:19a9…`: quota d'animations (10, 12, 14 arrivés) ; au dernier, voix de réussite et deux animations de plus.
    if (st.saved === st.total) {
      danceQuota += 2;
      finalVoice = ctx.rng.range(FINAL_SUCCESS_VOICES.first, FINAL_SUCCESS_VOICES.last);
    } else if (st.saved === 10 || st.saved === 12) {
      danceQuota += 1;
    } else if (st.saved === 14) {
      danceQuota += 2;
    }
    if (first && entry.scriptA !== 0) reaction = { pillar: entry.pillar, script: entry.scriptA, release: true };
  }

  /** Retour d'un faux choix : avertissement, pierres, marche vers une place d'attente. */
  function returned(ctx: SceneContext, entry: WalkEntry): void {
    const { slot, verdict } = entry;
    const { snoid } = slot.member;
    if (warningVoice === 0 && entry.warning !== null) {
      warningVoice = entry.warning;
      ctx.services.get(ZOOMBINIS_SOUND).queue(entry.warning);
      dropStones(ctx);
    }
    const place = freePlace(verdict.entrance);
    place.owner = slot.member;
    slot.member.waiting = place;
    slot.member.target = place;
    slot.status = "waiting";
    snoid.onEnd = undefined;
    snoid.onEvent = undefined;
    snoid.walkTo({ x: place.x, y: place.y });
    ctx.services.get(FEATURES).restack(snoid.feature, 1 + place.y / 1000);
  }

  /** Pierres qui tombent (`SCRB` 7001 + rand(0..2)), créées à la demande et retirées à la fin. */
  function dropStones(ctx: SceneContext): void {
    const features = ctx.services.get(FEATURES);
    const stones = features.create({
      script: STONES_BASE + ctx.rng.range(0, 2),
      delay: DECOR_DELAY,
      depth: 3,
      flags: FeatureFlag.stopAtEnd | FeatureFlag.firstImage,
      onEvent: (_image, n, feature) => {
        if (n === FEATURE_END) features.destroy(feature);
      },
    });
    void stones;
  }

  /** Dernière position des pieds d'un script de marche lancé depuis `from` (origine = départ moins la première case de l'image 0). */
  function scriptEnd(from: Readonly<Point>, scriptId: number): Point {
    const script = scrs(archive, scriptId);
    const origin = scriptAnchorOffset(script.images, from, false);
    const last = [...script.images].reverse().find((image) => (image.cells[0]?.w ?? 0) > 0)?.cells[0];
    return last ? { x: last.x + origin.x, y: last.y + origin.y } : { x: from.x, y: from.y };
  }

  /** Réaction d'un gardien en attente (`a0e6`) : jouée quand plus aucune voix ne joue. */
  function stepReaction(ctx: SceneContext): void {
    if (reaction === null) {
      if (finalVoice !== 0 && quiet()) {
        ctx.services.get(ZOOMBINIS_SOUND).queue(finalVoice);
        finalVoice = 0;
      }
      return;
    }
    if (!quiet()) return;
    const current = reaction;
    reaction = null;
    const release = (): void => {
      pop();
      busy = false;
    };
    if (finalVoice === 0) speak(ctx, current.pillar, current.script, current.release ? release : undefined);
    else if (current.release) release();
  }

  // -------------------------------------------------------------------------------------------------------------------------
  // Effondrement (`1190:14bc`, `1190:06ff` a0fe, `1190:15cd`)

  function startCollapse(ctx: SceneContext): void {
    const st = state!;
    st.collapsed = true;
    collapseStage = 1;
    // `14bc` : les quatre premières entrées de file libèrent leur entrée ; les Zoombinis redescendent, perdus.
    for (let i = 0; i < ENTRANCES; i++) {
      const head = queue[0];
      if (!head) break;
      if (head.kind === "walk") {
        const { slot } = head;
        const target = entranceTargets[head.verdict.entrance - 1]!;
        if (target.owner === slot.member) target.owner = null;
        slot.member.target = null;
        slot.status = "lost";
        slot.member.zoombini.present = false;
        slot.member.snoid.walkTo({ x: ENTRANCE_ANCHORS[head.verdict.entrance - 1]!.x, y: COLLAPSE_RETURN_Y });
      }
      pop();
    }
    queue = queue.filter((entry) => entry.kind !== "talk");
    queue.unshift(talkEntry(pick("collapse", TALK_COLLAPSE, ctx.rng)));
  }

  /** `a0fe = 2` : le plafond s'effondre (`SCRB` 7000, son 7000) ; à la fin, voix de regret possible. */
  function stepCeiling(ctx: SceneContext): void {
    if (collapseStage !== 2 || !ceiling) return;
    collapseStage = 3;
    ceiling.flags &= ~FeatureFlag.staticFirst;
    ceiling.onEvent = (_image, n) => {
      if (n !== FEATURE_END) return;
      collapseDone = true;
      regret(ctx);
    };
    ctx.services.get(FEATURES).setScript(ceiling, CEILING_SCRIPT);
  }

  /** `1190:15cd` : `rand(0..4) > niveau` ou peu de visites, au moins un sauvé et au moins un perdu. */
  function regret(ctx: SceneContext): void {
    const st = state!;
    const { game } = ctx.services.get(ZOOMBINIS_GAME);
    const roll = ctx.rng.range(0, 4);
    const index = dialogMemoryIndex(SCREEN);
    const few = index >= 0 && (game.dialogMemory[index]! & 0xfff) < 4;
    if ((st.rules.level < roll || few) && st.saved > 0 && st.saved < st.total) {
      ctx.services.get(ZOOMBINIS_SOUND).queue(ctx.rng.range(20045, 20048));
    }
  }

  // -------------------------------------------------------------------------------------------------------------------------
  // Encouragement et animations de victoire

  function stepIdle(ctx: SceneContext): void {
    if (state!.collapsed || kit!.departing) return;
    if (ctx.clock.ticks - lastAction > encourageAfter) {
      resetIdle(ctx);
      queueTalk(ctx, pick("encourage", TALK_ENCOURAGE, ctx.rng));
      encourageAfter = drawEncouragementDelay(ctx.rng);
    }
  }

  function stepDance(ctx: SceneContext): void {
    if (dancePlayed >= danceQuota) return;
    const period = ctx.services.get(ZOOMBINIS_GAME).game.options.lessAction ? DANCE_PERIOD_LESS : DANCE_PERIOD;
    const now = ctx.clock.ticks;
    if (now - danceAt <= period) return;
    danceAt = now;
    const members = kit!.members;
    for (let tries = 0; tries < 16; tries++) {
      const member = members[pool("dance", members.length).pick(ctx.rng)]!;
      const slot = slotOf(member);
      if (slot.status !== "arrived" || !member.snoid.resting) continue;
      const { snoid } = member;
      snoid.onEnd = () => {
        snoid.onEnd = undefined;
        snoid.idle();
      };
      snoid.play(DANCE_BASE + snoid.traits.feet, FeatureFlag.stopAtEnd);
      dancePlayed += 1;
      break;
    }
  }
}
