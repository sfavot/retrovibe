import type { MsvcRandom } from "../../../../engine/mohawk/rng";
import type { Attrs } from "../state";

/**
 * Règles de la tanière du sphinx (`CAVES.MHK`, écran 16 ; `docs/zoombinis/puzzles/caves.md`) : le tri caché tiré à l'entrée (un attribut A, un attribut B aux
 * niveaux 3 et 4, l'ordre de leurs valeurs), la disposition des 20 dalles en blocs, les indices en hiéroglyphes, la pose d'un Zoombini (placement automatique
 * sur une dalle valide en cas d'erreur, lion qui se réveille d'un cran), le verrouillage au dernier cran, les sauvés et les perdus, le robot. Fonctions pures
 * sur `CavesState` : aucun rendu, aucun service, aucun texte. Le hasard vient d'un `MsvcRandom` injecté, tiré **dans l'ordre de l'original**.
 *
 * Adresses : `10c8:*` est le segment de code de l'écran, `DS:` le segment de données du jeu (`1530`). Ghidra inverse l'ordre des arguments pascal
 * (`docs/zoombinis/engine.md` §0) : `10a8:04e8(max, min)` en signature Ghidra = `rng.range(min, max)`.
 *
 * Ordre des tirages de `Enter` (`10c8:0000` → `10c8:1ffd` puis `10c8:2279`), tous après la création des Zoombinis :
 *  1. `10c8:201a` : attribut A (`04e8(3, 0)` dans {0, 1, 2, 3}), puis permutation des valeurs 1 à 5 (cinq tirages `04e8(n, 1)`, n = 5 à 1, dont les deux derniers ne
 *     consomment rien) ; attribut B (`04e8(2, 0)` parmi les trois restants) et sa permutation, **toujours tirés** (même aux niveaux 1 et 2, où B n'est pas utilisé) ;
 *  2. `10c8:21c4` et `10c8:2508` : comptes et blocs (aucun tirage) ;
 *  3. `10c8:2279` : indices (niveaux 2 et 3 seulement : deux emplacements parmi cinq, une fois par rangée affichée ; `04e8(2, 2)` ne consomme rien).
 * La pose d'un Zoombini (`10c8:2635`) ne tire que pour choisir la dalle de repli : `04e8(n − 1, 0)` parmi les n dalles libres valides.
 *
 * Conventions : niveau 0 à 3 (comme `currentLevel` de `route.ts`) = `[7106] − 1` ; attribut 0 à 3 = octet `+0xec + a` de la fiche (`Zoombini.attrs[a]`, valeur 1 à 5) ;
 * dalle 1 à 20 (numéro de `NODE` 1000), les dalles `first` à 20 sont celles du groupe (`first = 21 − N`) ; emplacement de hiéroglyphe 1 à 5 (rangée A) et 6 à 10 (rangée B).
 *
 * Écarts avec l'original (sans effet sur les règles) :
 *  - le temps, les animations et le verrou de saisie `[0bf8]` (qui dépend des animations) sont laissés à la scène ; le module ne rend que le cran du lion et ce qui en
 *    découle (`lionAtLast`) ;
 *  - le tirage forcé de débogage (`[0c20]`) et l'affichage de débogage (`10c8:2d1c`) ne sont pas portés ;
 *  - `10c8:2635` renvoie la dalle 1 quand aucune dalle libre ne convient (cas impossible : il y a exactement autant de dalles que de Zoombinis dans chaque classe) ;
 *    `placeMember` lève une erreur à la place, sauf si l'état a déjà été vidé.
 */

// --- Constantes de l'original ---

/** Niveaux (0 à 3). */
export type CavesLevel = 0 | 1 | 2 | 3;
export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Nombre de dalles du chemin (`NODE` 1000 : 20 dalles et un point de sortie), de valeurs par attribut (`[0bfa]`), de dalles de remplissage au plus. */
export const SLOT_COUNT = 20;
export const VALUE_COUNT = 5;
export const MAX_FILLERS = 4;
/** Crans du lion par niveau (`[0c0a]`, `10c8:1f37`) : rejets tolérés, le dernier compris, avant le verrouillage de la pose. */
export const LION_STEPS: Readonly<Record<CavesLevel, number>> = { 0: 4, 1: 5, 2: 6, 3: 7 };
/** Script de base du lion (`[0c08]`) : le cran `n` joue le `SCRB` `base + n` (6007 à 6010 au niveau 1, 6004 à 6010 au niveau 4). */
export const LION_BASE_SCRIPT: Readonly<Record<CavesLevel, number>> = { 0: 6006, 1: 6005, 2: 6004, 3: 6003 };
/** Dernier script du lion, commun aux quatre niveaux (cran maximal). */
export const LION_LAST_SCRIPT = 6010;
/** Rangées de tri (`[0bfc]`) : 1 aux niveaux 1 et 2, 2 aux niveaux 3 et 4 (`10c8:201a`). */
export const SORT_ROWS: Readonly<Record<CavesLevel, 1 | 2>> = { 0: 1, 1: 1, 2: 2, 3: 2 };

/** Les 20 dalles (`DS:0cae + 4s`, `NODE` 1000) : le point d'accroche des pieds du Zoombini posé. */
export const SLOT_ANCHORS: readonly Point[] = [
  { x: 254, y: 140 },
  { x: 296, y: 148 },
  { x: 340, y: 146 },
  { x: 373, y: 163 },
  { x: 364, y: 187 },
  { x: 337, y: 212 },
  { x: 316, y: 234 },
  { x: 301, y: 263 },
  { x: 314, y: 292 },
  { x: 346, y: 311 },
  { x: 388, y: 316 },
  { x: 429, y: 301 },
  { x: 458, y: 281 },
  { x: 482, y: 261 },
  { x: 521, y: 247 },
  { x: 556, y: 263 },
  { x: 567, y: 290 },
  { x: 543, y: 314 },
  { x: 529, y: 342 },
  { x: 554, y: 359 },
];

/** Variante d'attente (`+0xf1`, octet `DS:0dba + 2s`) et sens (`+0xf2`, mot `DS:0de4 + 2s`, 1 = tourné à gauche) d'un Zoombini posé sur la dalle `s` (index `s − 1`). */
export const SLOT_IDLE_VARIANT: readonly number[] = [2, 2, 2, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 2, 2, 2, 2, 1];
export const SLOT_FACING: readonly (0 | 1)[] = [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0];

/**
 * Les 20 places d'attente du groupe (`DS:0d62`, `11a8:0ed9(1, 0d62, 20)`), le membre `i` sur la place `i` : l'escalier du sol, à gauche.
 */
export const WAITING_PLACES: readonly Point[] = [
  { x: 180, y: 110 },
  { x: 160, y: 136 },
  { x: 130, y: 167 },
  { x: 106, y: 193 },
  { x: 86, y: 232 },
  { x: 140, y: 100 },
  { x: 120, y: 126 },
  { x: 100, y: 157 },
  { x: 76, y: 183 },
  { x: 46, y: 222 },
  { x: 100, y: 90 },
  { x: 80, y: 116 },
  { x: 60, y: 147 },
  { x: 36, y: 173 },
  { x: 60, y: 80 },
  { x: 40, y: 106 },
  { x: 20, y: 137 },
  { x: 10, y: 167 },
  { x: 20, y: 90 },
  { x: 20, y: 116 },
];

/**
 * Le sol (`DS:0d02 + 8i`, `i = 1 … 11` ; le rectangle 0 est nul) : un Zoombini lâché hors des dalles dans l'un de ces rectangles (gauche, haut, droite, bas ;
 * test du point `+0xd6` = ses pieds, `11d8:0000`, bornes comprises) y reste ; ailleurs il tombe dans le gouffre et revient d'où il vient (`10c8:130f`).
 */
export const FLOOR_RECTS: readonly Rect[] = [
  { left: 0, top: 0, right: 195, bottom: 130 },
  { left: 0, top: 128, right: 175, bottom: 147 },
  { left: 0, top: 146, right: 155, bottom: 165 },
  { left: 0, top: 164, right: 135, bottom: 191 },
  { left: 0, top: 190, right: 120, bottom: 214 },
  { left: 0, top: 213, right: 100, bottom: 236 },
  { left: 0, top: 235, right: 87, bottom: 250 },
  { left: 0, top: 249, right: 67, bottom: 269 },
  { left: 0, top: 268, right: 40, bottom: 289 },
  { left: 0, top: 288, right: 27, bottom: 357 },
  { left: 0, top: 356, right: 36, bottom: 394 },
];

/** Emplacements de hiéroglyphes (`DS:0e14` x, `DS:0e2a` y ; index 1 à 10 : rangée A puis rangée B). */
export const HIEROGLYPH_X: readonly number[] = [0, 326, 348, 375, 397, 423, 324, 347, 373, 395, 422];
export const HIEROGLYPH_Y: readonly number[] = [0, 36, 39, 42, 44, 46, 77, 80, 83, 86, 90];

/** Nombre de visites de l'écran en dessous duquel la phrase de consolation (`20045…20048`) part toujours (`(S+0x40 & 0xfff) < 4`). */
export const MAX_REGRET_VISITS = 3;

// --- Règle et disposition ---

/** Le tri caché : attributs A et B (0 à 3) et ordre des valeurs 1 à 5 de chacun (`[7108]`, `[710a]`, `[710c…]`, `[7116…]`). */
export interface CavesRule {
  attrA: number;
  attrB: number;
  /** Ordre des valeurs de A le long du chemin (permutation de 1 à 5). */
  orderA: number[];
  orderB: number[];
}

/** Tirage de la règle, `10c8:201a`. */
export function drawRule(rng: MsvcRandom): CavesRule {
  const remaining = [0, 1, 2, 3];
  const attrs: number[] = [];
  const orders: number[][] = [];
  for (let line = 0; line < 2; line++) {
    // `04e8(3, 0)` puis `04e8(2, 0)` : l'indice dans la liste des attributs restants, qui rétrécit d'un cran après A.
    const pick = rng.range(0, remaining.length - 1);
    attrs.push(remaining[pick]!);
    if (line === 0) remaining.splice(pick, 1);
    // Permutation des valeurs 1 à 5 : `04e8(n, 1)`, la valeur retirée et la liste décalée.
    const values = [1, 2, 3, 4, 5];
    const order: number[] = [];
    for (let left = VALUE_COUNT; left >= 1; left--) {
      const at = rng.range(1, left) - 1;
      order.push(values[at]!);
      values.splice(at, 1);
    }
    orders.push(order);
  }
  return { attrA: attrs[0]!, attrB: attrs[1]!, orderA: orders[0]!, orderB: orders[1]! };
}

/** Disposition des dalles (`10c8:21c4`, `10c8:2508`) : valeur exigée de chaque dalle. Index 1 à 20 ; 0 pour une dalle hors groupe. */
export interface Layout {
  /** Première dalle du groupe (`[0c14] = 21 − N`). */
  first: number;
  /** Dalles de remplissage au début du chemin (`[0c1e] = min(4, 20 − N)`). */
  fillers: number;
  /** Valeur de A exigée (`[71a4 + 2s]`) et de B exigée (`[71ce + 2s]`, 0 à un seul tri). */
  needA: number[];
  needB: number[];
  /** Nombre de Zoombinis par valeur de A (`[7120 + v]`) et par couple (A, B) (`[7120 + v + 6w]`, rangée B seulement). */
  countA: number[];
  countAB: number[][];
}

export function layoutSlots(rule: CavesRule, level: CavesLevel, attrs: readonly Attrs[]): Layout {
  const size = attrs.length;
  if (size < 1 || size > SLOT_COUNT) throw new RangeError(`tanière du sphinx : ${size} Zoombinis pour ${SLOT_COUNT} dalles`);
  const rows = SORT_ROWS[level];
  const countA = new Array<number>(VALUE_COUNT + 1).fill(0);
  const countAB = Array.from({ length: VALUE_COUNT + 1 }, () => new Array<number>(VALUE_COUNT + 1).fill(0));
  for (const a of attrs) {
    const v = a[rule.attrA]!;
    countA[v] = (countA[v] ?? 0) + 1;
    if (rows > 1) {
      const w = a[rule.attrB]!;
      countAB[v]![w] = (countAB[v]![w] ?? 0) + 1;
    }
  }
  const first = SLOT_COUNT + 1 - size;
  const needA = new Array<number>(SLOT_COUNT + 1).fill(0);
  const needB = new Array<number>(SLOT_COUNT + 1).fill(0);
  let cursor = first;
  for (const v of rule.orderA) {
    for (let k = 0; k < (countA[v] ?? 0); k++) needA[cursor + k] = v;
    cursor += countA[v] ?? 0;
  }
  cursor = first;
  for (const v of rule.orderA) {
    for (const w of rule.orderB) {
      const n = countAB[v]![w] ?? 0;
      for (let k = 0; k < n; k++) if (w !== 0) needB[cursor + k] = w;
      cursor += n;
    }
  }
  return { first, fillers: Math.min(MAX_FILLERS, SLOT_COUNT - size), needA, needB, countA, countAB };
}

// --- Indices ---

/** Un hiéroglyphe affiché : emplacement (1 à 10) et image de `tBMP` 10000 (`valeur + 5 × attribut`, 1 à 20). */
export interface Hint {
  slot: number;
  image: number;
}

/**
 * Indices du niveau (`10c8:2279`) : rangée A complète au niveau 1 ; deux emplacements sur cinq au niveau 2 (tirés sans remise) ; deux par rangée au niveau 3 ;
 * aucun au niveau 4. L'emplacement `k` montre la valeur `ordre[k − 1]` de la rangée (A : emplacements 1 à 5, B : 6 à 10).
 */
export function drawHints(rng: MsvcRandom, level: CavesLevel, rule: CavesRule): Hint[] {
  const shown = new Set<number>();
  const pickTwo = (offset: number): void => {
    const list = [0, 1, 2, 3, 4, 5, 6];
    let left = VALUE_COUNT;
    // `04e8(2, 2)` : toujours 2, sans tirage.
    const count = rng.range(2, 2);
    for (let i = 0; i < count; i++) {
      const at = rng.range(1, left);
      shown.add(list[at]! + offset);
      list.splice(at, 1);
      left -= 1;
    }
  };
  switch (level) {
    case 0:
      for (let k = 1; k <= 5; k++) shown.add(k);
      break;
    case 1:
      pickTwo(0);
      break;
    case 2:
      pickTwo(0);
      pickTwo(5);
      break;
    case 3:
      break;
  }
  const hints: Hint[] = [];
  for (let slot = 1; slot <= 10; slot++) {
    if (!shown.has(slot)) continue;
    const row = slot <= 5 ? 0 : 1;
    const value = (row === 0 ? rule.orderA : rule.orderB)[(slot - 1) % 5]!;
    hints.push({ slot, image: value + 5 * (row === 0 ? rule.attrA : rule.attrB) });
  }
  return hints;
}

// --- État ---

export interface CavesState {
  /** Niveau courant (`[7106]`) : règle les lignes de tri (`10c8:21c4`), les indices (`10c8:2279`) et la phrase de consolation. Le mode de test peut le changer (touches 1 à 4). */
  level: CavesLevel;
  /** Niveau dont les paramètres du lion sont en vigueur (`[0c0a]`, `[0c08]`) : celui de `Enter`, remis à `level` par `resetCaves` (`10c8:1f37`). */
  lionLevel: CavesLevel;
  rows: 1 | 2;
  rule: CavesRule;
  layout: Layout;
  hints: Hint[];
  /** Attributs des Zoombinis du groupe, par indice de membre. */
  attrs: Attrs[];
  /** Occupant de chaque dalle (indice de membre ; −1 : libre) — `[717a + 2s]`. Index 1 à 20. */
  occupant: number[];
  /** Dalle de chaque membre (0 : pas posé). */
  slotOf: number[];
  /** Posés (`[0c16]`) et cran du lion (`[0c0c]`, 0 à `LION_STEPS`). */
  placed: number;
  lion: number;
}

/** `Enter` : tire la règle, dispose les dalles, tire les indices. */
export function createCaves(rng: MsvcRandom, level: CavesLevel, attrs: readonly Attrs[]): CavesState {
  const rule = drawRule(rng);
  const layout = layoutSlots(rule, level, attrs);
  const hints = drawHints(rng, level, rule);
  return {
    level,
    lionLevel: level,
    rows: SORT_ROWS[level],
    rule,
    layout,
    hints,
    attrs: attrs.map((a) => [...a] as Attrs),
    occupant: new Array<number>(SLOT_COUNT + 1).fill(-1),
    slotOf: attrs.map(() => 0),
    placed: 0,
    lion: 0,
  };
}

/** La dalle `slot` convient-elle à ce Zoombini (`10c8:2635`) ? Libre, dans le groupe, de sa valeur de A (et de B au second tri). */
export function slotFits(state: CavesState, slot: number, member: number): boolean {
  const { layout, rule } = state;
  if (slot < layout.first || slot > SLOT_COUNT) return false;
  if (state.occupant[slot] !== -1) return false;
  const a = state.attrs[member]!;
  if (layout.needA[slot] !== a[rule.attrA]) return false;
  return state.rows < 2 || layout.needB[slot] === a[rule.attrB];
}

/** Dalles libres qui conviennent à ce Zoombini, dans l'ordre du chemin. */
export function fittingSlots(state: CavesState, member: number): number[] {
  const out: number[] = [];
  for (let s = state.layout.first; s <= SLOT_COUNT; s++) if (slotFits(state, s, member)) out.push(s);
  return out;
}

/** Résultat d'une pose (`10c8:130f` cas 3, branche dalle). */
export interface Placement {
  member: number;
  /** Dalle sur laquelle le joueur l'a lâché. */
  dropped: number;
  /** Dalle où il est posé : la même si elle convient, sinon une dalle libre valide tirée au hasard. */
  slot: number;
  correct: boolean;
  /** Première pose (le bouton « go » s'active) et dernière (tout le groupe est posé). */
  first: boolean;
  complete: boolean;
}

/**
 * Pose le Zoombini `member` lâché sur la dalle `dropped` (`10c8:2635` puis la suite de `10c8:130f`) : l'occupant est enregistré sur la dalle finale, `placed`
 * monte. Le cran du lion ne bouge pas ici : il monte à la fin de l'animation de rejet (`wakeLion`).
 */
export function placeMember(state: CavesState, rng: MsvcRandom, member: number, dropped: number): Placement {
  if (state.slotOf[member] !== 0) throw new Error(`tanière du sphinx : le membre ${member} est déjà posé`);
  let slot: number;
  if (slotFits(state, dropped, member)) {
    slot = dropped;
  } else {
    const choices = fittingSlots(state, member);
    if (choices.length === 0) throw new Error("tanière du sphinx : aucune dalle libre ne convient");
    slot = choices[rng.range(0, choices.length - 1)]!;
  }
  state.occupant[slot] = member;
  state.slotOf[member] = slot;
  state.placed += 1;
  return { member, dropped, slot, correct: slot === dropped, first: state.placed === 1, complete: state.placed === state.attrs.length };
}

/** Cran maximal du lion de ce niveau (`[0c0a]`). */
export function lionLimit(state: CavesState): number {
  return LION_STEPS[state.lionLevel];
}

/**
 * Fin de l'animation d'un rejet (`10c8:1137` cas 4, `10c8:1c92`) : le lion monte d'un cran. Renvoie le `SCRB` à jouer (`[0c08] + cran`), ou null si le cran dépasse
 * le maximum (la condition de `10c8:1c92`).
 */
export function wakeLion(state: CavesState): number | null {
  state.lion += 1;
  return state.lion <= lionLimit(state) ? LION_BASE_SCRIPT[state.lionLevel] + state.lion : null;
}

/** Le lion est au dernier cran : la pose est verrouillée (`[0bf8] = ([0c0c] == [0c0a])`, `10c8:1137` cas 0x14). */
export function lionAtLast(state: CavesState): boolean {
  return state.lion >= lionLimit(state);
}

/** Bouton « go » actif dès qu'un Zoombini est posé (`[0bf0]`). */
export function goEnabled(state: CavesState): boolean {
  return state.placed >= 1;
}

/** Membres posés (sauvés : `+0x127`), dans l'ordre des indices, et nombre de perdus. */
export function savedMembers(state: CavesState): number[] {
  const out: number[] = [];
  state.slotOf.forEach((slot, member) => {
    if (slot !== 0) out.push(member);
  });
  return out;
}

export function lostCount(state: CavesState): number {
  return state.attrs.length - state.placed;
}

/**
 * Phrase de consolation au dernier cran (`10c8:1245`, événement 0x14) : seulement s'il reste des Zoombinis hors des dalles, et si `04e8(4, 0) > niveau` ou si
 * l'écran a été visité moins de 4 fois (`(S+0x40 & 0xfff) < 4`). `draw` est le tirage de `rng.range(0, 4)` fait par l'appelant.
 */
export function regretVoiceDue(state: CavesState, draw: number, visits: number): boolean {
  return state.placed < state.attrs.length && (draw > state.level || visits <= MAX_REGRET_VISITS);
}

// --- Sol ---

/** Le point (pieds du Zoombini lâché) est-il sur le sol (`DS:0d0a + 8i`) ? Faux : il tombe dans le gouffre. */
export function onFloor(x: number, y: number): boolean {
  return FLOOR_RECTS.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
}

// --- Robot ---

/**
 * Robot : la dalle de chaque Zoombini, dans l'ordre des indices (une dalle libre qui lui convient, la première du chemin). Posés dans cet ordre, tous les
 * Zoombinis sont sur leur dalle du premier coup : aucun rejet, le lion ne bouge pas.
 */
export function robot(state: CavesState): number[] {
  const taken = new Set<number>();
  return state.attrs.map((_a, member) => {
    for (let s = state.layout.first; s <= SLOT_COUNT; s++) {
      if (taken.has(s)) continue;
      const fits = state.layout.needA[s] === state.attrs[member]![state.rule.attrA] && (state.rows < 2 || state.layout.needB[s] === state.attrs[member]![state.rule.attrB]);
      if (fits) {
        taken.add(s);
        return s;
      }
    }
    throw new Error("tanière du sphinx : le robot ne trouve pas de dalle");
  });
}

// --- Mode de test (`DS:a43f`, touches de `10c8:1cf5`) ---

/** Un Zoombini déjà posé que `relayout` a déplacé d'une dalle à une autre. */
export interface SlotMove {
  member: number;
  from: number;
  to: number;
}

/**
 * Touches 1 à 4 (`[7106]` = niveau) et F5 à F8 (`[7108]` = attribut A) : `10c8:27d7`. Rejoue la disposition des dalles pour le groupe, avec les lignes de tri du niveau
 * courant (`10c8:21c4`, `10c8:2508`) ; la permutation des valeurs ne change pas. `attrA` (F5 à F8, 0 à 3) fixe l'attribut A : si B est le même, B passe au suivant (0 après 3).
 * Les Zoombinis déjà posés sont reposés dans l'ordre des dalles : sur leur dalle si elle leur convient encore, sinon sur une dalle libre valable tirée au hasard
 * (`10c8:2635`) ; le nombre de posés ne change pas. Les indices sont retirés (`10c8:2279`). Renvoie les déplacements.
 */
export function relayout(state: CavesState, rng: MsvcRandom, attrA?: number): SlotMove[] {
  if (attrA !== undefined) {
    state.rule.attrA = attrA;
    if (state.rule.attrB === attrA) state.rule.attrB += 1;
    if (state.rule.attrB > 3) state.rule.attrB = 0;
  }
  const before = state.occupant.slice();
  state.layout = layoutSlots(state.rule, state.level, state.attrs);
  state.rows = SORT_ROWS[state.level];
  state.occupant.fill(-1);
  state.slotOf.fill(0);
  const moves: SlotMove[] = [];
  for (let slot = state.layout.first; slot <= SLOT_COUNT; slot++) {
    const member = before[slot]!;
    if (member === -1) continue;
    let to = slot;
    if (!slotFits(state, slot, member)) {
      const choices = fittingSlots(state, member);
      to = choices.length === 0 ? 1 : choices[rng.range(0, choices.length - 1)]!;
    }
    state.occupant[to] = member;
    state.slotOf[member] = to;
    if (to !== slot) moves.push({ member, from: slot, to });
  }
  state.hints = drawHints(rng, state.level, state.rule);
  return moves;
}

/**
 * Touche Espace (`10c8:299c`) : `10c8:1f37([7106])`, remise à zéro des compteurs (posés `[0c16]`, cran du lion `[0c0c]`), une seule ligne de tri (`[0bfc] = 1`,
 * jusqu'au prochain `relayout`) et les paramètres du lion du niveau courant. Les dalles occupées ne sont pas touchées.
 */
export function resetCaves(state: CavesState): void {
  state.placed = 0;
  state.lion = 0;
  state.rows = 1;
  state.lionLevel = state.level;
}

/** Script du lion remis au repos par `10c8:299c` : `[0c08]`, ou `[0c08] − 1` quand il atteint 6004 (`11a8:1be6(1, …)`). */
export function lionRestScript(state: CavesState): number {
  const base = LION_BASE_SCRIPT[state.lionLevel];
  return base < 6004 ? base : base - 1;
}

/** Touche F3 (`10c8:2b46`) : toutes les dalles redeviennent libres (`[717a + 2s] = 0`), puis `resetCaves`. Renvoie les membres qui étaient posés. */
export function clearSlots(state: CavesState): number[] {
  const posed = savedMembers(state);
  state.occupant.fill(-1);
  state.slotOf.fill(0);
  resetCaves(state);
  return posed;
}
