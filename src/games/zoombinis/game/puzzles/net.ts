import type { MsvcRandom } from "../../../../engine/mohawk/rng";

/**
 * Règles de la muraille de signes (`NET.MHK`, écran 15 ; `docs/zoombinis/puzzles/net.md`). Fonctions pures sans rendu : taille des groupes (`1120:2d8d`), construction du mur
 * (`1120:1461`), tirages de l'entrée (`1120:0000`), réglage des sélecteurs (`1120:1b9b`), dalle atteinte (`1120:2657`), impact (`1120:248b`), munitions et dernier tir
 * (`1120:0554`), Zoombinis passés et perdus, robot. Tout le hasard passe par le `MsvcRandom` reçu, dans l'ordre des tirages de l'original (`1080:0028(n)` = `rng.rand(n)` :
 * 0 à `n` inclus).
 *
 * Ce que voit le joueur : un mur de 25 dalles (5 × 5, niveaux 0 et 1) ou de 125 dalles (5 rangées de 25, niveaux 2 et 3). Les dalles qui cachent un groupe de Zoombinis sont
 * marquées. Le joueur règle 2 ou 3 sélecteurs de 5 symboles sur la catapulte et tire : la boule frappe la dalle dont les signes sont exactement ceux qui ont été réglés. Un
 * groupe passe une seule fois ; il faut donc **déduire la disposition des signes** des impacts successifs pour viser les dalles marquées avec le moins de boules possible.
 *
 * Points ouverts tranchés ici (étude §7, détail dans `net.md` §8) :
 *  - 1, mélange du niveau 3 : lu dans le désassemblage de `1120:172f` (le décompilé suffit presque, une branche est morte) : seul `P` est mélangé, **sûr**. Pour la colonne `c` ≥ 1
 *    de chaque rang, le vecteur des cinq plans (indices `[5·rang + c + 25·k]`) est celui de la colonne `c − 1` tourné de `rand(1) + 2` crans vers les plans suivants :
 *    `P[plan, rang, c] = a[(plan − s·c) mod 5]`. Le second `rand(1)` de `1120:1731` est écrasé (`MOV [BP-0xe], 0`) : la branche « autre » qui aurait mélangé `Q` / `R` est du code mort ;
 *  - 1 bis, niveau 2 et 3, `R` : l'étude lisait `R[colonne] = c_k` ; le désassemblage (`1120:1646`) écrit `b` (le `Q` du rang) : `R[plan, rang, colonne] = b_colonne`, la troisième valeur tirée `c`
 *    ne sert qu'au rejet. Les signes `(P, Q, R) = (a_plan, b_rang, b_colonne)` restent une bijection avec les 125 dalles, **sûr** (vérifié sur des milliers de tirages) ;
 *  - 3, dernier tir : `[8b4a]` est lu avant d'être décrémenté (`DS:8b4a < 1`) : la boule numéro `munitions + 1` est la dernière, **sûr** (`1120:0554`, `JLE`) ;
 *  - 4 et 6, fin : aucune défaite n'est posée, l'épreuve se termine par « go » (ou la carte) ; les perdus sont ceux qui n'ont pas franchi le mur, **probable** (étude §2.6) ;
 *  - niveau 2 : l'affectation sélecteurs ↔ `P`, `Q`, `R` est `[8ba8]`, que l'Enter ne remet pas à zéro (valeur du dernier niveau 3 joué, 0 à l'exécution suivante) ; ici 0, **probable**.
 *
 * Écarts (sans effet sur les règles) : les trois valeurs initiales des sélecteurs sont tirées avec `rand(4)` (`1120:0000`), avant le mur ; l'original construit le mur à la fin de l'animation
 * d'arrivée, de sorte que d'autres tirages (animations d'attente) peuvent s'intercaler : les graines ne reproduisent donc pas exactement un jeu complet de l'original.
 */

/** Niveaux de difficulté (`1168:515d`, 0 à 3). */
export const NET_LEVELS = 4;
/** Nombre de symboles par sélecteur. */
export const NET_SYMBOLS = 5;
/** Dalles : 25 aux niveaux 0 et 1, 125 aux niveaux 2 et 3 (`DS:8b6e`). */
export function tileCount(level: number): number {
  return level < 2 ? 25 : 125;
}
/** Nombre de sélecteurs actifs : 2 (rangées 2 et 3) aux niveaux 0 et 1, 3 aux niveaux 2 et 3. */
export function selectorCount(level: number): number {
  return level < 2 ? 2 : 3;
}
/** Boules de départ (`DS:8b4a`) : `7 + groupes (+ 1 au niveau 3)`. */
export function startingAmmo(level: number, groups: number): number {
  return 7 + groups + (level === 3 ? 1 : 0);
}

/** Groupes de Zoombinis (`1120:2d8d`) : suite 3, 2, 1, 3, 2, 1… jusqu'à couvrir `n`, l'excédent retiré des groupes de plus d'un Zoombini, du premier au dernier. */
export function groupSizes(n: number): number[] {
  if (n < 1) return [];
  const sizes: number[] = [];
  let k = 4;
  let remaining = n;
  do {
    k -= 1;
    if (k < 1) k = 3;
    sizes.push(k);
    remaining -= k;
  } while (remaining > 0);
  let excess = -remaining;
  while (excess > 0) {
    let changed = false;
    for (let i = 0; i < sizes.length && excess > 0; i++) {
      if (sizes[i]! > 1) {
        sizes[i]! -= 1;
        excess -= 1;
        changed = true;
      }
    }
    // Plus rien à retirer (la suite se réduit à des groupes d'un seul) : `1120:2d8d` ramène alors tout à des groupes de 1.
    if (!changed) return Array.from({ length: n }, () => 1);
  }
  return sizes;
}

/** Les trois tableaux de signes du mur (`P`, `Q`, `R` : `1458:00FA`, `01F4`, `02EE`) ; `r` est vide aux niveaux 0 et 1. */
export interface NetWall {
  readonly p: number[];
  readonly q: number[];
  readonly r: number[];
}

/**
 * Construction du mur (`1120:1461`) : cinq tirages `(a, b, c)` avec rejet (les trois sont tirés à chaque essai, `c` ne compte qu'aux niveaux 2 et 3), remplissage par niveau,
 * puis mélange du niveau 1 (une valeur `rand(1) + 2`) ou du niveau 3 (deux `rand(1)`, le second écrasé).
 */
export function drawWall(rng: MsvcRandom, level: number): NetWall {
  const size = tileCount(level);
  const p = new Array<number>(size).fill(0);
  const q = new Array<number>(size).fill(0);
  const r = level < 2 ? [] : new Array<number>(size).fill(0);
  const usedA = [0, 0, 0, 0, 0];
  const usedB = [0, 0, 0, 0, 0];
  const usedC = [0, 0, 0, 0, 0];
  for (let k = 0; k < 5; k++) {
    let a: number;
    let b: number;
    for (;;) {
      a = rng.rand(4);
      b = rng.rand(4);
      const c = rng.rand(4);
      const free = level < 2 ? usedB[b] === 0 && usedA[a] === 0 : usedA[a] === 0 && usedB[b] === 0 && usedC[c] === 0;
      if (free) {
        usedA[a]! += 1;
        usedB[b]! += 1;
        usedC[c]! += 1;
        break;
      }
    }
    if (level < 2) {
      // Rang `k` : `P = a` ; colonne `k` : `Q = b`.
      for (let j = 0; j < 5; j++) {
        p[k * 5 + j] = a;
        q[j * 5 + k] = b;
      }
    } else {
      // `P` constant par plan (25 dalles), `Q` par rang de chaque plan, `R` (le `b` du rang `k`, `1120:1646`) par colonne de chaque rang.
      for (let j = 0; j < 25; j++) p[k * 25 + j] = a;
      for (let plane = 0; plane < 5; plane++) for (let j = 0; j < 5; j++) q[k * 5 + plane * 25 + j] = b;
      for (let plane = 0; plane < 5; plane++) for (let row = 0; row < 5; row++) r[plane * 5 + row * 25 + k] = b;
    }
  }
  if (level === 1) {
    // Colonnes de `Q` : chaque rang est le précédent tourné de `s` crans vers la droite (`1120:1674`).
    const s = rng.rand(1) + 2;
    for (let row = 1; row < 5; row++) {
      const previous = q.slice((row - 1) * 5, row * 5);
      for (let c = 0; c < 5; c++) q[row * 5 + c] = previous[(c - s + 10) % 5]!;
    }
  } else if (level === 3) {
    const s = rng.rand(1) + 2;
    rng.rand(1);
    // `1120:1758` : pour chaque rang, chaque colonne ≥ 1 reprend le vecteur des cinq plans de la colonne précédente, tourné de `s` crans.
    for (let row = 0; row < 5; row++) {
      for (let c = 1; c < 5; c++) {
        const previous = [0, 1, 2, 3, 4].map((plane) => p[row * 5 + c - 1 + plane * 25]!);
        for (let plane = 0; plane < 5; plane++) p[row * 5 + c + plane * 25] = previous[(plane - s + 10) % 5]!;
      }
    }
  }
  return { p, q, r };
}

/** Pose des groupes (`1120:1461`) : pour chaque groupe, une dalle tirée (`rand(24)` ou `rand(124)`) sans groupe reçoit sa taille. Renvoie le tableau `1458:040A` (0 : pas de groupe). */
export function placeGroups(rng: MsvcRandom, level: number, sizes: readonly number[]): number[] {
  const groups = new Array<number>(tileCount(level)).fill(0);
  const max = tileCount(level) - 1;
  for (const size of sizes) {
    let tile: number;
    do tile = rng.rand(max);
    while (groups[tile]! !== 0);
    groups[tile] = size;
  }
  return groups;
}

/** Affectation sélecteurs ↔ `P`, `Q`, `R` (`1120:2657`, `[8ba8]` aux niveaux 2 et 3) : indice de sélecteur (0 à 2 = sélecteur 1 à 3) de `P`, `Q`, `R`. */
export const SELECTOR_ORDERS: readonly (readonly [number, number, number])[] = [
  [2, 1, 0],
  [1, 2, 0],
  [0, 2, 1],
  [2, 0, 1],
  [1, 0, 2],
  [0, 1, 2],
];

export interface NetState {
  readonly level: number;
  /** Nombre de Zoombinis `n` (`DS:89b2`). */
  readonly members: number;
  readonly tiles: number;
  readonly wall: NetWall;
  /** Tailles des groupes (`1458:03F2`) et tableau des dalles (`1458:040A`) : taille du groupe caché, 0 = vide, −1 = déjà passé. */
  readonly sizes: readonly number[];
  readonly groups: number[];
  /** Affectation des sélecteurs : aux niveaux 0 et 1, `swap` (`[89cc] == 2`) échange `P` et `Q` ; aux niveaux 2 et 3, `order` (`[8ba8]`). */
  readonly swap: boolean;
  readonly order: number;
  /** Valeurs des sélecteurs 1 à 3 (`DS:8b7e`, `8b82`, `8b86` ; −1 = aucune) et valeurs précédentes (`8b80`, `8b84`, `8b88`, pour l'image de la boule). */
  selectors: [number, number, number];
  previous: [number, number, number];
  /** Munitions restantes (`DS:8b4a`) et au départ. Négatif après le dernier tir. */
  ammo: number;
  readonly startAmmo: number;
  /** Boules tirées (atterries), tirs qui ont libéré un groupe (`DS:8bba`), manqués (`DS:8b8e`, cumul). */
  shots: number;
  hits: number;
  misses: number;
  /** Zoombinis libérés (`DS:89b8`). */
  freed: number;
  /** Plus de tir (`DS:8b6c`). */
  exhausted: boolean;
}

/** Tirages de `1120:0000` puis `1120:1461` : sélecteurs initiaux, mur, groupes, affectation des attributs. */
export function newNet(rng: MsvcRandom, level: number, members: number): NetState {
  if (!Number.isInteger(level) || level < 0 || level >= NET_LEVELS) throw new RangeError(`net : niveau ${level}`);
  if (members < 1) throw new RangeError("net : aucun Zoombini");
  const selectors: [number, number, number] = [rng.rand(4), rng.rand(4), rng.rand(4)];
  const sizes = groupSizes(members);
  const wall = drawWall(rng, level);
  const groups = placeGroups(rng, level, sizes);
  let swap = false;
  let order = 0;
  if (level < 3) {
    // `rand(1)` : 0 → rôles (1, 2), sinon (2, 1) ; `[89cc] == 2` échange `P` et `Q` aux niveaux 0 et 1 (au niveau 2 l'affectation est `[8ba8]`).
    swap = rng.rand(1) !== 0;
  } else {
    for (;;) {
      const a = rng.rand(2);
      const b = rng.rand(2);
      const c = rng.rand(2);
      if (a !== b && b !== c && c !== a) break;
    }
    order = rng.rand(5);
  }
  const startAmmo = startingAmmo(level, sizes.length);
  return {
    level,
    members,
    tiles: tileCount(level),
    wall,
    sizes,
    groups,
    swap,
    order,
    selectors,
    previous: [-1, -1, -1],
    ammo: startAmmo,
    startAmmo,
    shots: 0,
    hits: 0,
    misses: 0,
    freed: 0,
    exhausted: false,
  };
}

/** Rôles des sélecteurs : les indices (0 à 2) de ceux qui fournissent `P`, `Q`, `R` (`R` = −1 aux niveaux 0 et 1). */
export function selectorRoles(state: Pick<NetState, "level" | "swap" | "order">): readonly [number, number, number] {
  if (state.level < 2) return state.swap ? [2, 1, -1] : [1, 2, -1];
  return SELECTOR_ORDERS[state.level === 2 ? 0 : state.order]!;
}

/** Dalle atteinte (`1120:2657`) : la première dalle dont les signes sont les valeurs des sélecteurs, −1 s'il n'y en a pas. */
export function aimedTile(state: NetState, selectors: readonly number[] = state.selectors): number {
  const [roleP, roleQ, roleR] = selectorRoles(state);
  const wantP = selectors[roleP]!;
  const wantQ = selectors[roleQ]!;
  const wantR = roleR < 0 ? 0 : selectors[roleR]!;
  const { p, q, r } = state.wall;
  for (let t = 0; t < state.tiles; t++) {
    if (p[t] === wantP && q[t] === wantQ && (roleR < 0 || r[t] === wantR)) return t;
  }
  return -1;
}

/** Les sélecteurs sont-ils tous réglés pour un tir (`1b9b` : 2 et 3 aux niveaux 0 et 1, les trois ensuite) ? */
export function isComplete(state: Pick<NetState, "level" | "selectors">): boolean {
  const [s1, s2, s3] = state.selectors;
  return s2 >= 0 && s3 >= 0 && (state.level < 2 || s1 >= 0);
}

/**
 * Règle le sélecteur `row` (0 à 2) sur `value` (`1120:1b9b`, cas 1 à 3) : les valeurs précédentes servent à l'image de la boule. Au niveau 0 et 1 la rangée 0 n'existe pas.
 * Renvoie vrai si la valeur change.
 */
export function setSelector(state: NetState, row: 0 | 1 | 2, value: number): boolean {
  if (value < 0 || value >= NET_SYMBOLS) throw new RangeError(`net : symbole ${value}`);
  if (row === 0 && state.level < 2) return false;
  const changed = state.selectors[row] !== value;
  // Cas 1 et 2 : valeurs précédentes des rangées 1 et 2 ; cas 3 : aussi celle de la rangée 3.
  if (row === 2) state.previous[2] = state.selectors[2];
  state.previous[1] = state.selectors[1];
  state.previous[0] = state.selectors[0];
  state.selectors[row] = value;
  return changed;
}

/** Tir (`1120:1b9b`, cas 0) : les valeurs courantes deviennent les précédentes ; renvoie la dalle visée (−1 : aucune). */
export function aim(state: NetState): number {
  state.previous = [...state.selectors];
  return aimedTile(state);
}

/** Colonne du mur (0 à 4) d'une dalle : celle de la réaction de la boule (`SCRB` 8000 + colonne) et du vol (`1120:1b9b`). */
export function wallColumn(level: number, tile: number): number {
  return level < 2 ? tile % 5 : Math.floor((tile % 25) / 5);
}

/** Vol de la boule selon la colonne : 1 pour la colonne 0, 2 pour la colonne 4, 0 sinon (`DS:19ba`, `SCRB` 7028 + `19ba`). */
export function flightKind(column: number): 0 | 1 | 2 {
  return column === 0 ? 1 : column === 4 ? 2 : 0;
}

/**
 * Impact de la boule sur `tile` (`1120:248b`) : le groupe caché est libéré (et la dalle marquée « passée », `−1`), sinon le tir est manqué (dalle vide, déjà passée ou hors du mur).
 * Renvoie le nombre de Zoombinis libérés (0 : tir manqué).
 */
export function impact(state: NetState, tile: number): number {
  if (tile < 0 || tile >= state.tiles) {
    state.misses += 1;
    return 0;
  }
  const g = state.groups[tile]!;
  state.groups[tile] = -1;
  if (g > 0) {
    state.hits += 1;
    state.freed += g;
    return g;
  }
  state.misses += 1;
  return 0;
}

/**
 * Fin de l'animation de la boule (`1120:0554`) : une boule de moins ; si `[8b4a]` valait déjà 0 avant la décrémentation, c'est le dernier tir (`DS:8b6c`). Renvoie vrai pour ce dernier tir.
 */
export function endOfShot(state: NetState): boolean {
  state.shots += 1;
  const wasEmpty = state.ammo < 1;
  state.ammo -= 1;
  if (wasEmpty) state.exhausted = true;
  return wasEmpty;
}

/** Tous les Zoombinis sont libérés (`DS:89b8 ≥ DS:89b2`). */
export function isWon(state: NetState): boolean {
  return state.freed >= state.members;
}

/** Tirs possibles en tout : `munitions + 1` (le dernier tir est joué avant l'arrêt). */
export function totalShots(state: Pick<NetState, "startAmmo">): number {
  return state.startAmmo + 1;
}

/** Zoombinis perdus à la sortie : ceux qui n'ont pas franchi le mur (`1168:36e1`, `+0x127 = 0`). */
export function lostCount(members: number, crossed: number): number {
  return Math.max(0, members - crossed);
}

/**
 * Voix de fin de munitions (`1120:0554`) : si `rand(4) > niveau` (ou, `(S+0x3C & 0xfff) < 4`, joueur débutant) et que le dernier tir a manqué avec une réussite partielle (`0 < libérés < n`),
 * la voix de regret ; ici renvoie la condition (le tirage de la voix reste à l'écran).
 */
export function wantsRegretVoice(state: NetState, draw: number, lastShotMissed: boolean, novice: boolean): boolean {
  if (!(state.level < draw || novice)) return false;
  return lastShotMissed && state.freed > 0 && state.freed < state.members;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Robot : joue sans connaître les signes, d'après les seuls impacts et les marques des dalles

const PERMUTATIONS: readonly (readonly number[])[] = (() => {
  const out: number[][] = [];
  const build = (rest: number[], head: number[]): void => {
    if (rest.length === 0) {
      out.push(head);
      return;
    }
    for (let i = 0; i < rest.length; i++) build([...rest.slice(0, i), ...rest.slice(i + 1)], [...head, rest[i]!]);
  };
  build([0, 1, 2, 3, 4], []);
  return out;
})();
const INVERSES: readonly (readonly number[])[] = PERMUTATIONS.map((perm) => {
  const inverse = new Array<number>(5);
  perm.forEach((value, index) => (inverse[value] = index));
  return inverse;
});

/** Une disposition possible du mur : permutations `a` et `b` (rangs, colonnes), mélange `shift` (niveaux 1 et 3) et affectation des sélecteurs (`variant`). */
interface Hypothesis {
  a: number;
  b: number;
  shift: number;
  variant: number;
}

/** Dalle qu'une hypothèse donne à un triplet de valeurs de sélecteurs. */
function hypothesisTile(level: number, h: Hypothesis, selectors: readonly number[]): number {
  const aInv = INVERSES[h.a]!;
  const bInv = INVERSES[h.b]!;
  if (level < 2) {
    const [p, q] = h.variant === 1 ? [selectors[2]!, selectors[1]!] : [selectors[1]!, selectors[2]!];
    const row = aInv[p]!;
    const qIndex = bInv[q]!;
    const col = level === 0 ? qIndex : (qIndex + h.shift * row) % 5;
    return row * 5 + col;
  }
  const order = SELECTOR_ORDERS[h.variant]!;
  const p = selectors[order[0]]!;
  const q = selectors[order[1]]!;
  const r = selectors[order[2]]!;
  const row = bInv[q]!;
  const col = bInv[r]!;
  const aIndex = aInv[p]!;
  const plane = level === 2 ? aIndex : (aIndex + h.shift * col) % 5;
  return plane * 25 + row * 5 + col;
}

/** Triplet de valeurs qui vise `tile` dans l'hypothèse `h` (réciproque de `hypothesisTile`). */
function hypothesisSelectors(level: number, h: Hypothesis, tile: number): number[] {
  const a = PERMUTATIONS[h.a]!;
  const b = PERMUTATIONS[h.b]!;
  const out = [0, 0, 0];
  if (level < 2) {
    const row = Math.floor(tile / 5);
    const col = tile % 5;
    const p = a[row]!;
    const qIndex = level === 0 ? col : (((col - h.shift * row) % 5) + 5) % 5;
    const q = b[qIndex]!;
    if (h.variant === 1) {
      out[2] = p;
      out[1] = q;
    } else {
      out[1] = p;
      out[2] = q;
    }
    return out;
  }
  const plane = Math.floor(tile / 25);
  const row = Math.floor((tile % 25) / 5);
  const col = tile % 5;
  const aIndex = level === 2 ? plane : (((plane - h.shift * col) % 5) + 5) % 5;
  const order = SELECTOR_ORDERS[h.variant]!;
  out[order[0]] = a[aIndex]!;
  out[order[1]] = b[row]!;
  out[order[2]] = b[col]!;
  return out;
}

export interface RobotShot {
  /** Valeurs des sélecteurs tirées et dalle atteinte. */
  selectors: number[];
  tile: number;
  /** Zoombinis libérés par ce tir. */
  released: number;
  /** Dalle visée par le robot (une dalle marquée) : `-1` pour un tir d'exploration. */
  target: number;
}

export interface RobotResult {
  shots: RobotShot[];
  /** Hypothèses de disposition encore compatibles avec les impacts à la fin. */
  remaining: number;
}

/**
 * Robot : sans connaître les permutations ni les rôles des sélecteurs (il connaît les règles de construction et voit les dalles marquées et le point d'impact de chaque boule), il garde
 * toutes les dispositions compatibles avec les impacts déjà vus et vise la prochaine dalle marquée comme le ferait la première d'entre elles ; chaque tir, réussi ou non, en élimine.
 * Joue sur `state` (`aim`, `impact`, `endOfShot`) jusqu'à la fin des tirs ou de tous les groupes. Les dalles marquées sont celles de `state.groups`.
 */
export function netRobot(state: NetState): RobotResult {
  const level = state.level;
  const two = level < 2;
  const shifts = level === 1 || level === 3 ? [2, 3] : [0];
  const variants = two ? [0, 1] : [0, 1, 2, 3, 4, 5];
  let hypotheses: Hypothesis[] = [];
  for (let a = 0; a < 120; a++) for (let b = 0; b < 120; b++) for (const shift of shifts) for (const variant of variants) hypotheses.push({ a, b, shift, variant });
  const shots: RobotShot[] = [];
  const observed: { selectors: number[]; tile: number }[] = [];
  while (!state.exhausted && !isWon(state)) {
    // Prochaine dalle marquée : la plus proche de l'origine du tableau.
    const target = state.groups.findIndex((g) => g > 0);
    if (target < 0) break;
    const first = hypotheses[0];
    if (!first) throw new Error("net : le robot n'a plus d'hypothèse");
    const selectors = hypothesisSelectors(level, first, target);
    for (let k = 0; k < 3; k++) state.selectors[k] = k < selectors.length ? selectors[k]! : 0;
    if (two) state.selectors[0] = -1;
    const tile = aim(state);
    const released = impact(state, tile);
    endOfShot(state);
    shots.push({ selectors: [...selectors], tile, released, target });
    observed.push({ selectors: [...selectors], tile });
    const last = observed[observed.length - 1]!;
    hypotheses = hypotheses.filter((h) => hypothesisTile(level, h, last.selectors) === last.tile);
  }
  return { shots, remaining: hypotheses.length };
}
