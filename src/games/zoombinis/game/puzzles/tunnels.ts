import type { MsvcRandom } from "../../../../engine/mohawk/rng";
import type { Attrs } from "../state";

/**
 * Règles des grottes de passe-clos (`TUNNELS.MHK`, écran 8 ; `docs/zoombinis/puzzles/tunnels.md`). Fonctions pures, sans rendu ni texte :
 * tirage de la ou des règles (`1190:2748`, `2af8`, `2d12`, `381c`, `3a48`), acceptation d'une entrée (`1190:2588`), exception du niveau 0
 * (`1190:0be9`, `DS:a0ce`), budget d'erreurs et effondrement (`1190:06ff`, `1190:0107`), arrivées par tunnel (`1190:17e1`), robot.
 *
 * Adresses : `1190:*` est le segment de code de l'écran, `DS:` le segment de données (`1530`). Ghidra inverse l'ordre des arguments pascal
 * (`docs/zoombinis/engine.md` §0) : `10a8:04e8(max, min)` en lecture Ghidra est `rng.range(min, max)`.
 *
 * Conventions :
 *  - niveau 0 à 3 (comme `currentLevel` de `route.ts`) ; attribut 1 à 4 = octet 0 à 3 de la fiche (cheveux, yeux, nez, pieds), valeur 1 à 5 ;
 *  - entrée 1 à 4 de gauche à droite : 1 = gauche extérieure, 2 = gauche intérieure, 3 = droite intérieure, 4 = droite extérieure. Le décor
 *    (places d'arrivée de `1510:0040…0100`) place les tunnels des entrées 1 et 4 **en haut** de l'écran et ceux des entrées 2 et 3 **en bas**
 *    (point 1 de l'étude, tranché : extérieur = haut) ; premier embranchement = gauche (1, 2) ou droite (3, 4), second = haut ou bas ;
 *  - une règle accepte un Zoombini si **au moins une** de ses conditions « attribut = valeur » est vraie (OU).
 *
 * Ordre des tirages de l'original, à l'entrée de l'écran (`1190:0107`) : `a0ce` (dans `1190:0000`), puis (après la création du groupe par
 * la scène) les règles, puis la voix d'introduction `a2c4`, puis le délai d'encouragement `a0f0`. Les fonctions ci-dessous sont à appeler dans cet ordre.
 */

// --- Constantes ---

export const ENTRANCES = 4;
/** Places d'arrivée par tunnel (`1510:0040…0100`, 16 points). */
export const TUNNEL_PLACES = 16;
/** Budget d'erreurs `DS:a0d2` par niveau (`1190:0107`). */
export const ERROR_BUDGETS: readonly number[] = [16, 18, 20, 22];
/** Longueur de la file de décisions (`1190:201d` : refuse au-delà de 5). */
export const QUEUE_LIMIT = 5;
/** Voix d'avertissement (`DS:a1a0`) quand le budget **avant** décrément vaut 5, 4, 3, 2 : `\0SND` 4700, 4701, 4702, 4703. */
export const WARNING_VOICES: Readonly<Record<number, number>> = { 5: 4700, 4: 4701, 3: 4702, 2: 4703 };
/** Consigne vocale d'introduction `DS:a2c4 = rand(20069..20070)`, rejouable par F1. */
export const INTRO_VOICES = { first: 20069, last: 20070 } as const;
/** Délai avant la prochaine phrase d'encouragement, `DS:a0f0 = rand(5400..10800)` ticks. */
export const ENCOURAGEMENT_TICKS = { min: 5400, max: 10800 } as const;
/** Voix de réussite tirée au dernier arrivé : `rand(0x4e57..0x4e5f)` (= 20055…20063, `DS:a1a6`). */
export const FINAL_SUCCESS_VOICES = { first: 20055, last: 20063 } as const;

export type Level = 0 | 1 | 2 | 3;
export type Entrance = 1 | 2 | 3 | 4;
export type Attribute = 1 | 2 | 3 | 4;

export interface Condition {
  readonly attr: Attribute;
  readonly value: number;
}

/**
 * Une règle (`DS:a02c…` : 13 octets) : `w` (mot `a02c` / `a039`), conditions. Pour la règle 0, `w ≠ 0` = « la gauche accepte la règle »
 * (le premier embranchement envoie à gauche ceux qui la vérifient) ; pour la règle 1, `w ≠ 0` = « le haut accepte la règle ».
 */
export interface Rule {
  readonly w: boolean;
  readonly conditions: readonly Condition[];
}

export interface TunnelsRules {
  readonly level: Level;
  /** Une règle (niveau 0) ou deux (niveaux 1 à 3). */
  readonly rules: readonly Rule[];
  /**
   * `DS:a0ce` (niveau 0 seulement, tiré à l'entrée dans l'écran) : 0 = seules les entrées extérieures 1 et 4 sont valables, 1 = seules les
   * intérieures 2 et 3 (les deux autres sont comptées fausses même si la règle les accepte).
   */
  readonly blocked: 0 | 1;
}

// --- Candidates ---

const ATTRIBUTES: readonly Attribute[] = [4, 3, 2, 1];
/** Paires de valeurs du niveau 2 (`DS:3c24`, octet `0xHL` : valeurs H et L). */
const VALUE_PAIRS: readonly (readonly [number, number])[] = [
  [1, 2],
  [1, 3],
  [1, 4],
  [1, 5],
  [2, 3],
  [2, 4],
  [2, 5],
  [3, 4],
  [3, 5],
  [4, 5],
];
/** Paires d'attributs du niveau 3 (`DS:3c4c` / `DS:3c64` : octets bas puis haut) : (4, 3), (4, 2), (4, 1), (3, 2), (3, 1), (2, 1). */
const ATTRIBUTE_PAIRS: readonly (readonly [Attribute, Attribute])[] = [
  [4, 3],
  [4, 2],
  [4, 1],
  [3, 2],
  [3, 1],
  [2, 1],
];

/**
 * Les candidates d'un niveau, dans l'ordre d'énumération de l'original (qui sert au départage des ex æquo). Le candidat est stocké dans un
 * double mot dont l'octet bas est l'attribut 4 (`1190:2748`, table `CS:2ae0`) : les attributs s'énumèrent donc 4, 3, 2, 1.
 *  - niveaux 0 et 1 : 20 candidates « attribut = valeur » ;
 *  - niveau 2 : 40 candidates « attribut ∈ {v1, v2} » (4 attributs × 10 paires, `1190:2d12`) ;
 *  - niveau 3 : 150 candidates « deux attributs » (6 paires × 5 × 5, `1190:381c` : la valeur de l'attribut haut en boucle externe).
 */
export function candidatesFor(level: Level): Condition[][] {
  const out: Condition[][] = [];
  if (level <= 1) {
    for (const attr of ATTRIBUTES) for (let value = 1; value <= 5; value++) out.push([{ attr, value }]);
  } else if (level === 2) {
    for (const attr of ATTRIBUTES) {
      for (const [high, low] of VALUE_PAIRS) out.push([{ attr, value: low }, { attr, value: high }]);
    }
  } else {
    for (const [low, high] of ATTRIBUTE_PAIRS) {
      for (let j = 1; j <= 5; j++) for (let k = 1; k <= 5; k++) out.push([{ attr: low, value: k }, { attr: high, value: j }]);
    }
  }
  return out;
}

/** Vrai si au moins une condition est vérifiée (`1190:2588`, boucle de test). */
export function satisfies(conditions: readonly Condition[], attrs: readonly number[]): boolean {
  return conditions.some((c) => attrs[c.attr - 1] === c.value);
}

// --- Tirage ---

/** `DS:a0ce` : `rand(0..1)` tiré en tête d'`Enter` (`1190:0000`). */
export function drawBlocked(rng: MsvcRandom): 0 | 1 {
  return rng.range(0, 1) as 0 | 1;
}

/** `DS:a2c4` : voix d'introduction (`rand(20069..20070)`), tirée après les règles. */
export function drawIntroVoice(rng: MsvcRandom): number {
  return rng.range(INTRO_VOICES.first, INTRO_VOICES.last);
}

/** `DS:a0f0` : délai (ticks) avant la prochaine phrase d'encouragement. */
export function drawEncouragementDelay(rng: MsvcRandom): number {
  return rng.range(ENCOURAGEMENT_TICKS.min, ENCOURAGEMENT_TICKS.max);
}

/**
 * Niveau 0 (`1190:2748`). Effectif de chaque candidate dans le groupe ; filtre optionnel de la règle du pont (`DS:96ec` / `DS:96f0`, voir
 * `avoidCount`) ; effectif cible `⌊n/2⌋`, puis `+1`, `−1`, `−2`… (le pas alterne `+1` / `−2`, on ne teste jamais `n/2 + 2` ; `0` et `16` ou plus
 * sont ignorés) jusqu'à ce qu'une candidate l'ait ; tirage uniforme parmi elles (`rand(1..k)`) ; `w = rand(0..1)`.
 *
 * `avoidCount` = `DS:96f0` (effectif mémorisé par la règle du pont, non nul seulement si `DS:96ec` l'est aussi) : s'il existe une candidate
 * d'effectif non nul **différent**, celles d'effectif égal à `avoidCount` sont exclues. En entraînement la scène passe 0 (`1190:0000` remet
 * `96ec` / `96f0` à 0) ; en aventure la valeur vient de l'épreuve des gorges (non partagée à ce jour : voir le rapport).
 */
function drawSingleRule(rng: MsvcRandom, group: readonly Attrs[], avoidCount: number): Rule {
  const candidates = candidatesFor(0);
  const counts = candidates.map((cand) => group.filter((attrs) => satisfies(cand, attrs)).length);
  if (avoidCount !== 0 && counts.some((c) => c !== 0 && c !== avoidCount)) {
    for (let i = 0; i < counts.length; i++) if (counts[i] === avoidCount) counts[i] = 0;
  }
  const target = findTarget(counts, group.length);
  const matching = counts.flatMap((c, i) => (c === target ? [i] : []));
  const chosen = matching.length === 0 ? 0 : matching[rng.range(1, matching.length) - 1]!;
  return { w: rng.range(0, 1) !== 0, conditions: candidates[chosen]! };
}

/** Effectif cible du niveau 0 : suite `n/2`, `n/2 + 1`, `n/2 − 1`, `n/2 − 2`… ; repli (jamais atteint à 16 membres) : le plus proche de `n/2`. */
function findTarget(counts: readonly number[], n: number): number {
  let c = Math.trunc(n / 2);
  let step = 1;
  for (let guard = 0; guard < 200; guard++) {
    if (c !== 0 && c > 0 && c < 16 && counts.includes(c)) return c;
    c += step;
    step = -(step + 1);
  }
  // Ni l'original (boucle infinie) ni un groupe de 16 n'y mènent : on prend l'effectif non nul le plus proche de n/2.
  let best = 0;
  for (const c2 of counts) if (c2 !== 0 && (best === 0 || Math.abs(c2 - n / 2) < Math.abs(best - n / 2))) best = c2;
  return best;
}

/**
 * Choix d'une paire ordonnée de candidates (`1190:3a48`, `2d12`) : pour chaque paire (i, j), i ≠ j (i = règle 0, j = règle 1) on range
 * les Zoombinis du groupe dans les classes `A∧B`, `A∧¬B`, `¬A∧B`, `¬A∧¬B` ; on garde les paires au plus grand nombre de classes non vides, parmi
 * elles celles qui minimisent `Σ |cₖ − cₗ|` (six couples de classes), et on tire uniformément (`rand(1..k)`) la k-ième dans l'ordre `i × N + j`.
 */
export function chooseRulePair(candidates: readonly (readonly Condition[])[], group: readonly Attrs[], rng: MsvcRandom): [number, number] {
  const n = candidates.length;
  const sat = candidates.map((cand) => group.map((attrs) => satisfies(cand, attrs)));
  interface Pair {
    index: number;
    i: number;
    j: number;
    cost: number;
  }
  const pairs: Pair[] = [];
  let bestClasses = 0;
  const classCounts: number[][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const c = [0, 0, 0, 0];
      if (i !== j) {
        for (let z = 0; z < group.length; z++) {
          const a = sat[i]![z]!;
          const b = sat[j]![z]!;
          c[a ? (b ? 0 : 1) : b ? 2 : 3] += 1;
        }
      }
      classCounts.push(c);
      bestClasses = Math.max(bestClasses, c.filter((x) => x !== 0).length);
    }
  }
  let bestCost = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const c = classCounts[i * n + j]!;
      if (c.filter((x) => x !== 0).length < bestClasses) continue;
      let cost = 0;
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) cost += Math.abs(c[a]! - c[b]!);
      pairs.push({ index: i * n + j, i, j, cost });
      if (cost < bestCost) bestCost = cost;
    }
  }
  const ties = pairs.filter((p) => p.cost === bestCost);
  const pick = ties[rng.range(1, ties.length) - 1]!;
  return [pick.i, pick.j];
}

/**
 * Tire la ou les règles du niveau (`1190:2748` / `2af8` / `2d12` / `381c`) pour `group` (les Zoombinis présents au moment du tirage) ; `blocked`
 * est le `DS:a0ce` déjà tiré (`drawBlocked`). Niveaux 1 à 3 : la paire (`chooseRulePair`) puis `w₀`, `w₁` (`rand(0..1)` chacun, dans cet ordre).
 */
export function drawRules(rng: MsvcRandom, level: Level, group: readonly Attrs[], blocked: 0 | 1, avoidCount = 0): TunnelsRules {
  if (level === 0) return { level, rules: [drawSingleRule(rng, group, avoidCount)], blocked };
  const candidates = candidatesFor(level);
  const [i, j] = chooseRulePair(candidates, group, rng);
  const rules: Rule[] = [];
  for (const k of [i, j]) rules.push({ w: rng.range(0, 1) !== 0, conditions: candidates[k]! });
  return { level, rules, blocked };
}

// --- Acceptation ---

/** Résultat d'un dépôt sur une entrée. */
export interface Verdict {
  entrance: Entrance;
  /** « Faux choix » : le Zoombini revient et coûte une erreur. */
  wrong: boolean;
  /** Résultat du premier embranchement seul (`sortie` de `1190:2588` : `A'` pour les entrées 1 et 2, `¬A'` pour 3 et 4). */
  first: boolean;
  /**
   * Code de trajet 0 à 7 (`unaff_SI` de `1190:0be9`) : entrée 1 → `first ? 1 : 0`, entrée 2 → `first ? 3 : 2`, entrée 3 → `first ? 4 : 5`,
   * entrée 4 → `first ? 6 : 7`. Désigne les scripts de marche fausse (`8519 + 5 × code + pieds`), de retour (`8000 + code`), le gardien et le choc.
   */
  code: number;
}

/**
 * `1190:2588` : le Zoombini `attrs` déposé sur `entrance` (1 à 4). `A'` = il vérifie la règle 0 (inversée si `w₀ = 0`), `B'` = règle 1 (inversée si
 * `w₁ = 0`). Une règle : correct si `A'` (entrées 1, 2) ou `¬A'` (3, 4). Deux règles : 1 `A'∧B'`, 2 `A'∧¬B'`, 3 `¬A'∧¬B'`, 4 `¬A'∧B'`.
 * Puis, au niveau 0 (`1190:0be9`) : avec `blocked = 0` les entrées 2 et 3 sont fausses, avec `blocked = 1` les entrées 1 et 4.
 */
export function judge(rules: TunnelsRules, attrs: readonly number[], entrance: Entrance): Verdict {
  const [rule0, rule1] = rules.rules;
  const a = satisfies(rule0!.conditions, attrs) === rule0!.w;
  const hasSecond = rule1 !== undefined;
  const b = hasSecond ? satisfies(rule1.conditions, attrs) === rule1.w : false;
  let correct: boolean;
  let first: boolean;
  switch (entrance) {
    case 1:
      first = a;
      correct = hasSecond ? a && b : a;
      break;
    case 2:
      first = a;
      correct = hasSecond ? a && !b : a;
      break;
    case 3:
      first = !a;
      correct = hasSecond ? !a && !b : !a;
      break;
    default:
      first = !a;
      correct = hasSecond ? !a && b : !a;
  }
  let wrong = !correct;
  if (!wrong && rules.level === 0) {
    if (rules.blocked === 0) {
      if (entrance === 2 || entrance === 3) wrong = true;
    } else if (entrance === 1 || entrance === 4) {
      wrong = true;
    }
  }
  const code = entrance === 1 ? (first ? 1 : 0) : entrance === 2 ? (first ? 3 : 2) : entrance === 3 ? (first ? 4 : 5) : first ? 6 : 7;
  return { entrance, wrong, first, code };
}

/** Les entrées qui acceptent ce Zoombini (une par côté au niveau 0 sans l'exception, une seule sinon, deux avec elle : une par côté). */
export function correctEntrances(rules: TunnelsRules, attrs: readonly number[]): Entrance[] {
  return ([1, 2, 3, 4] as const).filter((e) => !judge(rules, attrs, e).wrong);
}

// --- État de l'épreuve ---

export interface TunnelsState {
  readonly rules: TunnelsRules;
  readonly total: number;
  /** `DS:a0d2` : erreurs permises restantes. */
  budget: number;
  /** Réussites consécutives par entrée (`DS:a0f6…a0fc`, indices 0 à 3 pour les entrées 1 à 4) : remis à 0 par un faux choix. */
  consecutive: [number, number, number, number];
  /** Arrivés par tunnel (`DS:a190` entrée 1, `a194` entrée 2, `a196` entrée 3, `a192` entrée 4). */
  arrivals: [number, number, number, number];
  /** Nombre de Zoombinis arrivés au bout d'un tunnel (sauvés). */
  saved: number;
  /** L'effondrement a commencé (budget épuisé et plus de marche en cours, `DS:a0e0`). */
  collapsed: boolean;
}

export function createState(rules: TunnelsRules, total: number): TunnelsState {
  return {
    rules,
    total,
    budget: ERROR_BUDGETS[rules.level]!,
    consecutive: [0, 0, 0, 0],
    arrivals: [0, 0, 0, 0],
    saved: 0,
    collapsed: false,
  };
}

/**
 * Dépôt d'un Zoombini sur une entrée (`1190:0be9`) : verdict, et compteur de réussites consécutives de l'entrée (`a0f4[e]` : +1 si correct, 0 sinon,
 * au **dépôt**, avant même que le Zoombini parte). Le budget n'est touché qu'au départ (`startWalk`).
 */
export function drop(state: TunnelsState, attrs: readonly number[], entrance: Entrance): Verdict {
  const verdict = judge(state.rules, attrs, entrance);
  state.consecutive[entrance - 1] = verdict.wrong ? 0 : state.consecutive[entrance - 1]! + 1;
  return verdict;
}

/** La réaction d'un gardien n'a lieu que pour la première réussite consécutive d'une entrée (`a0f4[e] < 2` après l'incrément du dépôt). */
export function reactionAllowed(state: TunnelsState, entrance: Entrance): boolean {
  return state.consecutive[entrance - 1]! < 2;
}

export interface WalkStart {
  /** Voix d'avertissement (`DS:a1a0`) à jouer quand le Zoombini sera revenu, ou null. */
  warning: number | null;
}

/**
 * Départ d'un Zoombini dans le tunnel (tête de file, `1190:06ff`) : une erreur retire 1 au budget **dès le départ** (pas à l'arrivée), avec
 * l'avertissement du budget d'avant (5, 4, 3, 2).
 */
export function startWalk(state: TunnelsState, verdict: Verdict): WalkStart {
  if (!verdict.wrong) return { warning: null };
  const before = state.budget;
  state.budget = Math.max(0, before - 1);
  return { warning: WARNING_VOICES[before] ?? null };
}

/** Faut-il lancer l'effondrement ? Budget épuisé, aucun Zoombini en marche (`a0e4 = 0`) et pas déjà lancé. */
export function shouldCollapse(state: TunnelsState, busy: boolean): boolean {
  return state.budget === 0 && !state.collapsed && !busy;
}

/** Arrivée au bout du tunnel de `entrance` : renvoie le rang (0 à 15) de la place d'arrivée et compte le sauvé (`1190:17e1`). */
export function arrive(state: TunnelsState, entrance: Entrance): number {
  const slot = state.arrivals[entrance - 1]!;
  state.arrivals[entrance - 1] = slot + 1;
  state.saved += 1;
  return slot;
}

/** Le bouton Continuer est actif : au moins un arrivé (`a0cc ≠ 0`) et (pas d'effondrement ou effondrement fini, `a0e0 = 0 || a0e2 ≠ 0`). */
export function canContinue(state: TunnelsState, collapseDone: boolean): boolean {
  return state.saved > 0 && (!state.collapsed || collapseDone);
}

// --- Robot ---

export interface RobotResult {
  saved: number;
  lost: number;
  errors: number;
  state: TunnelsState;
}

/**
 * Robot de la partie : connaît la règle, glisse chaque Zoombini sur une entrée correcte (la première des entrées acceptées) et le fait partir
 * dans le tunnel. Sauve tout le groupe sans aucune erreur.
 */
export function playRobot(rules: TunnelsRules, group: readonly Attrs[]): RobotResult {
  const state = createState(rules, group.length);
  let errors = 0;
  for (const attrs of group) {
    const entrance = correctEntrances(rules, attrs)[0]!;
    const verdict = drop(state, attrs, entrance);
    if (verdict.wrong) errors += 1;
    startWalk(state, verdict);
    if (!verdict.wrong) arrive(state, verdict.entrance);
  }
  return { saved: state.saved, lost: group.length - state.saved, errors, state };
}
