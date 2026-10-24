/**
 * Rockets (jeu de Nim), logique pure : règles, IA de Poly, tirages, adaptation du niveau, géométrie (screens/rockets.md §1, §2.3, §2.4, §3.2).
 *
 * Ni DOM, ni horloge, ni archive : tout le hasard passe par un `Rng` injecté (`MsvcRandom` du moteur, vecteurs de test à graine fixe) et
 * les tirages sans remise par `NoRepeatPool` (`10a8:13af`). La scène (`rockets.ts`) orchestre animations, sons et entrées par-dessus.
 *
 * Défaut d'origine reproduit : le compteur de victoires consécutives de Poly n'est jamais remis à 0 après une baisse de niveau
 * (`1070:0932` écrit `serieEnfant` au lieu de `seriePoly`, §1.5). Décision de la vague H : reproduit. L'interrupteur est
 * `RocketsRules.polyStreakResets` (défaut `false` = fidèle ; `true` = corrigé, symétrique de l'enfant).
 */
import { NoRepeatPool, type MsvcRandom } from "../engine/rng";
import type { ScrClip } from "../data/scr";

/** Ce que la logique demande au hasard : `range(lo, hi)` = `1018:04e1`, bornes incluses (`MsvcRandom` convient). */
export type Rng = Pick<MsvcRandom, "range" | "rand">;

// --- Règles ---

export type Mode = "poly" | "friend";
export type Winner = "child" | "poly";

export interface RocketsRules {
  /**
   * Remet `seriePoly` à 0 quand Poly baisse de niveau. `false` : défaut d'origine (la série reste à 2 et ne rebaisse plus tant que
   * l'enfant n'a pas gagné). `true` : correction symétrique de celle de l'enfant.
   */
  polyStreakResets: boolean;
}

export const DEFAULT_RULES: Readonly<RocketsRules> = { polyStreakResets: false };

export const MIN_TOTAL = 11;
export const MAX_TOTAL = 21;
export const MAX_POLY_LEVEL = 4;
export const START_POLY_LEVEL = 2;
export const MIN_MAX_TAKE = 2;
/** Limite M maximale : 5 contre Poly, 10 contre un ami. */
export const maxTakeCap = (mode: Mode): number => (mode === "poly" ? 5 : 10);

// --- Types de fusées (tables `DS:288e`, `28b8`, `28e2`, §2.4) ---

export const ROCKET_TYPE_COUNT = 21;
/** `SHPL` 30000 : forme pleine taille de chaque type (indice 1-based dans la liste, `DS:288e`). */
export const ROCKET_SHAPES: readonly number[] = [46, 22, 16, 58, 52, 61, 4, 28, 7, 19, 34, 37, 43, 25, 55, 49, 1, 31, 10, 40, 13];
/** Décalage x / y du script de vol par type (`DS:28b8`, `28e2`). */
export const ROCKET_OFFSET_X: readonly number[] = [9, 25, 25, 18, 15, 18, 18, 17, 29, 24, 16, 25, 23, 19, 19, 10, 26, 16, 12, 22, 17];
export const ROCKET_OFFSET_Y: readonly number[] = [100, 98, 100, 97, 93, 95, 97, 98, 97, 99, 100, 97, 95, 102, 96, 99, 97, 98, 99, 97, 99];
/** Taille de la forme pleine taille (§2.4 ; vérifiée contre les données par les tests). */
export const ROCKET_SIZES: readonly (readonly [number, number])[] = [
  [53, 90], [23, 89], [25, 90], [40, 87], [46, 88], [34, 87], [35, 90], [38, 89], [16, 87], [28, 90], [42, 88],
  [23, 89], [26, 87], [38, 89], [37, 87], [55, 90], [23, 90], [43, 90], [50, 90], [33, 89], [39, 90],
];

export const ROCKET_SHPL = 30000;
export const MASK_SHPL = 42000;

const TYPE_BY_SHAPE = new Map(ROCKET_SHAPES.map((shape, type) => [shape, type] as const));

/** Id `SHAP` de la forme pleine taille d'un type. */
export const rocketShapeId = (type: number): number => ROCKET_SHPL + ROCKET_SHAPES[type]! - 1;
/** Id `SHAP` du masque 1 bit d'un type (`SHPL` 42000, n° `⌊forme / 3⌋ + 1`). */
export const rocketMaskId = (type: number): number => MASK_SHPL + Math.floor(ROCKET_SHAPES[type]! / 3);
/** Id du script de vol d'un type (`SCR` 30000 + type ; la `SHPL` 30000 est résolue par le lecteur, décalage = type). */
export const flightScrId = (type: number): number => ROCKET_SHPL + type;
/** Id du script de disposition pour N fusées (`SCR` 30010 + N, jamais joué : lu pour les positions). */
export const layoutScrId = (total: number): number => 30010 + total;

/**
 * Zone d'écrêtage réécrite par `1070:1778` avant un vol (§2.5) : `gauche = x − 28b8[type]`, `droite = gauche + 72`, `bas = y + 28e2[type]`,
 * `haut = bas − 354` (repère écran, positions du script relatives à `(gauche, haut)`).
 */
export function flightClip(slot: { x: number; y: number }, type: number): ScrClip {
  const left = slot.x - ROCKET_OFFSET_X[type]!;
  const bottom = slot.y + ROCKET_OFFSET_Y[type]!;
  return { left, right: left + 72, bottom, top: bottom - 354 };
}

// --- Dispositions ---

export interface LayoutCell {
  type: number;
  x: number;
  y: number;
}

/** Emplacement : `type` `null` = fusée lancée (rectangle sans importance, jamais touché). */
export interface Slot {
  type: number | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Lit une disposition (`SCR` 30010 + N, une seule image) : une cellule par fusée, `x = gauche + position.x`, `y = haut + position.y`, type
 * retrouvé par l'indice de forme dans `DS:288e`. L'ordre des cellules est l'ordre de profondeur (les derniers sont devant) et de balayage de Poly.
 */
export function parseLayout(script: { clip: ScrClip; frames: readonly { cells: readonly { shape: number; x: number; y: number }[] }[] }, total: number): LayoutCell[] {
  const frame = script.frames[0];
  if (!frame) throw new Error("Rockets : disposition sans image");
  const cells = frame.cells.map((cell) => {
    const type = TYPE_BY_SHAPE.get(cell.shape);
    if (type === undefined) throw new Error(`Rockets : forme ${cell.shape} inconnue dans une disposition`);
    return { type, x: script.clip.left + cell.x, y: script.clip.top + cell.y };
  });
  if (cells.length !== total) throw new Error(`Rockets : la disposition de ${total} fusées compte ${cells.length} cellules`);
  return cells;
}

export function slotsFromLayout(layout: readonly LayoutCell[]): Slot[] {
  return layout.map(({ type, x, y }) => {
    const [w, h] = ROCKET_SIZES[type]!;
    return { type, x, y, w, h };
  });
}

// --- État d'une partie ---

export interface RocketsState {
  mode: Mode;
  /** N : fusées de la partie (11 à 21). */
  total: number;
  /** M : « Launch up to M Rockets ». */
  maxTake: number;
  slots: Slot[];
  /** `lancees` : fusées déjà lancées. */
  launched: number;
  /** `lanceesTour` : lancées par l'enfant dans son tour (mode Poly seulement ; reste à 0 en mode ami). */
  launchedThisTurn: number;
  /** `partieEnCours` : au moins un lancement depuis la dernière remise à zéro. */
  started: boolean;
  /** `niveauPoly` : 0 à 4, départ 2, jamais montré, jamais sauvegardé. */
  polyLevel: number;
  childStreak: number;
  polyStreak: number;
  /** `polyADejaJoue` : Poly a déjà joué dans cette partie (remis à 0 seulement en fin de partie, pas au Reset). */
  polyHasPlayed: boolean;
  /** Qui a lancé la dernière fusée (le gagnant en fin de partie). */
  lastMover: Winner | null;
}

/** État initial de la scène (`1070:0a37`) : mode Poly, N = 11, niveau 2, M tiré dans [2, 5]. `layout` : disposition de 11 fusées. */
export function createState(layout: readonly LayoutCell[], rng: Rng): RocketsState {
  return {
    mode: "poly",
    total: MIN_TOTAL,
    maxTake: rng.range(MIN_MAX_TAKE, 5),
    slots: slotsFromLayout(layout),
    launched: 0,
    launchedThisTurn: 0,
    started: false,
    polyLevel: START_POLY_LEVEL,
    childStreak: 0,
    polyStreak: 0,
    polyHasPlayed: false,
    lastMover: null,
  };
}

/**
 * Nouvelle partie de `total` fusées (`1070:1171`) : plateau rempli, compteurs de la partie à zéro. `polyHasPlayed` et les séries ne sont
 * **pas** touchés (une partie interrompue n'est ni une victoire ni une défaite, §1.5).
 */
export function newGame(state: RocketsState, total: number, layout: readonly LayoutCell[]): void {
  if (layout.length !== total) throw new Error(`Rockets : disposition de ${layout.length} fusées pour ${total}`);
  state.total = total;
  state.slots = slotsFromLayout(layout);
  state.launched = 0;
  state.launchedThisTurn = 0;
  state.started = false;
  state.lastMover = null;
}

export const remaining = (state: RocketsState): number => state.total - state.launched;
export const isFinished = (state: RocketsState): boolean => state.launched === state.total;
/** Fin de partie à traiter : toutes les fusées parties et au moins un lancement (`1070:08a6`). */
export const isOver = (state: RocketsState): boolean => state.started && isFinished(state);

/** Le clic sur le champ peut lancer une fusée : en mode ami aucune limite (§1.3), contre Poly au plus M par tour. */
export function canLaunch(state: RocketsState): boolean {
  if (isFinished(state)) return false;
  return state.mode === "friend" || state.launchedThisTurn < state.maxTake;
}

/** Lance l'emplacement `index` (`1070:1778` puis compteurs). `by` : l'enfant (ou un joueur en mode ami) ou Poly. */
export function launch(state: RocketsState, index: number, by: Winner): void {
  const slot = state.slots[index];
  if (!slot || slot.type === null) throw new Error(`Rockets : emplacement ${index} vide`);
  slot.type = null;
  state.launched++;
  state.started = true;
  state.lastMover = by;
  if (by === "child" && state.mode === "poly") state.launchedThisTurn++;
}

/** L'enfant a lancé M fusées et il en reste : Poly joue seule au tick suivant (`2850 = 1`, `1070:0a03`). */
export function autoTurnPending(state: RocketsState): boolean {
  return state.mode === "poly" && state.launchedThisTurn === state.maxTake && !isFinished(state);
}

export type PolyClick = "over" | "remind" | "play";

/** Clic sur Poly : partie finie (rejoue « appuie sur Reset »), aucun lancement dans le tour alors que la partie a commencé (rappel), ou Poly joue. */
export function polyClickKind(state: RocketsState): PolyClick {
  if (isFinished(state)) return "over";
  if (state.started && state.launchedThisTurn === 0) return "remind";
  return "play";
}

/** Fin de son coup : `lanceesTour = 0` (`1070:0879`). */
export function endPolyTurn(state: RocketsState): void {
  state.launchedThisTurn = 0;
  state.started = true;
}

/** M ne change qu'au début ou à la fin d'une partie (`1070:0353`). */
export const canChangeMaxTake = (state: RocketsState): boolean => state.launched === 0 || state.launched === state.total;

/** Bouclage de M : 5 → 2 contre Poly, 10 → 2 contre un ami. */
export function nextMaxTake(mode: Mode, m: number): number {
  return m >= maxTakeCap(mode) ? MIN_MAX_TAKE : m + 1;
}

/** Passage en mode Poly : M ramené à 3 s'il sort de [2, 5] (`0105` param 1). */
export function maxTakeForPoly(m: number): number {
  return m < MIN_MAX_TAKE || m > 5 ? 3 : m;
}

// --- IA de Poly (§1.4, `1070:06ce`–`0879`) ---

/**
 * Nombre de fusées que Poly lance. `R = remaining`, `M = maxTake`. Étape A : coup gagnant `t = R mod (M+1)`. Étape B : sans coup gagnant
 * (`t = 0`) tirage quelconque ≤ R ; sinon **erreur délibérée** (tirage ≠ t par rejet) sauf : après son premier coup, quand `R < M+1`
 * (fin de partie) ou, aux niveaux 1 à 4, quand `R ≤ (niveau+1)·M + 1`. Niveau 0 : erreur tant qu'un coup gagnant existe. Le premier coup d'une
 * partie est toujours une erreur.
 */
export function polyChooseTake(remainingRockets: number, maxTake: number, level: number, hasPlayed: boolean, rng: Rng): number {
  const R = remainingRockets;
  const M = maxTake;
  let t = R;
  while (t >= M + 1) t -= M + 1;
  if (t < 1) {
    let k: number;
    do k = rng.range(1, M);
    while (R < k);
    return k;
  }
  let mistake = true;
  if (hasPlayed) {
    if (R < M + 1) mistake = false;
    else if (level >= 1 && level <= MAX_POLY_LEVEL) mistake = !(R <= (level + 1) * M + 1);
  }
  if (!mistake) return t;
  // Un seul coup possible (R = 1 = t) : le rejet ne terminerait jamais ; inatteignable dans l'original (R ≥ 11 au premier coup, R < M+1 ensuite).
  if (Math.min(M, R) === 1 && t === 1) return t;
  let x: number;
  do {
    do x = rng.range(1, M);
    while (R < x);
  } while (x === t);
  return x;
}

/** Une fusée de Poly (étape D) : balaie les emplacements de 0 à N−1, chaque emplacement plein est retenu avec 30 % (`aléa[1,100] > 70`) ; recommence si aucun. `-1` : plateau vide. */
export function polyPickSlot(slots: readonly Slot[], rng: Rng, taken: ReadonlySet<number> = new Set()): number {
  const free = slots.some((slot, i) => slot.type !== null && !taken.has(i));
  if (!free) return -1;
  for (;;) {
    for (let i = 0; i < slots.length; i++) {
      if (slots[i]!.type === null || taken.has(i)) continue;
      if (rng.range(1, 100) > 70) return i;
    }
  }
}

/** Les `k` fusées d'un coup de Poly (sans les lancer : les emplacements déjà choisis sont écartés). */
export function polyPickSlots(slots: readonly Slot[], k: number, rng: Rng): number[] {
  const taken = new Set<number>();
  const picked: number[] = [];
  for (let n = 0; n < k; n++) {
    const index = polyPickSlot(slots, rng, taken);
    if (index < 0) break;
    taken.add(index);
    picked.push(index);
  }
  return picked;
}

// --- Adaptation du niveau (§1.5, `1070:08a6`–`0a03`) ---

/**
 * Fin de partie contre Poly. Victoire de Poly : `seriePoly++`, à 2 le niveau baisse (borné à 0). Victoire de l'enfant : `serieEnfant++`, à 2 le niveau monte
 * (borné à 4) et `serieEnfant` repart à 0. Dans les deux cas `polyADejaJoue` et la série adverse sont remis à 0. **Défaut d'origine** : la baisse remet
 * `serieEnfant` (déjà à 0) au lieu de `seriePoly` ; `rules.polyStreakResets` le corrige.
 */
export function applyGameResult(state: RocketsState, winner: Winner, rules: Readonly<RocketsRules> = DEFAULT_RULES): void {
  state.polyHasPlayed = false;
  if (winner === "poly") {
    state.childStreak = 0;
    state.polyStreak++;
    if (state.polyStreak === 2) {
      if (state.polyLevel > 0) state.polyLevel--;
      state.childStreak = 0;
      if (rules.polyStreakResets) state.polyStreak = 0;
    }
  } else {
    state.polyStreak = 0;
    state.childStreak++;
    if (state.childStreak === 2) {
      if (state.polyLevel < MAX_POLY_LEVEL) state.polyLevel++;
      state.childStreak = 0;
    }
  }
}

// --- Tirages sans remise et scripts de Poly (§2.5, §3.2) ---

/** Un script de Poly à jouer ; `interruptible` : un clic le coupe (`1d25(1, 0, id)`). */
export interface ScriptStep {
  scr: number;
  interruptible: boolean;
}

export const SCR_POLY_ENTER = 2000;
export const SCR_POLY_GREETING = 2100;
export const SCR_POLY_LEAVE = 9700;
export const SCR_GAME_OVER = 9200;

const FILLERS = [4800, 5000, 5100, 5200, 5300] as const;
/** `12ed(p, 1)` : ids possibles pour « je lance p fusées » (`DS:277a` à `27c0`), p de 1 à 5. */
const ANNOUNCE_TAKE: Readonly<Record<number, readonly number[]>> = {
  1: [5400, 5900, 6400, 6900, 7400, 7800, 8300],
  2: [5500, 6000, 6500, 7000, 7900, 8400],
  3: [5600, 6100, 6600, 7100, 7500, 8000, 8500],
  4: [5700, 6200, 6700, 7200, 7600, 8100, 8600],
  5: [5800, 6300, 6800, 7300, 7700, 8200, 8700],
};
const RARE = [8800, 8900] as const;
const POLY_WINS = [2500, 2600, 2700, 2800, 2900, 3000, 3100] as const;
const CHILD_WINS = [1300, 1400, 1500, 1600, 1700, 1800, 1900, 1200] as const;
const REMINDERS = [9300, 9400, 9500, 9600, 4900] as const;
const PROMPTS = [9300, 9400, 9500, 9600] as const;
const GOODBYES = [2200, 2300, 2400] as const;
/** `12ed(M, 8)` : annonce de la limite (pile ou face entre deux scripts pour M ≥ 3). */
const ANNOUNCE_MAX: Readonly<Record<number, readonly number[]>> = { 2: [3300], 3: [3900, 3600], 4: [4000, 3700], 5: [4100, 3800] };
/** Sons de lancement (`DS:27f8`). */
export const LAUNCH_SOUNDS = [3033, 3034, 3035, 3036, 3037, 3058, 3059, 3060, 3061, 3062, 3063, 3064] as const;

/** Tables de tirage sans remise (état global dans l'original, ici par visite de la scène). */
export class RocketsPools {
  readonly fillers = new NoRepeatPool(FILLERS.length);
  readonly take = new Map<number, NoRepeatPool>(Object.entries(ANNOUNCE_TAKE).map(([p, ids]) => [Number(p), new NoRepeatPool(ids.length)]));
  readonly polyWins = new NoRepeatPool(POLY_WINS.length);
  readonly childWins = new NoRepeatPool(CHILD_WINS.length);
  readonly reminders = new NoRepeatPool(REMINDERS.length);
  readonly prompts = new NoRepeatPool(PROMPTS.length);
  readonly goodbyes = new NoRepeatPool(GOODBYES.length);
  readonly launchSounds = new NoRepeatPool(LAUNCH_SOUNDS.length);
}

/** Son de lancement de chacun des 21 types (`1070:207b`, à chaque nouvelle partie) ; les 12 premiers sont distincts. */
export function drawLaunchSounds(pools: RocketsPools, rng: MsvcRandom): number[] {
  return Array.from({ length: ROCKET_TYPE_COUNT }, () => LAUNCH_SOUNDS[pools.launchSounds.pick(rng)]!);
}

const step = (scr: number, interruptible: boolean): ScriptStep => ({ scr, interruptible });

/**
 * `12ed(k, 1)` : Poly annonce `k` fusées. `aléa[0,100] ≥ 95` (6/101) : remarque rare (8800 ou 8900, pile ou face) à la place de l'annonce ; sinon,
 * un second `aléa[0,100] ≥ 95` fait jouer d'abord un geste d'attente ; puis l'annonce (rien si `k ∉ 1..5`). Aucun n'est interruptible.
 */
export function planAnnounceTake(k: number, rng: MsvcRandom, pools: RocketsPools): ScriptStep[] {
  if (rng.range(0, 100) >= 95) return [step(RARE[rng.rand(1)]!, false)];
  const steps: ScriptStep[] = [];
  if (rng.range(0, 100) >= 95) steps.push(step(FILLERS[pools.fillers.pick(rng)]!, false));
  const table = ANNOUNCE_TAKE[k];
  const pool = pools.take.get(k);
  if (table && pool) steps.push(step(table[pool.pick(rng)]!, false));
  return steps;
}

/** `12ed(M, 8)` : commentaire sur la limite M (interruptible ; rien si M ∉ 2..5). */
export function planAnnounceMaxTake(m: number, rng: MsvcRandom): ScriptStep[] {
  const ids = ANNOUNCE_MAX[m];
  if (!ids) return [];
  return [step(ids.length === 1 ? ids[0]! : ids[rng.rand(1)]!, true)];
}

/** `12ed(0, 2)` : « lance au moins une fusée ». */
export const planReminder = (rng: MsvcRandom, pools: RocketsPools): ScriptStep[] => [step(REMINDERS[pools.reminders.pick(rng)]!, false)];
/** `12ed(0, 9)` : invite « à toi » après un coup de Poly. */
export const planPrompt = (rng: MsvcRandom, pools: RocketsPools): ScriptStep[] => [step(PROMPTS[pools.prompts.pick(rng)]!, false)];
/** `12ed(0, 3)` : « la partie est finie, appuie sur Reset ». */
export const planGameOver = (): ScriptStep[] => [step(SCR_GAME_OVER, true)];
/** `12ed(0, 4)` : Poly se réjouit (elle a gagné). */
export const planPolyWins = (rng: MsvcRandom, pools: RocketsPools): ScriptStep[] => [step(POLY_WINS[pools.polyWins.pick(rng)]!, false)];
/** `12ed(0, 5)` : Poly félicite l'enfant. */
export const planChildWins = (rng: MsvcRandom, pools: RocketsPools): ScriptStep[] => [step(CHILD_WINS[pools.childWins.pick(rng)]!, false)];
/** `12ed(0, 6)` : au revoir (interruptible) puis départ (non interruptible). */
export const planFarewell = (rng: MsvcRandom, pools: RocketsPools): ScriptStep[] => [step(GOODBYES[pools.goodbyes.pick(rng)]!, true), step(SCR_POLY_LEAVE, false)];
/** Au revoir seul, sans le départ (bouton Exit : `1d25(1, 0, id)` puis fondu). */
export const planGoodbye = (rng: MsvcRandom, pools: RocketsPools): ScriptStep[] => [step(GOODBYES[pools.goodbyes.pick(rng)]!, true)];
/** `12ed(0, 7)` : entrée de Poly. */
export const planEnter = (): ScriptStep[] => [step(SCR_POLY_ENTER, false)];

/** Tous les ids de scripts de Poly que la scène peut jouer hors aide (contrôles de présence dans l'archive). */
export function allPolyScripts(): number[] {
  const ids = new Set<number>([SCR_POLY_ENTER, SCR_POLY_GREETING, SCR_POLY_LEAVE, SCR_GAME_OVER, ...FILLERS, ...RARE, ...POLY_WINS, ...CHILD_WINS, ...REMINDERS, ...PROMPTS, ...GOODBYES]);
  for (const list of Object.values(ANNOUNCE_TAKE)) for (const id of list) ids.add(id);
  for (const list of Object.values(ANNOUNCE_MAX)) for (const id of list) ids.add(id);
  return [...ids].sort((a, b) => a - b);
}

// --- Pavé de nombres (§2.3) ---

export const PAD_RECT = { left: 55, top: 339, right: 246, bottom: 376 } as const;
/** Position de la case `i` (0 à 11) dans le pavé : `(53 + 32·c, 337 + 19·r)`. */
export const padCellOrigin = (cell: number): { x: number; y: number } => ({ x: 53 + 32 * (cell % 6), y: 337 + 19 * Math.floor(cell / 6) });
/** Case du pavé touchée : 0 à 11 (11 = « ? »), `-1` hors du rectangle réduit (55, 339, 246, 376). */
export function padCell(x: number, y: number): number {
  if (x < PAD_RECT.left || x >= PAD_RECT.right || y < PAD_RECT.top || y >= PAD_RECT.bottom) return -1;
  const column = Math.min(5, Math.floor(((x - PAD_RECT.left) * 6) / 191));
  const row = Math.min(1, Math.floor(((y - PAD_RECT.top) * 2) / 37));
  return 6 * row + column;
}

export const PAD_RANDOM_CELL = 11;
export type PadChoice = { kind: "total"; total: number } | { kind: "random" };

/** Choix du pavé au point (x, y) : un nombre de fusées (11 à 21), le tirage « ? », ou `null` hors du pavé. */
export function choosePadValue(x: number, y: number): PadChoice | null {
  const cell = padCell(x, y);
  if (cell < 0) return null;
  return cell === PAD_RANDOM_CELL ? { kind: "random" } : { kind: "total", total: MIN_TOTAL + cell };
}

/** Case (0 à 10) du pavé qui représente N fusées. */
export const padCellOfTotal = (total: number): number => total - MIN_TOTAL;

/** Image du tirage « ? » : `aléa[11, 21]` différent de N et du tirage précédent (§2.3). */
export function nextRandomTotal(current: number, previous: number, rng: Rng): number {
  let n: number;
  do n = rng.range(MIN_TOTAL, MAX_TOTAL);
  while (n === current || n === previous);
  return n;
}

/** Les 15 images du tirage « ? » : la dernière est le nouveau N. */
export function randomTotalSequence(current: number, rng: Rng, frames = 15): number[] {
  const out: number[] = [];
  let previous = current;
  for (let i = 0; i < frames; i++) {
    previous = nextRandomTotal(current, previous, rng);
    out.push(previous);
  }
  return out;
}

// --- Test de clic sur un emplacement (§2.4) ---

/** Masque 1 bit d'un type (`SHAP` de `SHPL` 42000) : `pixels[dy × width + dx] === 1` = allumé. */
export interface MaskLike {
  width: number;
  height: number;
  pixels: ArrayLike<number>;
}

/**
 * Emplacement touché en (x, y), ou `-1` : balayage des derniers vers les premiers (le plus élevé est devant), rectangle `[gauche, droite[ × [haut, bas[`
 * puis bit du masque pixel-exact. Les emplacements vides (lancées) ne sont jamais touchés.
 */
export function hitTestSlots(slots: readonly Slot[], x: number, y: number, mask: (type: number) => MaskLike | undefined): number {
  for (let i = slots.length - 1; i >= 0; i--) {
    const slot = slots[i]!;
    if (slot.type === null) continue;
    if (x < slot.x || y < slot.y || x >= slot.x + slot.w || y >= slot.y + slot.h) continue;
    const m = mask(slot.type);
    if (!m) continue;
    const dx = x - slot.x;
    const dy = y - slot.y;
    if (dx >= m.width || dy >= m.height) continue;
    if (m.pixels[dy * m.width + dx] === 1) return i;
  }
  return -1;
}
