import type { MsvcRandom } from "../../../../engine/mohawk/rng";

/**
 * Règles de la hutte à pizza (`PIZZA.MHK`, écran 9 ; `docs/zoombinis/puzzles/pizza.md`). Fonctions pures sans rendu : ingrédients par niveau, ensemble de base
 * (`1130:35e6`), répartition entre un et trois trolls (`1130:2669`), verdict (`1130:2a9d`), service et réactions (`1130:0d85`, `2c0b`, `5091`, `4620`, `415d`), assiettes
 * de l'historique (`1130:3aa6`, `478e`, `595f`), budget de repas, scène de départ (`1130:3893`), robot. Tout le hasard passe par le `MsvcRandom` reçu, dans l'ordre des tirages de
 * l'original (`1080:0028(n)` = `rng.rand(n)` : 0 à `n` inclus).
 *
 * Ce que voit le joueur : il compose un repas en basculant des ingrédients (cinq pizzas et zéro à trois sundaes) et le sert. Les trolls encore présents le jugent
 * dans l'ordre Arno, Willa, Shyler ; chaque ensemble aimé est un secret. Un repas **exactement** égal à l'ensemble aimé d'un troll le contente (il part avec sa pizza) ;
 * sinon il réagit selon qu'il y a un seul ingrédient de trop, plusieurs, ou que tout est aimé mais incomplet. Quand tous les trolls sont partis, le groupe entier passe.
 *
 * Points ouverts tranchés ici (étude §7, détail dans `pizza.md`) :
 *  - 1, ensemble aimé vide (niveau 1) : l'algorithme est repris tel quel ; un troll sans ingrédient aimé n'est content que d'un repas vide (**sûr** pour le code,
 *    que l'original ne corrige pas) ;
 *  - 3, livreur : toujours le premier Zoombini du groupe (`DS:8d14`, qui ferait passer au suivant, n'est jamais posé) ;
 *  - 4, budget épuisé : le code ne teste `DS:8d5a` qu'en `1130:4620` ; l'épuisement joue la réaction de fureur une fois, puis chaque repas manqué joue la réaction
 *    grognon, et le service reste permis (**probable** : l'étude y voyait une défaite, le code n'en pose aucune) ;
 *  - 5, paramètres de `595f` : le premier pousse A (ensemble le plus gros), le deuxième C (un autre ensemble), le troisième B (le plus gros, ≠ A), le quatrième D (le dernier
 *    ensemble) ; assiettes `{A, C}`, `{C, B}`, `{B, D}`, `{A, D}` (lu dans le désassemblage de `1130:2a07`, sûr) ;
 *  - 7, trolls : le rang `k` relie l'ensemble `8dc0 + 16 k`, l'état `8d52 + 2 k`, l'objet `SCRB` 8032 / 9034 / 10038 et la banque de scripts 8000 / 9000 / 10000 ;
 *    Arno, Willa, Shyler sont les noms des trois lignes de la table de débogage `1130:3355`, dans cet ordre (**sûr** pour le rang, **probable** pour le nom).
 *
 * Écarts assumés par rapport au code d'origine :
 *  - aucun pour le doublon : un repas déjà servi coûte un repas comme un manqué (`5091` pose `8d38`, puis `4620`), comme dans le code ; `duplicateCostsBudget` faux
 *    donne l'ancienne lecture de l'étude (gratuit) ;
 *  - l'historique n'a pas de limite de 28 repas (dans l'original, le 29e écrit au-delà du tableau `8e26`).
 */

/** Niveaux de difficulté (`1168:515d`, 0 à 3), nombre maximal de trolls et d'ingrédients. */
export const PIZZA_LEVELS = 4;
export const PIZZA_TROLLS = 3;
export const PIZZA_MAX_INGREDIENTS = 8;
/** Les cinq premiers ingrédients sont des pizzas (boutons 4 à 8), les trois suivants des sundaes (boutons 9 à 11). */
export const PIZZA_PIZZAS = 5;

/** Paramètres posés par Enter (`1130:0000`) pour un niveau. */
export interface PizzaLevelParams {
  /** Trolls présents (états `8d52`, `8d54`, `8d56` à 1). */
  readonly trolls: number;
  /** Nombre d'indices d'ingrédients (`8d5e`). */
  readonly ingredients: number;
  /** Probabilité d'un ingrédient dans la base, en pour mille (`8d60`). */
  readonly chance: number;
  /** Nombre minimal d'ingrédients aimés au total (`8d62`). */
  readonly minLiked: number;
  /** Repas manqués tolérés (`8d5a`). */
  readonly budget: number;
  /** Indice jamais aimé (et sans bouton) : la cinquième pizza au niveau 1, sinon −1. */
  readonly excluded: number;
}

export const PIZZA_LEVEL_PARAMS: readonly PizzaLevelParams[] = [
  { trolls: 1, ingredients: 5, chance: 500, minLiked: 2, budget: 6, excluded: -1 },
  { trolls: 2, ingredients: 7, chance: 800, minLiked: 3, budget: 7, excluded: 4 },
  { trolls: 3, ingredients: 7, chance: 1000, minLiked: 3, budget: 7, excluded: -1 },
  { trolls: 3, ingredients: 8, chance: 1000, minLiked: 4, budget: 7, excluded: -1 },
];

/** Troll `k` : 0 Arno, 1 Willa, 2 Shyler. */
export const TROLL_NAMES = ["Arno", "Willa", "Shyler"] as const;
/** Objet `SCRB` de chaque troll (`8d48`, `8d4a`, `8d4c`) : son introduction et sa pose d'attente. */
export const TROLL_OBJECT = [8032, 9034, 10038] as const;
/** Script du troll content qui part avec sa pizza (`0d85` : `0x1f55`, `9027`, `10031`) et du troll qui lance l'assiette (`415d` : `0x1f54`, `9026`, `10030`). */
export const TROLL_LEAVE = [8021, 9027, 10031] as const;
export const TROLL_THROW = [8020, 9026, 10030] as const;

/** Verdict d'un troll sur un repas (`1130:2a9d`) : 0 un seul ingrédient de trop, 1 incomplet, 2 parfait, 4 plusieurs de trop. */
export type Verdict = 0 | 1 | 2 | 4;
export const VERDICT_ONE_EXTRA = 0;
export const VERDICT_INCOMPLETE = 1;
export const VERDICT_PERFECT = 2;
export const VERDICT_MANY_EXTRA = 4;

/** État d'un troll (`8d52`…) : absent (0), présent (1), content (2 ; 3 « parti » est le même pour les règles). */
export type TrollState = "absent" | "present" | "content";

/** Type d'assiette de l'historique (`8e4a`) : 4 commune, 5 à 7 celle d'Arno, Willa, Shyler (le premier troll au verdict « incomplet »). */
export type PlateType = 4 | 5 | 6 | 7;

/** Un repas laissé dans l'historique (assiette visible) : son masque (bit k = ingrédient k), son type et l'emplacement de sa feuille. */
export interface PizzaPlate {
  mask: number;
  type: PlateType;
  /** Emplacement (type 4 : 0 à 15, sauf 13 ; types 5 à 7 : 0 à 2) et script `SCRB` de l'assiette (12025 + n, ou 12016 + 3 (type − 5) + n). */
  slot: number;
  script: number;
  /** L'emplacement a déjà servi (la feuille existante est rejouée avec le nouveau repas, `478e`). */
  reuse: boolean;
  /** Assiette de départ du niveau 3 (`595f`, scripts 12041 à 12044) : posée sans animation de chute. */
  initial: boolean;
}

export interface PizzaOptions {
  /** Un repas déjà servi compte comme un repas manqué (`5091` → `8d38` → `4620`). Vrai par défaut, comme le code ; faux = gratuit (ancienne lecture de l'étude). */
  duplicateCostsBudget?: boolean;
}

/** Compteurs de répliques (`8df0…8e02`) : une réplique différente à chaque réaction. */
interface TrollLines {
  /** Verdicts 0, 1 et 4 (indice 0, 1, 2). */
  oneExtra: number;
  incomplete: number;
  manyExtra: number;
}

export interface PizzaState {
  readonly level: number;
  readonly params: PizzaLevelParams;
  readonly options: Required<PizzaOptions>;
  /** Ensemble de base (`8db0`) et ensembles aimés (`8dc0`, `8dd0`, `8de0`), masques. */
  readonly base: number;
  readonly liked: readonly number[];
  /** Repas en cours de composition (`8e04`), masque. */
  meal: number;
  /** Dernier repas servi (`8e14`). */
  served: number;
  trolls: TrollState[];
  /** Repas manqués tolérés restants (`8d5a`) ; devient négatif après l'épuisement. */
  budget: number;
  /** Repas de l'historique (`8e26`) : les assiettes de départ du niveau 3 puis les repas manqués. */
  history: number[];
  plates: PizzaPlate[];
  /** Nombre de repas servis (hors doublons) et de manqués (compteur d'erreurs). */
  servedCount: number;
  missedCount: number;
  /** Le budget a été épuisé au moins une fois. */
  exhausted: boolean;
  /** Livreur (`8d10`) : rang dans le groupe, 0 (le premier). */
  readonly deliverer: number;
  /** @internal Compteurs de répliques par troll, et curseurs d'emplacements des assiettes. */
  lines: TrollLines[];
  cursors: { common: number; lap: number; troll: [number, number, number] };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Ensembles (masques de bits : le bit k est l'ingrédient k)

export function popcount(mask: number): number {
  let n = 0;
  for (let m = mask; m !== 0; m >>>= 1) n += m & 1;
  return n;
}

export function has(mask: number, k: number): boolean {
  return ((mask >> k) & 1) === 1;
}

/** Indices des ingrédients d'un masque, croissants. */
export function ingredientsOf(mask: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < PIZZA_MAX_INGREDIENTS; k++) if (has(mask, k)) out.push(k);
  return out;
}

/** Indices des ingrédients qui ont un bouton au niveau (`1130:1803`, `1e08`) : 0 à 4 (sauf 4 au niveau 1) puis les sundaes. */
export function availableIngredients(level: number): number[] {
  const params = PIZZA_LEVEL_PARAMS[level];
  if (!params) throw new RangeError(`pizza : niveau ${level} hors de 0 à 3`);
  const out: number[] = [];
  for (let k = 0; k < params.ingredients; k++) if (k !== params.excluded) out.push(k);
  return out;
}

/**
 * Ensemble de base (`1130:35e6`). Une passe parcourt les indices et tire `rand(1000)` pour chacun, même quand le reste est atteint ; un indice est pris si le
 * tirage est sous `chance`, s'il n'y est pas déjà et n'est pas l'indice exclu ; on recommence jusqu'à avoir pris `minLiked` ingrédients. Au niveau 3 la base
 * contient donc presque tout.
 */
export function drawBase(rng: MsvcRandom, params: PizzaLevelParams): number {
  let base = 0;
  let rest = params.minLiked;
  let added = false;
  do {
    for (let k = 0; k < params.ingredients; k++) {
      const roll = rng.rand(1000);
      if (roll < params.chance && !has(base, k) && k !== params.excluded) {
        base |= 1 << k;
        rest -= 1;
        added = true;
      }
    }
  } while (rest > 0);
  // Cas impossible dans l'original (`bVar1` reste vrai) : un ingrédient tiré dans 0 à 3.
  if (!added) base |= 1 << rng.rand(3);
  return base;
}

/** `1130:2a29(k)` : un indice de l'ensemble du troll `k`, tiré dans 0 à `ingredients − 1` jusqu'à tomber sur un ingrédient aimé. */
function drawFrom(rng: MsvcRandom, params: PizzaLevelParams, set: number): number {
  let k: number;
  do {
    k = rng.rand(params.ingredients - 1);
  } while (!has(set, k));
  return k;
}

/** Retire un ingrédient tiré de `from` (`rand` jusqu'à un ingrédient présent) et le range dans `to` (boucle de réparation de `1130:2669`). */
function move(sets: number[], from: number, to: number, rng: MsvcRandom, params: PizzaLevelParams): void {
  const k = drawFrom(rng, params, sets[from]!);
  sets[from]! &= ~(1 << k);
  sets[to]! |= 1 << k;
}

export interface PizzaSplit {
  base: number;
  liked: number[];
  /** Quatre assiettes de départ (niveau 3) : masques `{A, C}`, `{C, B}`, `{B, D}`, `{A, D}`. */
  startPlates: number[];
}

/**
 * Répartition de la base entre les trolls (`1130:2669`, appelée après `35e6`) :
 *  - niveau 0 : tout à Arno ;
 *  - niveau 1 : chaque ingrédient de la base à Arno ou à Willa (`rand(1)`) ; si les deux ensembles sont vides, un ingrédient tiré va à l'un ou à l'autre.
 *    Rien ne garantit que les deux soient non vides ; un ensemble vide n'est content que d'un repas vide ;
 *  - niveaux 2 et 3 : `rand(2)` pour chacun, puis une boucle de réparation jusqu'à trois ensembles non vides ;
 *  - niveau 3 : quatre assiettes de départ tirées dans le plus gros ensemble (deux ingrédients) et dans chacun des deux autres.
 */
export function drawSplit(rng: MsvcRandom, level: number): PizzaSplit {
  const params = PIZZA_LEVEL_PARAMS[level];
  if (!params) throw new RangeError(`pizza : niveau ${level} hors de 0 à 3`);
  const base = drawBase(rng, params);
  const sets = [0, 0, 0];
  const counts = [0, 0, 0];
  let startPlates: number[] = [];
  if (level === 0) {
    sets[0] = base;
  } else if (level === 1) {
    for (let k = 0; k < params.ingredients; k++) {
      if (!has(base, k)) continue;
      const to = rng.rand(1);
      sets[to]! |= 1 << k;
      counts[to]! += 1;
    }
    if (counts[0] === 0 && counts[1] === 0) {
      const k = rng.rand(params.ingredients - 1);
      const roll = rng.rand(1000);
      if (roll < 500) sets[1]! |= 1 << k;
      else sets[0]! |= 1 << k;
    }
  } else {
    for (let k = 0; k < params.ingredients; k++) {
      if (!has(base, k)) continue;
      const to = rng.rand(2);
      sets[to]! |= 1 << k;
      counts[to]! += 1;
    }
    // Boucle de réparation : chaque ensemble vide reçoit un ingrédient tiré dans le donneur voulu (a, w, s = Arno, Willa, Shyler).
    do {
      if (counts[0] === 0) {
        const from = counts[2]! < counts[1]! ? 1 : 2;
        move(sets, from, 0, rng, params);
        counts[from]! -= 1;
        counts[0] = 1;
      }
      if (counts[1] === 0) {
        const from = counts[2]! < counts[0]! ? 0 : 2;
        move(sets, from, 1, rng, params);
        counts[from]! -= 1;
        counts[1] = 1;
      }
      if (counts[2] === 0) {
        const from = counts[1]! < counts[0]! ? 0 : 1;
        move(sets, from, 2, rng, params);
        counts[from]! -= 1;
        counts[2] = 1;
      }
    } while (counts[0] === 0 || counts[1] === 0 || counts[2] === 0);
    if (level === 3) {
      // Le plus gros ensemble : comparaisons strictes, en cas d'égalité le plus petit indice gagne.
      let big = 0;
      if (counts[0]! < counts[1]!) {
        big = 1;
        if (counts[1]! < counts[2]!) big = 2;
      } else if (counts[0]! < counts[2]!) {
        big = 2;
      }
      const others = [0, 1, 2].filter((k) => k !== big);
      const a = drawFrom(rng, params, sets[big]!);
      let b: number;
      do {
        b = drawFrom(rng, params, sets[big]!);
      } while (b === a);
      const c = drawFrom(rng, params, sets[others[0]!]!);
      const d = drawFrom(rng, params, sets[others[1]!]!);
      const pair = (x: number, y: number) => (1 << x) | (1 << y);
      startPlates = [pair(a, c), pair(c, b), pair(b, d), pair(a, d)];
    }
  }
  return { base, liked: sets, startPlates };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Verdict

/**
 * `1130:2a9d` : verdict d'un troll d'ensemble aimé `liked` sur le repas `meal`. `trop` = ingrédients servis non aimés, `bon` = aimés ; un seul de trop → 0, plusieurs → 4
 * (même si tout le reste est aimé) ; sinon parfait (2) si tout l'ensemble est servi, incomplet (1) s'il en manque. Un repas vide est donc incomplet pour un ensemble
 * non vide et parfait pour un ensemble vide.
 */
export function verdictOf(liked: number, meal: number): Verdict {
  const extra = popcount(meal & ~liked);
  if (extra === 1) return VERDICT_ONE_EXTRA;
  if (extra > 1) return VERDICT_MANY_EXTRA;
  return popcount(meal & liked) === popcount(liked) ? VERDICT_PERFECT : VERDICT_INCOMPLETE;
}

// ---------------------------------------------------------------------------------------------------------------------------
// État

/** Nouvelle épreuve : tire la base, la répartition et (niveau 3) les assiettes de départ, dans l'ordre de l'original. */
export function newPizza(rng: MsvcRandom, level: number, options: PizzaOptions = {}): PizzaState {
  const params = PIZZA_LEVEL_PARAMS[level];
  if (!params) throw new RangeError(`pizza : niveau ${level} hors de 0 à 3`);
  const split = drawSplit(rng, level);
  const state: PizzaState = {
    level,
    params,
    options: { duplicateCostsBudget: options.duplicateCostsBudget ?? true },
    base: split.base,
    liked: split.liked.slice(0, params.trolls),
    meal: 0,
    served: 0,
    trolls: Array.from({ length: PIZZA_TROLLS }, (_, k) => (k < params.trolls ? "present" : "absent")),
    budget: params.budget,
    history: [],
    plates: [],
    servedCount: 0,
    missedCount: 0,
    exhausted: false,
    deliverer: 0,
    lines: Array.from({ length: PIZZA_TROLLS }, () => ({ oneExtra: 0, incomplete: 0, manyExtra: 0 })),
    cursors: { common: -1, lap: 0, troll: [-1, -1, -1] },
  };
  for (const mask of split.startPlates) addPlate(state, mask, 4, true);
  return state;
}

/** Ajoute le repas `mask` à l'historique (`3aa6`) et choisit l'assiette visible (`478e`, ou `595f` pour celles de départ). */
function addPlate(state: PizzaState, mask: number, type: PlateType, initial: boolean): PizzaPlate {
  state.history.push(mask);
  const cursors = state.cursors;
  let plate: PizzaPlate;
  if (type === 4) {
    let n = cursors.common + 1;
    if (n < 16) {
      if (n === 13) n = 14;
    } else {
      n = 0;
      cursors.lap += 1;
    }
    cursors.common = n;
    // Les quatre assiettes de départ utilisent les scripts 12041 à 12044 (mêmes places que 12025 à 12028), sans chute.
    const script = initial ? 12041 + n : 12025 + n;
    plate = { mask, type, slot: n, script, reuse: cursors.lap > 0, initial };
  } else {
    const k = type - 5;
    const n = (cursors.troll[k]! + 1) % 3;
    cursors.troll[k] = n;
    plate = { mask, type, slot: n, script: 12016 + 3 * k + n, reuse: false, initial: false };
  }
  state.plates.push(plate);
  return plate;
}

/** Les ingrédients qui ont un bouton au niveau. */
export function canToggle(state: PizzaState, k: number): boolean {
  return Number.isInteger(k) && k >= 0 && k < state.params.ingredients && k !== state.params.excluded;
}

/** `1130:1e08` : bascule l'ingrédient `k` du repas en cours ; renvoie son nouvel état, ou null s'il n'a pas de bouton à ce niveau. */
export function toggleIngredient(state: PizzaState, k: number): boolean | null {
  if (!canToggle(state, k)) return null;
  state.meal ^= 1 << k;
  return has(state.meal, k);
}

/** Tous les trolls présents au départ sont contents (`8d9c`) : l'épreuve est réussie, le bouton « go » devient actif. */
export function allSatisfied(state: PizzaState): boolean {
  return state.trolls.every((t) => t !== "present");
}

/** Rangs des trolls encore présents (état 1), dans l'ordre Arno, Willa, Shyler. */
export function presentTrolls(state: PizzaState): number[] {
  return state.trolls.flatMap((t, k) => (t === "present" ? [k] : []));
}

/** Le repas `mask` figure déjà dans l'historique (`1130:3b38`). */
export function isDuplicate(state: PizzaState, mask: number): boolean {
  return state.history.includes(mask);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Réactions

/** Ce que joue un troll : son rang, le script `SCRB` (banque du troll), et le verdict dont il vient (`null` : doublon). */
export interface TrollReaction {
  troll: number;
  script: number;
  verdict: Verdict | null;
  /** « again » : réplique d'un doublon (`5091`). */
  kind: "oneExtra" | "incomplete" | "perfect" | "manyExtra" | "again" | "incompleteAgain";
}

/** Réplique d'un verdict (`1130:2c0b`) : script `base + compteur`, le compteur avance (boucle sur `modulo`, ou plafonne au dernier) ; parfait : `rand`. */
function lineFor(state: PizzaState, rng: MsvcRandom, troll: number, verdict: Verdict, advance = true): number {
  const lines = state.lines[troll]!;
  switch (verdict) {
    case VERDICT_ONE_EXTRA: {
      const base = [8006, 9000, 10014][troll]!;
      const modulo = [2, 5, 6][troll]!;
      const script = base + lines.oneExtra;
      if (advance) lines.oneExtra = (lines.oneExtra + 1) % modulo;
      return script;
    }
    case VERDICT_INCOMPLETE: {
      const base = [8000, 9021, 10009][troll]!;
      const cap = [5, 4, 4][troll]!;
      const script = base + lines.incomplete;
      if (advance) lines.incomplete = Math.min(lines.incomplete + 1, cap);
      return script;
    }
    case VERDICT_MANY_EXTRA: {
      const base = [8008, 9005, 10020][troll]!;
      const modulo = [6, 5, 3][troll]!;
      const script = base + lines.manyExtra;
      if (advance) lines.manyExtra = (lines.manyExtra + 1) % modulo;
      return script;
    }
    default: {
      const draws = [1, 6, 3][troll]!;
      return [8017, 9010, 10023][troll]! + rng.rand(draws);
    }
  }
}

/** Troll qui grogne devant un doublon (`1130:5091`, tirage d'un troll présent). */
function pickGrumbler(state: PizzaState, rng: MsvcRandom): number {
  const [a, w, s] = state.trolls.map((t) => t === "present");
  if (a) {
    if (w || s) {
      if (w && !s) return rng.rand(1);
      if (w && s) return rng.rand(2);
      return rng.rand(1) * 2;
    }
    return 0;
  }
  if (w) return s ? rng.rand(1) + 1 : 1;
  return 2;
}

/** Réplique du doublon (`5091(0, …)`) : `8015 + rand(1)`, `9017 + rand(1)`, `10027 + rand(2)`. */
function againLine(rng: MsvcRandom, troll: number): number {
  return [8015, 9017, 10027][troll]! + rng.rand([1, 1, 2][troll]!);
}

/** Script de fureur (`4620`, premier troll présent) : `8022`, `9028` ou `10032` plus 1 à l'épuisement du budget, plus 0 ensuite. */
function furyScript(troll: number, atExhaustion: boolean): number {
  return [8022, 9028, 10032][troll]! + (atExhaustion ? 1 : 0);
}

/** Résultat d'un service. */
export interface PizzaServe {
  /** Repas servi (masque), et s'il figurait déjà dans l'historique. */
  meal: number;
  duplicate: boolean;
  /** Réactions dans l'ordre des animations : un troll content arrête la chaîne ; un doublon n'a qu'une réplique. */
  reactions: TrollReaction[];
  /** Troll devenu content (et qui part avec sa pizza, `TROLL_LEAVE`), ou null. */
  perfect: number | null;
  /** Le repas manqué entame le budget (`4620`) : aucun troll content (et pas un doublon gratuit). */
  missed: boolean;
  budgetBefore: number;
  budgetAfter: number;
  /** Troll qui joue la fureur et son script (`8022 + 8d80`), ou null (le livreur revient alors à la file : `4571`). */
  fury: { troll: number; script: number } | null;
  /** Troll qui lance l'assiette (`415d` : `8daa` ou le dernier insatisfait), et l'assiette de l'historique, ou null. */
  thrower: number | null;
  plate: PizzaPlate | null;
  /** Le livreur retourne à la file (budget non épuisé, ou repas parfait, ou doublon). */
  delivererReturns: boolean;
  /** Tous les trolls sont partis : scène de départ (`3893`) puis « go » actif. */
  allSatisfied: boolean;
}

/**
 * Sert le repas en cours (`1130:1803` régions 3 et 12, puis `0d85`) : les bascules sont remises à zéro (`55d9`) et `served` garde le repas. Doublon (`3b38`) :
 * pas de verdict, un troll grogne (le premier au verdict « incomplet », sinon un tiré), et le repas coûte comme un manqué (sauf `duplicateCostsBudget` faux). Sinon les trolls présents
 * réagissent à tour de rôle ; le premier content part avec sa pizza et arrête la chaîne : les suivants ne jugent pas ce repas et il ne coûte rien. Si aucun n'est
 * content, le repas manqué entame le budget (`4620`) : au dernier toléré le premier troll présent est furieux, ensuite grognon (le livreur ne revient plus) ; le troll
 * qui a réagi en dernier lance l'assiette (celui du premier verdict « incomplet » s'il y en a un), et le repas entre dans l'historique.
 *
 * Renvoie null si l'épreuve est déjà gagnée (le service est alors refusé, `8d9c`).
 */
export function serveMeal(state: PizzaState, rng: MsvcRandom): PizzaServe | null {
  if (allSatisfied(state)) return null;
  const meal = state.meal;
  state.meal = 0;
  state.served = meal;
  const duplicate = isDuplicate(state, meal);
  const present = presentTrolls(state);
  const reactions: TrollReaction[] = [];
  const result: PizzaServe = {
    meal,
    duplicate,
    reactions,
    perfect: null,
    missed: false,
    budgetBefore: state.budget,
    budgetAfter: state.budget,
    fury: null,
    thrower: null,
    plate: null,
    delivererReturns: true,
    allSatisfied: false,
  };
  let last: number | null = null;
  let firstIncomplete: number | null = null;
  if (duplicate) {
    // `0d85`, branche du doublon : le premier troll au verdict « incomplet » grogne (`5091(1, k)`, réplique « incomplet » sans avancer le compteur), sinon un troll tiré.
    const incomplete = present.find((k) => verdictOf(state.liked[k]!, meal) === VERDICT_INCOMPLETE);
    if (incomplete !== undefined) {
      const base = [8000, 9021, 10009][incomplete]!;
      reactions.push({ troll: incomplete, script: base + state.lines[incomplete]!.incomplete, verdict: null, kind: "incompleteAgain" });
      firstIncomplete = incomplete;
      last = incomplete;
    } else {
      const k = pickGrumbler(state, rng);
      reactions.push({ troll: k, script: againLine(rng, k), verdict: null, kind: "again" });
      last = k;
    }
  } else {
    for (const k of present) {
      const verdict = verdictOf(state.liked[k]!, meal);
      const kind = verdict === VERDICT_PERFECT ? "perfect" : verdict === VERDICT_INCOMPLETE ? "incomplete" : verdict === VERDICT_ONE_EXTRA ? "oneExtra" : "manyExtra";
      reactions.push({ troll: k, script: lineFor(state, rng, k, verdict), verdict, kind });
      if (verdict === VERDICT_PERFECT) {
        state.trolls[k] = "content";
        result.perfect = k;
        break;
      }
      if (verdict === VERDICT_INCOMPLETE && firstIncomplete === null) firstIncomplete = k;
      last = k;
    }
  }
  result.allSatisfied = allSatisfied(state);
  if (result.perfect !== null) return result;

  // Aucun troll content (ou doublon) : `8d38` ≠ 0, `4620`.
  const costs = !duplicate || state.options.duplicateCostsBudget;
  if (!costs) return result;
  result.missed = true;
  state.missedCount += 1;
  state.servedCount += 1;
  const before = state.budget;
  state.budget = before - 1;
  result.budgetAfter = state.budget;
  const atExhaustion = before > 0 && state.budget === 0;
  if (atExhaustion) state.exhausted = true;
  if (before >= 2) {
    // Normal : le livreur revient à la file (`4571`).
    result.delivererReturns = true;
  } else {
    result.delivererReturns = false;
    const troll = present[0]!;
    result.fury = { troll, script: furyScript(troll, atExhaustion) };
  }
  // `415d` : le troll de `8daa` (premier « incomplet »), sinon le dernier qui a réagi, lance l'assiette ; `3aa6` range le repas, `478e` pose l'assiette.
  const thrower = firstIncomplete ?? last;
  result.thrower = thrower;
  const type: PlateType = firstIncomplete !== null ? ((5 + firstIncomplete) as PlateType) : 4;
  result.plate = addPlate(state, meal, type, false);
  return result;
}

/** Scène de départ (`1130:3893`) quand tous les trolls sont partis : script de chaque troll, selon la composition, avec le même `rand(1)` pour tous. */
export function departureScripts(state: PizzaState, rng: MsvcRandom): { troll: number; script: number }[] {
  const r = rng.rand(1);
  const count = state.params.trolls;
  if (count === 1) return [{ troll: 0, script: 8024 + r }];
  if (count === 2) return [{ troll: 0, script: 8026 + r }, { troll: 1, script: 9030 + r }];
  return [{ troll: 0, script: 8030 + r }, { troll: 1, script: 9032 + r }, { troll: 2, script: 10036 + r }];
}

/** Réplique d'introduction d'un troll (`4de0`, après les présentations) : Arno 8014 au niveau 0, Willa 9019 + `rand(1)` au niveau 1, Shyler 10001 + `rand(7)` ensuite. */
export function hintScript(state: PizzaState, rng: MsvcRandom): { troll: number; script: number } {
  if (state.level === 0) return { troll: 0, script: 8014 };
  if (state.level === 1) return { troll: 1, script: 9019 + rng.rand(1) };
  return { troll: 2, script: 10001 + rng.rand(7) };
}

/** Animation d'ambiance (`1130:5d0b`, toutes les 3600 ticks à l'arrêt) : un troll présent et son script, ou null. */
export function ambientScript(state: PizzaState, rng: MsvcRandom): { troll: number; script: number } | null {
  const present = state.trolls;
  const arno = () => ({ troll: 0, script: 8034 + rng.rand(1) });
  const willa = () => ({ troll: 1, script: 9019 + rng.rand(1) });
  switch (state.level) {
    case 0:
      return present[0] !== "content" ? arno() : null;
    case 1: {
      if (rng.rand(1000) < 500 && present[0] === "present") return arno();
      return present[1] === "present" ? willa() : null;
    }
    default: {
      const roll = rng.rand(1000);
      if (roll < 300 && present[0] === "present") return arno();
      if (roll < 600 && present[1] === "present") return willa();
      if (present[2] === "present") {
        const r = rng.rand(3);
        return { troll: 2, script: 10000 + (r === 0 ? 1 : r + 5) };
      }
      return null;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Sortie

/** Le bouton « go » est actif quand tous les trolls sont partis (`8d20`). */
export function canContinue(state: PizzaState): boolean {
  return allSatisfied(state);
}

/**
 * Zoombinis sauvés selon la sortie (`1168:3dd0(0, 1)` puis `1168:36e1`) : « go » (seulement si tous les trolls sont partis) sauve le groupe entier ; la carte ne
 * sauve personne, donc tout le groupe est perdu. Pas de passage partiel.
 */
export function savedAfterExit(state: PizzaState, size: number, via: "go" | "map"): number {
  return via === "go" && canContinue(state) ? size : 0;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Robot

/**
 * Robot de l'épreuve (vague J) : connaît les ensembles aimés et sert à chaque troll présent, dans l'ordre, exactement l'ensemble qu'il aime. Chaque repas est parfait
 * pour un troll, donc aucun ne coûte de budget : au plus un repas par troll (1, 2, 3, 3). Renvoie les masques à servir.
 */
export function pizzaRobot(state: PizzaState): number[] {
  return presentTrolls(state).map((k) => state.liked[k]!);
}

/** Joue le robot jusqu'au bout sur `state` (bascule les ingrédients puis sert) ; renvoie les services. */
export function playRobot(state: PizzaState, rng: MsvcRandom): PizzaServe[] {
  const serves: PizzaServe[] = [];
  while (!allSatisfied(state)) {
    const k = presentTrolls(state)[0]!;
    state.meal = 0;
    for (const i of ingredientsOf(state.liked[k]!)) toggleIngredient(state, i);
    const serve = serveMeal(state, rng);
    if (!serve) break;
    serves.push(serve);
  }
  return serves;
}
