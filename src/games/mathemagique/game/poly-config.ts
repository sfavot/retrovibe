/**
 * Tables d'aide de Poly par activité (tâche G3), extraites des fiches d'écran. Données pures : ni archive ni moteur.
 *
 * Familles d'identifiants `\0SCR` de `POLLY.DAT` (113 scripts), une famille par activité, mêmes décalages :
 *
 * | décalage | rôle |
 * |---|---|
 * | `+0` | arrivée de Poly (silencieuse, non interruptible) |
 * | `+50` | départ de Poly |
 * | `+100` | grande présentation (la 1re fois) |
 * | `+150` / `+200` | couche d'encadrement avant / après une explication |
 * | `+250` | présentation courte |
 * | `+500 … +850` | explications par élément : Exit, Help, niveaux, pièces ou fragments, Reset, Rotate, télé / chevalet |
 * | `+2000 …` (par 50) | répliques de sortie quand on clique Poly (12 ou 13) |
 *
 * Hidden 25000, Sticklers 30000, Patterns 35000, Bowling 20000 (déduit). Répliques : Hidden 27000, Sticklers 32000, Patterns 37000,
 * Bowling 22000 (déduit). Pattern Windows (`PATFILL.DAT`) et Rockets (`NIM.DAT`) ont leurs propres scripts d'aide, dans leur archive.
 *
 * `confidence: "documented"` : ids lus dans la fiche de l'activité. `"inferred"` : déduit de la famille (voir le champ `inferred` des éléments).
 * Les ids de Hidden / Patterns pour le « avant / après » (exceptions) et l'arrivée de Patterns ne sont pas détaillés par les fiches : on applique les
 * exceptions de Sticklers (`sticklers.md` §5.4), seule fiche qui les donne.
 */
import type { RosterFieldName } from "../engine/roster";
import type { MsvcRandom } from "../engine/rng";

export type PolyActivityId = "hidden" | "patterns" | "sticklers" | "bowling" | "patternWindows" | "rockets";

/** Archive qui contient les scripts d'aide. `POLLY.DAT` est ouverte temporairement (puis libérée) ; les deux autres sont celles de la scène. */
export type PolyArchiveName = "POLLY.DAT" | "PATFILL.DAT" | "NIM.DAT";

/** Ce que la scène sait au moment du clic et que la table consulte. */
export interface PolyContext {
  /** Le menu des vignettes est affiché (groupe « vignettes » actif) : choisit l'explication de la télé / du chevalet. */
  menuShown?: boolean;
  /** Rockets : on joue contre un ami (Poly est un personnage hors jeu). */
  friendMode?: boolean;
  /** Pattern Windows : l'image est « variée » (aucune couleur sur plus des deux tiers des cellules, `1060:1b2d`). */
  variedImage?: boolean;
  /** Rockets : Poly est déjà à l'écran (son entrée `SCR 2000` n'est jouée que si elle est absente). */
  polyPresent?: boolean;
}

/** Une explication : `scr` (ou celui que choisit le contexte), éventuellement encadrée, éventuellement suivie d'autres scripts. */
export interface PolyTopic {
  scr: number | ((ctx: PolyContext) => number);
  /** Joue la couche `before` de l'activité avant le script (défaut vrai). */
  before?: boolean;
  /** Joue la couche `after` après le script (défaut vrai). */
  after?: boolean;
  /** Scripts enchaînés seulement si le précédent est allé au bout (Rockets, Pattern Windows : « puis »). */
  then?: readonly number[];
  /** Déduit de la famille ou des exceptions d'une autre activité, pas lu dans la fiche. */
  inferred?: boolean;
  /** Tous les ids que ce sujet peut jouer (pour les contrôles de présence dans l'archive). */
  ids: readonly number[];
}

/** Sortie de l'aide (clic sur Poly). */
export type PolyExit =
  | {
      kind: "tips";
      /** `base + 50 × r`, `r` dans `[0, count[`. */
      base: number;
      count: number;
      /** `rand`: `rand1(count)` (Hidden, Patterns, Sticklers : la fiche ne parle pas de tirage sans remise) ; `pool`: `NoRepeatPool` (`13af`, Pattern Windows). */
      pick: "rand" | "pool";
      /** Ids explicites de la table (Pattern Windows : `{1900, 2500…3400}`) ; à défaut `base + 50 × r`. */
      table?: readonly number[];
      /** Script de départ de Poly joué ensuite (non interruptible). */
      departure: number | null;
      /** Pattern Windows : si l'image est variée et `rand(100) < chance`, ce script remplace la réplique. */
      compliment?: { scr: number; chance: number };
    }
  | {
      kind: "custom";
      /** Scripts joués dans l'ordre ; un script interrompu arrête la suite. */
      sequence(ctx: PolyContext, rng: MsvcRandom): readonly number[];
      ids: readonly number[];
    };

export interface PolyConfig {
  id: PolyActivityId;
  archive: PolyArchiveName;
  /** Archive ouverte puis libérée par l'aide (vrai pour `POLLY.DAT`). */
  temporaryArchive: boolean;
  /** Translation `y` de l'animation : **0** pour `POLLY.DAT` et `PATFILL.DAT` (zones déjà à `bas = 432`), **40** pour `NIM.DAT` (`1070:1e05`, zones à `bas = 391`). */
  offsetY: number;
  /** Variable du roster « Poly a déjà présenté le jeu » (`ROSTER_FIELDS`). */
  introFlag: RosterFieldName;
  /** Arrivée de Poly (non interruptible), jouée à l'ouverture ; `null` : aucune. */
  arrival: number | null;
  /** Grande présentation (1re ouverture du joueur dans cette activité) et courte (suivantes). */
  introLong: number;
  introShort: number;
  /** Couches d'encadrement des explications. */
  before: number | null;
  after: number | null;
  /** Ticks sans clic ni survol après la présentation courte avant de rejouer la longue (300 partout). */
  idleTicks: number;
  /** Zone qui sauvegarde / restaure le fond sous les animations de Poly `(gauche, haut, droite, bas)` ; `null` : non documentée. */
  backgroundZone: readonly [number, number, number, number] | null;
  /** Zone cliquable de Poly (aide), `(gauche, haut, droite, bas)` ; `null` : table propre à la scène. */
  polyZone: readonly [number, number, number, number] | null;
  topics: Readonly<Record<string, PolyTopic>>;
  exit: PolyExit;
  confidence: "documented" | "inferred";
  /** Sources. */
  doc: string;
}

/** Clé de la zone « Poly » dans `PolyHelper.click` (sortie de l'aide). */
export const POLY_ZONE = "poly";

const topic = (scr: number, extra: Partial<Omit<PolyTopic, "scr" | "ids">> = {}): PolyTopic => ({ scr, ids: [scr, ...(extra.then ?? [])], ...extra });

/** Explication d'un élément d'écran : télé / chevalet choisit selon le menu. */
const screenTopic = (menu: number, play: number, extra: Partial<Omit<PolyTopic, "scr" | "ids">> = {}): PolyTopic => ({
  scr: (ctx) => (ctx.menuShown ? menu : play),
  ids: [menu, play],
  ...extra,
});

/**
 * Famille `POLLY.DAT` commune aux trois puzzles. Exceptions d'encadrement de `sticklers.md` §5.4 : pas d'« avant » pour Exit et pour une pièce,
 * pas d'« après » pour Exit et Help.
 */
function puzzleTopics(base: number, parts: { piece: number; screenMenu: number; screenPlay: number }, inferred: boolean): Record<string, PolyTopic> {
  const x = { inferred };
  return {
    exit: topic(base + 500, { before: false, after: false, ...x }),
    help: topic(base + 550, { after: false, ...x }),
    level: topic(base + 600, x),
    piece: topic(parts.piece, { before: false, ...x }),
    reset: topic(base + 750, x),
    rotate: topic(base + 800, x),
    screen: screenTopic(parts.screenMenu, parts.screenPlay, x),
  };
}

export const HIDDEN_POLY: PolyConfig = {
  id: "hidden",
  archive: "POLLY.DAT",
  temporaryArchive: true,
  offsetY: 0,
  introFlag: "hiddenPolyIntroSeen",
  arrival: 25000,
  introLong: 25100,
  introShort: 25250,
  before: 25150,
  after: 25200,
  idleTicks: 300,
  backgroundZone: [219, 274, 576, 432],
  polyZone: [311, 280, 388, 432],
  // hidden.md §3.7 : pièces 25700 ; télé 25850 si le menu est affiché, sinon 25650.
  topics: puzzleTopics(25000, { piece: 25700, screenMenu: 25850, screenPlay: 25650 }, true),
  exit: { kind: "tips", base: 27000, count: 12, pick: "rand", departure: 25050 },
  confidence: "documented",
  doc: "screens/hidden.md §3.7, §5",
};

export const PATTERNS_POLY: PolyConfig = {
  id: "patterns",
  archive: "POLLY.DAT",
  temporaryArchive: true,
  offsetY: 0,
  introFlag: "patternsPolyIntroSeen",
  // patterns.md §3.8 ne cite pas l'arrivée : 35000 par analogie avec 25000 / 30000 (même durée, zone de bas d'écran).
  arrival: 35000,
  introLong: 35100,
  introShort: 35250,
  before: 35150,
  after: 35200,
  idleTicks: 300,
  backgroundZone: [269, 274, 576, 432],
  polyZone: [362, 280, 438, 432],
  // patterns.md §3.8 : pièces 35650 ; cadre 35850 si le menu est affiché (`3200 & 1 = 0`), sinon 35700. (35900 existe dans l'archive, sans emploi documenté.)
  topics: puzzleTopics(35000, { piece: 35650, screenMenu: 35850, screenPlay: 35700 }, true),
  exit: { kind: "tips", base: 37000, count: 13, pick: "rand", departure: 35050 },
  confidence: "documented",
  doc: "screens/patterns.md §3.8",
};

export const STICKLERS_POLY: PolyConfig = {
  id: "sticklers",
  archive: "POLLY.DAT",
  temporaryArchive: true,
  offsetY: 0,
  introFlag: "sticklersPolyIntroSeen",
  arrival: 30000,
  introLong: 30100,
  introShort: 30250,
  before: 30150,
  after: 30200,
  idleTicks: 300,
  backgroundZone: [238, 269, 576, 432],
  polyZone: [311, 280, 388, 432],
  // sticklers.md §5.4 : fragment 30900, niveaux 30650, Help 30600, Reset 30750, Rotate 30800, Exit 30500, chevalet 30850 (menu) ou 30550.
  topics: {
    exit: topic(30500, { before: false, after: false }),
    help: topic(30600, { after: false }),
    level: topic(30650),
    piece: topic(30900, { before: false }),
    reset: topic(30750),
    rotate: topic(30800),
    screen: screenTopic(30850, 30550),
  },
  exit: { kind: "tips", base: 32000, count: 13, pick: "rand", departure: 30050 },
  confidence: "documented",
  doc: "screens/sticklers.md §5.4",
};

/**
 * Bowling : seuls l'ouverture (`POLLY.DAT`, drapeau `4d30`) et le menu de 13 sujets au plus (descripteurs `4fe2 + 0x32·(param − 1)`) sont décrits ;
 * les ids sont **déduits** de la famille 20000 (20500 … 21100 par 50 = 13 sujets) et l'ordre des sujets n'est pas relevé (bowling.md §4.3, §9).
 * À revalider à l'écoute avant la vague I.
 */
export const BOWLING_POLY: PolyConfig = {
  id: "bowling",
  archive: "POLLY.DAT",
  temporaryArchive: true,
  offsetY: 0,
  introFlag: "bowlingPolyIntroSeen",
  arrival: 20000,
  introLong: 20100,
  introShort: 20250,
  before: 20150,
  after: 20200,
  idleTicks: 300,
  backgroundZone: null,
  polyZone: null,
  topics: Object.fromEntries(
    Array.from({ length: 13 }, (_, i) => [`subject${i + 1}`, topic(20500 + 50 * i, { before: false, after: false, inferred: true })]),
  ),
  exit: { kind: "tips", base: 22000, count: 13, pick: "rand", departure: 20050 },
  confidence: "inferred",
  doc: "screens/bowling.md §4.3 (ids déduits de la famille 20000)",
};

/**
 * Pattern Windows (`PATFILL.DAT`, `pattern-windows.md` §1.7, §3.3, §3.5). Zones d'aide (rang → clé) : 2 print, 3 kaleidoscope, 4 faucet, 5 help,
 * 6 yuck, 7 exit, 8 title, 9 name, 10 version, 11 colors, 12 window. L'entrée en matière `2300` précède tout sauf Help (5) et Exit (7).
 */
export const PATTERN_WINDOWS_POLY: PolyConfig = {
  id: "patternWindows",
  archive: "PATFILL.DAT",
  temporaryArchive: false,
  offsetY: 0,
  introFlag: "patfillPolyIntroSeen",
  arrival: 1200,
  introLong: 1700,
  introShort: 1500,
  before: 2300,
  after: null,
  idleTicks: 300,
  backgroundZone: [248, 273, 576, 432],
  polyZone: [317, 280, 388, 432],
  topics: {
    print: topic(2100),
    kaleidoscope: topic(1100),
    faucet: topic(3600),
    help: topic(1400, { before: false }),
    yuck: topic(3500),
    exit: topic(3700, { before: false }),
    title: topic(2000),
    name: topic(1600),
    version: topic(2400),
    colors: topic(1000),
    window: topic(1000),
  },
  exit: {
    kind: "tips",
    base: 1900,
    count: 11,
    pick: "pool",
    table: [1900, 2500, 2600, 2700, 2800, 2900, 3000, 3100, 3200, 3300, 3400],
    departure: 1300,
    compliment: { scr: 1800, chance: 20 },
  },
  confidence: "documented",
  doc: "screens/pattern-windows.md §1.7, §3.3, §3.5",
};

/**
 * Rockets (`NIM.DAT`, `rockets.md` §1.8, §3 « Réactions de Poly »). Poly est ici l'adversaire (mode Poly) ou un guide (mode ami). Zones : 3 reset,
 * 4 help (visage), 5 friend, 6 polyButton, 7 field, 8 pad, 9 exit, 10 panel ; 1 et 2 = Poly (`POLY_ZONE`). Les scripts sont décalés de +40 en `y`.
 * Mode Poly : 4300 puis 4400 ; mode ami : un au revoir parmi {2200, 2300, 2400} puis 9700 (Poly part). Pas d'encadrement.
 */
export const ROCKETS_POLY: PolyConfig = {
  id: "rockets",
  archive: "NIM.DAT",
  temporaryArchive: false,
  offsetY: 40,
  introFlag: "rocketsHelpIntroSeen",
  arrival: 2000,
  introLong: 1100,
  introShort: 4500,
  before: null,
  after: null,
  idleTicks: 300,
  backgroundZone: null,
  polyZone: [472, 139, 527, 432],
  topics: {
    reset: topic(9200),
    help: topic(4600, { then: [4700] }),
    friend: topic(3200),
    polyButton: topic(9000, { then: [9100] }),
    field: topic(4200),
    pad: topic(3400, { then: [3500] }),
    exit: topic(9800),
    panel: topic(1000),
  },
  exit: {
    kind: "custom",
    sequence: (ctx, rng) => (ctx.friendMode ? [[2200, 2300, 2400][rng.rand1(3)]!, 9700] : [4300, 4400]),
    ids: [2200, 2300, 2400, 9700, 4300, 4400],
  },
  confidence: "documented",
  doc: "screens/rockets.md §1.8, §3",
};

export const POLY_CONFIGS: Readonly<Record<PolyActivityId, PolyConfig>> = {
  hidden: HIDDEN_POLY,
  patterns: PATTERNS_POLY,
  sticklers: STICKLERS_POLY,
  bowling: BOWLING_POLY,
  patternWindows: PATTERN_WINDOWS_POLY,
  rockets: ROCKETS_POLY,
};

/** Tous les ids `\0SCR` qu'une configuration peut jouer (arrivée, présentations, encadrement, sujets, sortie) : sert aux contrôles de présence. */
export function polyScriptIds(config: PolyConfig): number[] {
  const ids = new Set<number>();
  for (const id of [config.arrival, config.introLong, config.introShort, config.before, config.after]) if (id !== null) ids.add(id);
  for (const topic of Object.values(config.topics)) for (const id of topic.ids) ids.add(id);
  const exit = config.exit;
  if (exit.kind === "custom") for (const id of exit.ids) ids.add(id);
  else {
    if (exit.departure !== null) ids.add(exit.departure);
    if (exit.compliment) ids.add(exit.compliment.scr);
    for (const id of exit.table ?? Array.from({ length: exit.count }, (_, r) => exit.base + 50 * r)) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}
