import type { MsvcRandom } from "../../../../engine/mohawk/rng";
import type { Attrs } from "../state";

/**
 * Règles de la fosse de monte-pierre (`SLIDES.MHK`, écran 12 ; `docs/zoombinis/puzzles/slides.md`). Fonctions pures, sans rendu ni texte.
 *
 * Le plateau est un treillis de 117 pierres (13 rangées de 9, rangées paires et impaires décalées). Les pierres sont des départs, des
 * emplacements pour un Zoombini et des liaisons ; une liaison porte l'un des 4 attributs (symbole) ou n'en porte pas (« libre »). Le joueur
 * pose chaque Zoombini du groupe sur un emplacement ; une liaison monte quand les deux Zoombinis qu'elle sépare ont la même valeur de
 * l'attribut demandé, et un emplacement est « relié » (état `0x1fc`) quand une suite de liaisons montées le rattache à un départ. Seuls les
 * Zoombinis reliés au moment de « go » sont sauvés (`1170:2d65`).
 *
 * Générateurs (niveau 0 à 3) : l'ordre des tirages est celui de l'original pour les niveaux 0, 1 et 2 (`1170:2dfb`, `1170:312b`,
 * `1150:0000` cas 2 avec `1170:34cf`, `47af`, `35c7`, `3896`) et pour les plateaux de 1 à 5 Zoombinis du niveau 3. Écart : le niveau 3 à
 * 6 Zoombinis et plus pose les membres par un arbre de même propriété que `1150:1a03` (voir `growHoneycomb`), pas dans l'ordre exact des
 * tirages de `1150:1c62` / `2222`, et l'élagage `1150:1f55` / `316c` est remplacé par un élagage des culs-de-sac de pierres.
 */

// --- Plateau : géométrie ---

export const STONE_COUNT = 117;
export const BOARD_ROWS = 13;
export const BOARD_COLS = 9;
export const ATTRIBUTES = 4;
/** Décalage de l'emplacement par rapport à la pierre (`1150:0000` : `x + 0x18`, `y − 5`) : position du Zoombini posé et cible de dépôt. */
export const SLOT_OFFSET = { x: 24, y: -5 } as const;
/** Tolérance de dépôt, `DS:9706` : 15 (posée par `11a8:038e` à chaque sortie d'écran ; `SLIDES` ne la change pas). Le dépôt vise un carré de côté 31. */
export const DROP_TOLERANCE = 15;

/** Position écran de la pierre `i` (`14e8:0000 + 4 i`, 117 couples relus dans le NE : `x = 477 + 5 r − 21 (r impair) − 42 c`, `y = 152 + 18 r`). */
export function stonePosition(i: number): { x: number; y: number } {
  const r = Math.trunc(i / BOARD_COLS);
  const c = i % BOARD_COLS;
  return { x: 477 + 5 * r - (r & 1) * 21 - 42 * c, y: 152 + 18 * r };
}

/** Position de l'emplacement porté par la pierre `i` (`14e8:01d4 + 4 k`) : cible de dépôt du rang `k` et lieu d'affichage du Zoombini. */
export function slotPosition(i: number): { x: number; y: number } {
  const p = stonePosition(i);
  return { x: p.x + SLOT_OFFSET.x, y: p.y + SLOT_OFFSET.y };
}

/** Les 16 positions d'attente d'un Zoombini hors plateau (`14e8:0bba`, 16 couples ; choix du libre : `1170:509f`). */
export const WAITING_POSITIONS: readonly { x: number; y: number }[] = [
  { x: 482, y: 127 },
  { x: 428, y: 128 },
  { x: 375, y: 129 },
  { x: 318, y: 127 },
  { x: 272, y: 129 },
  { x: 226, y: 128 },
  { x: 184, y: 127 },
  { x: 140, y: 129 },
  { x: 87, y: 128 },
  { x: 110, y: 170 },
  { x: 122, y: 246 },
  { x: 84, y: 212 },
  { x: 140, y: 327 },
  { x: 77, y: 293 },
  { x: 40, y: 157 },
  { x: 44, y: 232 },
];

/**
 * `1170:509f` : indice (0 à 15) de la position d'attente libre à utiliser. L'original tire à pile ou face (`10a8:04e8(100, 1) < 0x33`) le sens du
 * balayage : de la dernière position vers la première (`fromEnd`) ou l'inverse ; sans position libre, la première. `taken[i]` : la position `i` est prise.
 */
export function pickWaitingPosition(taken: readonly boolean[], fromEnd: boolean): number {
  const n = WAITING_POSITIONS.length;
  for (let t = 0; t < n; t++) {
    const i = fromEnd ? n - 1 - t : t;
    if (!taken[i]) return i;
  }
  return 0;
}

/** Rang (0 à `slots − 1`) du premier emplacement dont la cible est dans le carré `±DROP_TOLERANCE` autour de `(x, y)` (`1168:18d8`…`19c0`, `1168:166e`), sinon −1. Ordre d'enregistrement : **probable**. */
export function findDropSlot(board: SlidesBoard, x: number, y: number): number {
  for (let k = 0; k < board.slots.length; k++) {
    const p = slotPosition(board.slots[k]!);
    if (Math.abs(p.x - x) <= DROP_TOLERANCE && Math.abs(p.y - y) <= DROP_TOLERANCE) return k;
  }
  return -1;
}

/** Codes d'état d'une case de l'original (`+2` de l'enregistrement de 18 octets), pour les filtres de rendu (`1170:20cc`). */
export const STATE = {
  void: 500,
  linkLow: 0x1f5,
  linkRaised: 0x1f6,
  start: 0x1f8,
  startAlt: 0x1f9,
  slotFree: 0x1fa,
  slotOccupied: 0x1fb,
  slotConnected: 0x1fc,
} as const;
/** Symbole d'une liaison : `0x1fe + attribut` (parties 0x49 à 0x4c de l'image de la pierre). */
export const SYMBOL_BASE = 0x1fe;

// --- Plateau : structure ---

export type StoneKind = "void" | "start" | "link" | "slot";

export interface Stone {
  kind: StoneKind;
  /** Liaison : attribut demandé (0 à 3) ; `null` = liaison libre, sans symbole (aussi les emplacements inutilisés des niveaux 2 et 3, devenus de simples pierres). */
  attr: number | null;
  /** Les 6 voisins (directions 0 haut-droite, 1 droite, 2 bas-droite, 3 bas-gauche, 4 gauche, 5 haut-gauche), −1 sans voisin (`1170:1828`). */
  neighbors: readonly number[];
  /** Masque de liaisons (bit `k` = relié au voisin `k`) : les connecteurs que dessine le filtre `1170:20cc`. */
  mask: number;
}

export interface SlidesBoard {
  level: number;
  /** Taille du groupe pour lequel le plateau est fait : il y a exactement autant d'emplacements. */
  size: number;
  stones: readonly Stone[];
  /** Cases de départ (pierres que franchissent les Zoombinis reliés). */
  starts: readonly number[];
  /** Variante visuelle de la pierre de départ (`DS:9d5e − 0x1f8` ; tirée au niveau 3 seulement). */
  startVariant: 0 | 1;
  /** Case de chaque emplacement, dans l'ordre d'enregistrement (rang `k − 1` de `S14:0240`). */
  slots: readonly number[];
  /** Membre prévu par le générateur pour chaque emplacement (−1 : aucun, emplacement ajouté pour compléter). Sert de repli au robot et aux tests. */
  solution: readonly number[];
}

/** Décalages (rangée, colonne) des 6 directions, rangée paire puis impaire (`1170:1828`). */
const DIRECTIONS: readonly (readonly (readonly [number, number])[])[] = [
  [[-1, -1], [0, -1], [1, -1], [1, 0], [0, 1], [-1, 0]],
  [[-1, 0], [0, -1], [1, 0], [1, 1], [0, 1], [-1, 1]],
];

/** `1170:1828` : voisins d'une case à partir de son masque ; les bords du treillis ne produisent aucun voisin. */
export function neighborsFromMask(i: number, mask: number): number[] {
  const r = Math.trunc(i / BOARD_COLS);
  const c = i % BOARD_COLS;
  const offsets = DIRECTIONS[r & 1]!;
  return offsets.map(([dr, dc], k) => {
    if ((mask & (1 << k)) === 0) return -1;
    const rr = r + dr;
    const cc = c + dc;
    return rr < 0 || rr >= BOARD_ROWS || cc < 0 || cc >= BOARD_COLS ? -1 : rr * BOARD_COLS + cc;
  });
}

class Builder {
  readonly kind: StoneKind[] = new Array<StoneKind>(STONE_COUNT).fill("void");
  readonly attr: (number | null)[] = new Array<number | null>(STONE_COUNT).fill(null);
  readonly mask: number[] = new Array<number>(STONE_COUNT).fill(0);
  readonly slots: number[] = [];
  readonly solution: number[] = [];

  start(i: number): void {
    this.kind[i] = "start";
  }
  link(i: number, attr: number | null): void {
    this.kind[i] = "link";
    this.attr[i] = attr;
  }
  slot(i: number, member = -1): void {
    this.kind[i] = "slot";
    this.slots.push(i);
    this.solution.push(member);
  }

  finish(level: number, size: number, startVariant: 0 | 1): SlidesBoard {
    const stones: Stone[] = [];
    for (let i = 0; i < STONE_COUNT; i++) {
      const mask = this.kind[i] === "void" ? 0 : this.mask[i]!;
      stones.push({ kind: this.kind[i]!, attr: this.kind[i] === "link" ? this.attr[i]! : null, neighbors: neighborsFromMask(i, mask), mask });
    }
    const starts = stones.flatMap((s, i) => (s.kind === "start" ? [i] : []));
    return { level, size, stones, starts, startVariant, slots: this.slots, solution: this.solution };
  }
}

// --- Aides de tirage ---

type Members = readonly { readonly attrs: Attrs }[];

/** `1170:34cf` : rangs des membres, du plus « partenaire » au moins ; score = nombre de membres (soi compris) partageant au moins un attribut. */
export function rankMembers(members: Members): number[] {
  const n = members.length;
  const score = members.map((a) => members.filter((b) => a.attrs.some((v, k) => v === b.attrs[k])).length);
  const rank: number[] = [];
  for (let t = 0; t < n; t++) {
    let best = 0;
    let at = 0;
    for (let j = 0; j < n; j++) {
      if (best < score[j]!) {
        best = score[j]!;
        at = j;
      }
    }
    rank.push(at);
    score[at] = -1;
  }
  return rank;
}

/** `1170:3896` : attribut commun de deux membres, avec l'ordre de priorité tiré par `rand(1000)` (< 250, < 500, < 750, sinon) ; `null` sans attribut commun. */
function pickCommonAttr(rng: MsvcRandom, a: Attrs, b: Attrs): number | null {
  const r = rng.rand(1000);
  const start = r < 250 ? 0 : r < 500 ? 1 : r < 750 ? 2 : 3;
  for (let t = 0; t < ATTRIBUTES; t++) {
    const k = (start + t) % ATTRIBUTES;
    if (a[k] === b[k]) return k;
  }
  return null;
}

/** `1150:1b3e` : premier attribut commun (dans l'ordre 0 à 3), `null` sans. */
function firstCommonAttr(a: Attrs, b: Attrs): number | null {
  for (let k = 0; k < ATTRIBUTES; k++) if (a[k] === b[k]) return k;
  return null;
}

/** Marqueur d'un Zoombini sans partenaire (code `0x1f5` de l'original) ; au niveau 1, marqueur de liaison libre. */
const NO_PARTNER = -1;

// --- Niveau 0 : paires (`1170:2dfb`, `1150:0000` cas 0) ---

/** Cases de départ et pas entre unités selon le nombre d'unités (`DS:1d78`, `DS:1d94`, relus dans le NE ; indices 0 à 13). */
const ROW_BASE = [0, 54, 45, 36, 27, 18, 9, 0, 18, 18, 9, 9, 0, 0];
const ROW_STEP = [0, 0, 18, 18, 18, 18, 18, 18, 9, 9, 9, 9, 9, 9];

/**
 * `1170:2dfb` : unités du niveau 0 (code `0..3` = paire sur cet attribut, `NO_PARTNER` = seul), dans l'ordre du premier membre. Jusqu'à 10 essais ;
 * avec au moins 2 seuls (ou 1 pour `n` pair, impossible), les attributs du seul sont échangés avec ceux du membre 0 sur les copies (le multi-ensemble
 * des vecteurs ne change pas, donc le plateau reste résoluble) puis l'appariement recommence.
 * Au plus 5 seuls (deux seuls tardifs ne partagent aucun attribut, donc des valeurs toutes différentes sur l'attribut 0) : au plus 10 unités pour 16 membres,
 * dans la table `ROW_BASE`.
 */
export function pairUnits(members: Members, rng: MsvcRandom): number[] {
  return pairUnitsDetailed(members, rng).map((u) => u.code);
}

interface PairUnit {
  code: number;
  /** Membres réels de l'unité (1 ou 2), l'ordre est celui des emplacements. */
  members: number[];
}

function pairUnitsDetailed(members: Members, rng: MsvcRandom): PairUnit[] {
  const n = members.length;
  const copy = members.map((m) => [...m.attrs]);
  // `owner[i]` : membre réel dont le vecteur d'attributs est actuellement la copie `i` (les échanges permutent les vecteurs, pas les membres).
  const owner = members.map((_, i) => i);
  let attr = rng.rand(3);
  let done = false;
  let tries = 0;
  let units: PairUnit[] = [];
  while (!done) {
    units = [];
    const used = new Array<number>(n).fill(0);
    let singles = 0;
    for (let i = 0; i < n; i++) {
      let left = 4;
      while (used[i] === 0) {
        attr = attr + 1 > 3 ? 0 : attr + 1;
        for (let j = i + 1; j < n; j++) {
          if (used[j] === 0 && copy[i]![attr] === copy[j]![attr]) {
            units.push({ code: attr, members: [owner[i]!, owner[j]!] });
            used[j] = 1;
            used[i] = 1;
            break;
          }
        }
        left--;
        if (left === 0 && used[i] === 0) {
          used[i] = 99;
          units.push({ code: NO_PARTNER, members: [owner[i]!] });
          singles++;
        }
        if (left === 0) break;
      }
    }
    if (singles === 0 || (singles === 1 && n % 2 !== 0)) {
      done = true;
    } else {
      for (let i = n - 1; i >= 0; i--) {
        if (used[i] === 99 && used[0] !== 99) {
          const tmp = copy[i]!;
          copy[i] = copy[0]!;
          copy[0] = tmp;
          const who = owner[i]!;
          owner[i] = owner[0]!;
          owner[0] = who;
        }
      }
    }
    tries++;
    if (tries > 9) done = true;
  }
  return units;
}

function buildPairs(members: Members, rng: MsvcRandom): SlidesBoard {
  const detailed = pairUnitsDetailed(members, rng);
  const units = detailed.map((d) => d.code);
  const u = units.length;
  const base = ROW_BASE[u]!;
  const step = ROW_STEP[u]!;
  const b = new Builder();
  units.forEach((code, k) => {
    const row = k * step + base;
    let s = row;
    if (u > 7 && row % 2 !== 0) {
      // Départ élargi à 4 pierres (le dernier est le vrai départ) : pour que les rangées impaires s'alignent avec les paires.
      for (let t = 0; t < 4; t++) {
        b.start(row + t);
        b.mask[row + t] = t === 0 ? 0x10 : 0x12;
      }
      s = row + 3;
    } else {
      b.start(s);
    }
    b.slot(s + 1, detailed[k]!.members[0]);
    b.mask[s]! |= 0x10;
    if (code === NO_PARTNER) {
      b.mask[s + 1]! |= 2;
    } else {
      b.link(s + 2, code);
      b.slot(s + 3, detailed[k]!.members[1]);
      b.mask[s + 1] = 0x12;
      b.mask[s + 2] = 0x12;
      b.mask[s + 3]! |= 2;
    }
  });
  return b.finish(0, members.length, 0);
}

// --- Niveau 1 : chaînes de 3 (`1170:312b`, `1170:32bb`, `1150:0000` cas 1) ---

/** `1170:32bb` : premier membre inutilisé (≠ `from`) qui partage un attribut avec `from`, en essayant les 4 attributs à partir de `rand(3) + 1` ; `null` sans. */
function chainPartner(members: Members, used: readonly number[], from: number, rng: MsvcRandom): { member: number; attr: number } | null {
  let attr = rng.rand(3);
  for (let t = 0; t < ATTRIBUTES; t++) {
    attr = attr + 1 > 3 ? 0 : attr + 1;
    for (let j = 0; j < members.length; j++) {
      if (j !== from && used[j] === 0 && members[from]!.attrs[attr] === members[j]!.attrs[attr]) return { member: j, attr };
    }
  }
  return null;
}

/**
 * `1170:312b` : codes des liaisons du niveau 1, deux par chaîne : attribut `0..3`, `NO_PARTNER` pour une liaison libre (personne ne convient) ; entrées
 * absentes si le groupe est épuisé. Le membre de tête d'une chaîne suivante est le **dernier** membre inutilisé.
 */
export function chainLinks(members: Members, rng: MsvcRandom): (number | undefined)[] {
  return chainPlan(members, rng).codes;
}

/** `chainLinks` avec, pour chaque chaîne, les membres qui la composent (tête, puis un par liaison) : la solution du générateur. */
function chainPlan(members: Members, rng: MsvcRandom): { codes: (number | undefined)[]; chains: number[][] } {
  const n = members.length;
  const codes: (number | undefined)[] = [];
  const chains: number[][] = [];
  const used = new Array<number>(n).fill(0);
  const total = Math.ceil(n / 3);
  let at = 0;
  let head = 0;
  for (let chain = 0; chain < total; chain++) {
    used[head] = 1;
    const members3: number[] = [head];
    chains.push(members3);
    let a: number;
    const p1 = chainPartner(members, used, head, rng);
    if (p1 === null) {
      codes[at] = NO_PARTNER;
      a = -1;
      for (let j = 1; j < n; j++) {
        if (used[j] === 0) {
          used[j] = 1;
          a = j;
          break;
        }
      }
    } else {
      used[p1.member] = 1;
      codes[at] = p1.attr;
      a = p1.member;
    }
    if (a >= 0) members3.push(a);
    head = a;
    let left = -1;
    for (let j = 1; j < n; j++) if (used[j] === 0) left = j;
    if (left === -1) return { codes, chains };
    let b: number;
    const p2 = chainPartner(members, used, a, rng);
    if (p2 === null) {
      codes[at + 1] = NO_PARTNER;
      b = -1;
      for (let j = 1; j < n; j++) {
        if (used[j] === 0) {
          b = j;
          head = j;
        }
      }
    } else {
      used[p2.member] = 1;
      codes[at + 1] = p2.attr;
      b = p2.member;
    }
    if (b >= 0) members3.push(b);
    at += 2;
    used[b] = 1;
    left = -1;
    for (let j = 1; j < n; j++) {
      if (used[j] === 0) {
        left = j;
        head = j;
      }
    }
    if (left === -1) return { codes, chains };
  }
  return { codes, chains };
}

/** Construction des rangées du niveau 1 : transcription directe de `1150:0000` cas 1 (compteur `m` = membres déjà posés). */
function buildChains(members: Members, plan: { codes: readonly (number | undefined)[]; chains: readonly (readonly number[])[] }): SlidesBoard {
  const { codes, chains } = plan;
  const n = members.length;
  const u = Math.ceil(n / 3);
  const base = ROW_BASE[u]!;
  const step = ROW_STEP[u]!;
  const b = new Builder();
  let at = 0;
  let m = 0;
  for (let k = 0; k < u; k++) {
    const row = k * step + base;
    b.start(row);
    b.slot(row + 1, chains[k]?.[0]);
    if (n <= m + 1) {
      b.mask[row] = 0x10;
      b.mask[row + 1] = 2;
      break;
    }
    b.mask[row]! |= 0x10;
    b.mask[row + 1] = 0x12;
    const addLink = (offset: number): void => {
      const code = codes[at];
      b.link(row + offset, code === NO_PARTNER ? null : code!);
      b.slot(row + offset + 1, chains[k]?.[offset / 2]);
      b.mask[row + offset] = 0x12;
      b.mask[row + offset + 1]! |= 2;
      at++;
    };
    let next = m + 1;
    if (codes[at] !== undefined) {
      addLink(2);
      next = m + 2;
      if (n <= m + 2) break;
    }
    m = next;
    if (codes[at] !== undefined) {
      b.mask[row + 3]! |= 0x10;
      addLink(4);
      m++;
      if (n <= m) break;
    }
  }
  return b.finish(1, n, 0);
}

// --- Niveau 2 : échelle à 3 entrées (`1150:0000` cas 2) ---

/** Ordre des 18 emplacements (`DS:1dd4`) : colonne 2, colonne 4, sorties, entrées. Ordre d'enregistrement des emplacements conservés. */
const LADDER_SLOTS = [11, 29, 47, 65, 83, 101, 13, 31, 49, 67, 85, 103, 24, 60, 96, 19, 55, 91];
const LADDER_LINKS = [10, 12, 14, 28, 30, 32, 46, 48, 50, 64, 66, 68, 82, 84, 86, 100, 102, 104];
const LADDER_STARTS = [18, 54, 90];
const LADDER_EXITS = [24, 60, 96];
/** Les 12 emplacements de rail (`DS:1e04`). */
const LADDER_RAIL = [11, 13, 29, 31, 47, 49, 65, 67, 83, 85, 101, 103];
/** Paires de rail dont la liaison centrale reçoit un symbole (`3896(droite, gauche)` ; liaison = gauche + 1). */
const LADDER_RAIL_PAIRS: readonly (readonly [number, number])[] = [
  [13, 11],
  [31, 29],
  [49, 47],
  [67, 65],
  [85, 83],
  [103, 101],
];

function buildLadder(members: Members, rng: MsvcRandom): SlidesBoard {
  const n = members.length;
  const b = new Builder();
  // Masques posés par `1150:0000` (cas 2) : départs, entrées, sorties, rails.
  for (const s of LADDER_STARTS) {
    b.start(s);
    b.mask[s] = 0x10;
    b.mask[s + 1] = 0x2a;
    b.mask[s - 8]! |= 4;
    b.mask[s + 10]! |= 1;
  }
  for (const x of LADDER_EXITS) {
    b.mask[x] = 5;
    b.mask[x - 10]! |= 8;
    b.mask[x + 8]! |= 0x20;
  }
  for (const s of LADDER_RAIL) {
    b.mask[s]! |= 0x12;
    b.mask[s - 1]! |= 0x10;
    b.mask[s + 1]! |= 2;
  }

  // Solution : trois appels à `47af` dans un ordre tiré, chacun posant l'entrée, la sortie (+5) et leurs voisins de rail (`35c7`).
  const rank = rankMembers(members);
  const usedRank = new Array<boolean>(n).fill(false);
  const designated = new Map<number, number>();
  const linkAttr = new Map<number, number>();
  const firstFree = (): number => usedRank.findIndex((u) => !u);
  /** `1170:35c7` : pose, sur `slot` relié à `from` par `link`, le dernier membre du rang qui partage un attribut (essayé à partir de `rand(3)`) avec celui de `from`. */
  const attach = (link: number, slot: number, from: number): boolean => {
    const r = rng.rand(3);
    const fromAttrs = members[designated.get(from)!]!.attrs;
    for (let i = n - 1; i >= 0; i--) {
      if (usedRank[i]) continue;
      const cand = members[rank[i]!]!.attrs;
      for (let t = 0; t < ATTRIBUTES; t++) {
        const k = (r + t) % ATTRIBUTES;
        if (fromAttrs[k] === cand[k]) {
          designated.set(slot, rank[i]!);
          linkAttr.set(link, k);
          usedRank[i] = true;
          return true;
        }
      }
    }
    return false;
  };
  const place = (entrance: number): void => {
    const exit = entrance + 5;
    const i = firstFree();
    if (i >= 0) {
      designated.set(entrance, rank[i]!);
      usedRank[i] = true;
    }
    const j = firstFree();
    if (j >= 0) {
      designated.set(exit, rank[j]!);
      usedRank[j] = true;
    }
    if (designated.has(entrance) && attach(entrance - 9, entrance - 8, entrance)) attach(entrance + 9, entrance + 10, entrance);
    if (designated.has(exit) && attach(exit - 10, exit - 11, exit)) attach(exit + 8, exit + 7, exit);
  };
  if (rng.rand(100) < 0x32) {
    place(19);
    place(55);
    place(91);
  } else if (rng.rand(100) < 0x32) {
    place(55);
    place(91);
    place(19);
  } else {
    place(91);
    place(19);
    place(55);
  }
  for (const [right, left] of LADDER_RAIL_PAIRS) {
    const mr = designated.get(right);
    const ml = designated.get(left);
    if (mr === undefined || ml === undefined) continue;
    const k = pickCommonAttr(rng, members[mr]!.attrs, members[ml]!.attrs);
    if (k !== null) linkAttr.set(left + 1, k);
  }

  // Emplacements : ceux de la solution, puis, s'il manque des emplacements, les premiers libres dans l'ordre de `DS:1dd4` (sans membre prévu).
  const occupied = new Set(designated.keys());
  let missing = n - occupied.size;
  for (const s of LADDER_SLOTS) {
    if (missing <= 0) break;
    if (!occupied.has(s)) {
      occupied.add(s);
      missing--;
    }
  }
  for (const l of LADDER_LINKS) b.link(l, linkAttr.get(l) ?? null);
  for (const s of LADDER_SLOTS) {
    if (occupied.has(s)) b.slot(s, designated.get(s) ?? -1);
    else b.link(s, null);
  }
  return b.finish(2, n, 0);
}

// --- Niveau 3 : nid d'abeilles à 1 entrée (`1150:0000` cas 3) ---

/** Les 26 emplacements (`1488:0000`, par ordre croissant) et les 43 liaisons (`1490:0000`). */
const HONEY_SLOTS = [2, 4, 6, 19, 21, 23, 25, 38, 40, 42, 44, 55, 57, 59, 61, 74, 76, 78, 80, 91, 93, 95, 97, 110, 112, 114];
const HONEY_LINKS = [
  10, 11, 12, 13, 14, 15, 28, 29, 30, 31, 32, 33, 34, 46, 47, 48, 49, 50, 51, 52, 56, 58, 60, 64, 65, 66, 67, 68, 69, 70, 82, 83, 84, 85, 86, 87, 88, 100, 101, 102, 103, 104, 105,
];
/** Masques des liaisons (`1498:0000` : `0x24`, `14a0:0000` : `9`) et des autres cases, tels que `1150:0000` les pose. */
const HONEY_MASK_24 = [10, 12, 14, 29, 31, 33, 46, 48, 50, 52, 65, 67, 69, 82, 84, 86, 88, 101, 103, 105];
const HONEY_MASK_09 = [11, 13, 15, 28, 30, 32, 34, 47, 49, 51, 64, 66, 68, 70, 83, 85, 87, 100, 102, 104];
const HONEY_MASK_OTHER: readonly (readonly [number, number])[] = [
  [54, 0x10], [55, 0x3a], [56, 0x12], [57, 0x3f], [58, 0x12], [59, 0x3f], [60, 0x12], [61, 0x2f],
  [2, 0xc], [4, 0xc], [6, 0xc], [19, 0x28], [21, 0x2d], [23, 0x2d], [25, 0xd], [38, 0x2d], [40, 0x2d], [42, 0x2d], [44, 0x5],
  [74, 0x2d], [76, 0x2d], [78, 0x2d], [80, 0x5], [91, 0x28], [93, 0x2d], [95, 0x2d], [97, 0x25], [110, 0x21], [112, 0x21], [114, 0x21],
];
const HONEY_ENTRANCE = 55;
const HONEY_START = 54;
/** Ordre des pivots (`DS:1e1c`) et ordre de repli pour les membres restants (`DS:1e36`). */
const HONEY_PIVOTS = [55, 40, 76, 23, 95, 42, 78, 38, 74, 21, 93, 19, 91];
const HONEY_FILL = [55, 57, 59, 61, 38, 74, 40, 76, 42, 78, 44, 80, 21, 93, 23, 95, 25, 97, 4, 112, 19, 25];

function honeycombMasks(): number[] {
  const mask = new Array<number>(STONE_COUNT).fill(0);
  for (const i of HONEY_MASK_24) mask[i] = 0x24;
  for (const i of HONEY_MASK_09) mask[i] = 9;
  for (const [i, m] of HONEY_MASK_OTHER) mask[i] = m;
  return mask;
}

/** Voisins d'une case dans le nid d'abeilles complet (avant retrait des cases inutilisées). */
function honeycombNeighbors(): number[][] {
  const mask = honeycombMasks();
  return mask.map((m, i) => neighborsFromMask(i, m));
}

/**
 * Plateau du niveau 3 : `chosen` = emplacements gardés (les autres deviennent de simples pierres), `cells` = cases présentes (le reste est vide).
 * Les masques sont restreints aux cases présentes (équivalent de `1150:329c`, qui coupe les voisins retirés).
 */
function honeycombBoard(
  members: Members,
  startVariant: 0 | 1,
  keptSlots: ReadonlySet<number>,
  present: ReadonlySet<number>,
  linkAttrs: ReadonlyMap<number, number>,
  designated: ReadonlyMap<number, number>,
): SlidesBoard {
  const full = honeycombMasks();
  const nb = honeycombNeighbors();
  const b = new Builder();
  b.start(HONEY_START);
  for (const l of HONEY_LINKS) if (present.has(l)) b.link(l, linkAttrs.get(l) ?? null);
  for (const s of HONEY_SLOTS) {
    if (!present.has(s)) continue;
    if (keptSlots.has(s)) b.slot(s, designated.get(s) ?? -1);
    else b.link(s, null);
  }
  for (let i = 0; i < STONE_COUNT; i++) {
    if (b.kind[i] === "void") continue;
    let m = 0;
    for (let k = 0; k < 6; k++) {
      const j = nb[i]![k]!;
      if (j >= 0 && (full[i]! & (1 << k)) !== 0 && b.kind[j] !== "void") m |= 1 << k;
    }
    b.mask[i] = m;
  }
  return b.finish(3, members.length, startVariant);
}

/** Emplacements voisins (via une liaison) de chaque emplacement du nid d'abeilles : `{ dir, link, to }`. */
function honeycombAdjacency(): Map<number, { dir: number; link: number; to: number }[]> {
  const nb = honeycombNeighbors();
  const slots = new Set(HONEY_SLOTS);
  const adj = new Map<number, { dir: number; link: number; to: number }[]>();
  for (const s of HONEY_SLOTS) {
    const list: { dir: number; link: number; to: number }[] = [];
    for (let k = 0; k < 6; k++) {
      const l = nb[s]![k]!;
      if (l < 0 || !HONEY_LINKS.includes(l)) continue;
      const to = nb[l]!.find((x) => x >= 0 && x !== s && slots.has(x));
      if (to !== undefined) list.push({ dir: k, link: l, to });
    }
    adj.set(s, list);
  }
  return adj;
}

/**
 * Niveau 3, 6 membres et plus. Arbre de membres posés depuis l'entrée 55 : chaque nouvel emplacement reçoit, dans l'ordre du rang (`34cf`), le
 * premier membre qui partage un attribut (essayé à partir de `rand(3)`) avec l'emplacement parent, et la liaison porte cet attribut (comme `1150:2222`).
 * Un premier balayage suit les pivots de `DS:1e1c` (directions 4, 5, 3 sur la rangée 6, sinon 5, 3), les suivants toutes les directions ; les liaisons
 * entre deux emplacements posés restées sans symbole en reçoivent un si les membres partagent un attribut (`3896`). Les membres sans partenaire sont posés
 * ensuite dans l'ordre de `DS:1e36` (`1150:249e`), puis dans n'importe quel emplacement libre. **Écart** : ordre exact des tirages de `1150:1c62` non reproduit.
 */
function growHoneycomb(members: Members, rng: MsvcRandom, startVariant: 0 | 1): SlidesBoard {
  const rank = rankMembers(members);
  const adj = honeycombAdjacency();
  const placed = new Map<number, number>();
  const order: number[] = [];
  const linkAttr = new Map<number, number>();
  const pool = rank.slice();
  const root = pool.shift()!;
  placed.set(HONEY_ENTRANCE, root);
  order.push(HONEY_ENTRANCE);
  const attach = (from: number, via: { link: number; to: number }): boolean => {
    const r = rng.rand(3);
    const fromAttrs = members[placed.get(from)!]!.attrs;
    for (let p = 0; p < pool.length; p++) {
      const cand = members[pool[p]!]!.attrs;
      for (let t = 0; t < ATTRIBUTES; t++) {
        const k = (r + t) % ATTRIBUTES;
        if (fromAttrs[k] === cand[k]) {
          placed.set(via.to, pool[p]!);
          order.push(via.to);
          linkAttr.set(via.link, k);
          pool.splice(p, 1);
          return true;
        }
      }
    }
    return false;
  };
  const sweep = (pivots: readonly number[], dirs: (p: number) => readonly number[]): boolean => {
    let any = false;
    for (const p of pivots) {
      if (!placed.has(p)) continue;
      for (const d of dirs(p)) {
        if (pool.length === 0) return any;
        const via = adj.get(p)!.find((e) => e.dir === d);
        if (via === undefined || placed.has(via.to)) continue;
        if (attach(p, via)) any = true;
      }
    }
    return any;
  };
  const rowSix = new Set([55, 57, 59]);
  sweep(HONEY_PIVOTS, (p) => (rowSix.has(p) ? [4, 5, 3] : [5, 3]));
  while (pool.length > 0) {
    if (!sweep([...order], () => [4, 5, 3, 1, 0, 2])) break;
  }
  // Liaisons transversales entre emplacements posés.
  for (const l of HONEY_LINKS) {
    if (linkAttr.has(l)) continue;
    const ends = honeycombNeighbors()[l]!.filter((x) => x >= 0 && placed.has(x));
    if (ends.length !== 2) continue;
    const k = pickCommonAttr(rng, members[placed.get(ends[0]!)!]!.attrs, members[placed.get(ends[1]!)!]!.attrs);
    if (k !== null) linkAttr.set(l, k);
  }
  const designated = new Map(placed);
  // Membres sans partenaire : posés sans membre prévu dans les emplacements libres.
  const kept = new Set(placed.keys());
  for (const s of [...HONEY_FILL, ...HONEY_SLOTS]) {
    if (pool.length === 0) break;
    if (!kept.has(s)) {
      kept.add(s);
      pool.shift();
    }
  }
  // Cases présentes : tout le plateau, sans les culs-de-sac de pierres (liaisons ou emplacements inutilisés à un seul voisin).
  const nb = honeycombNeighbors();
  const present = new Set<number>([...HONEY_LINKS, ...HONEY_SLOTS]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const i of [...present]) {
      if (kept.has(i)) continue;
      const live = nb[i]!.filter((j) => j >= 0 && (present.has(j) || j === HONEY_START)).length;
      if (live <= 1) {
        present.delete(i);
        changed = true;
      }
    }
  }
  return honeycombBoard(members, startVariant, kept, present, linkAttr, designated);
}

/**
 * Niveau 3, 1 à 5 membres (`1150:0000` cas 3, `n < 6`) : une chaîne droite sur la rangée 6 (55 – 56 – 57 – 58 – 59 – 60 – 61, puis 52 – 44 pour 5). Pour 2 membres,
 * `1150:2222` pose le second ; pour 3 à 5, les symboles viennent de `1150:1b3e` appelée sur le rang **du rang** (`rank[rank[i]]`), ce qui désigne des
 * membres distincts qui partagent bien l'attribut (premier attribut commun dans l'ordre 0 à 3) ou, sinon, laisse la liaison libre.
 */
function buildShortChain(members: Members, rng: MsvcRandom, startVariant: 0 | 1): SlidesBoard {
  const n = members.length;
  const rank = rankMembers(members);
  const chainSlots = [55, 57, 59, 61, 44].slice(0, n);
  const chainLinks = [56, 58, 60, 52];
  const designated = new Map<number, number>();
  const linkAttr = new Map<number, number>();
  if (n === 1) {
    designated.set(55, 0);
  } else if (n === 2) {
    designated.set(55, 0);
    designated.set(57, 1);
    const r = rng.rand(3);
    for (let t = 0; t < ATTRIBUTES; t++) {
      const k = (r + t) % ATTRIBUTES;
      if (members[0]!.attrs[k] === members[1]!.attrs[k]) {
        linkAttr.set(56, k);
        break;
      }
    }
  } else {
    const who = chainSlots.map((_, j) => rank[rank[j]!]!);
    who.forEach((m, j) => designated.set(chainSlots[j]!, m));
    for (let j = 0; j + 1 < n; j++) {
      const k = firstCommonAttr(members[who[j]!]!.attrs, members[who[j + 1]!]!.attrs);
      if (k !== null) linkAttr.set(chainLinks[j]!, k);
    }
  }
  const kept = new Set(chainSlots);
  const present = new Set<number>([...chainSlots, ...chainLinks.slice(0, Math.max(0, n - 1))]);
  return honeycombBoard(members, startVariant, kept, present, linkAttr, designated);
}

function buildHoneycomb(members: Members, rng: MsvcRandom): SlidesBoard {
  const startVariant = rng.rand(1) as 0 | 1;
  return members.length < 6 ? buildShortChain(members, rng, startVariant) : growHoneycomb(members, rng, startVariant);
}

/**
 * Génère le plateau de `level` (0 à 3) pour un groupe de 1 à 16 membres (`1150:0000`). Le tirage de départ du niveau 3 (variante de la pierre de
 * départ) précède tout autre ; le plateau a toujours autant d'emplacements que de membres et se résout (voir `solve`).
 */
export function generateBoard(level: number, members: Members, rng: MsvcRandom): SlidesBoard {
  if (members.length < 1) throw new RangeError("slides: groupe vide");
  switch (level) {
    case 0:
      return buildPairs(members, rng);
    case 1:
      return buildChains(members, chainPlan(members, rng));
    case 2:
      return buildLadder(members, rng);
    case 3:
      return buildHoneycomb(members, rng);
    default:
      throw new RangeError(`slides: niveau ${level}`);
  }
}

// --- Partie : pose, montée, résultat ---

export type SlotState = "free" | "occupied" | "connected";

export interface SlidesPlay {
  readonly board: SlidesBoard;
  readonly members: Members;
  /** Membre posé sur chaque emplacement (−1 : libre). */
  readonly seat: number[];
}

export function createPlay(board: SlidesBoard, members: Members): SlidesPlay {
  return { board, members, seat: new Array<number>(board.slots.length).fill(-1) };
}

/** Rang de l'emplacement occupé par `member`, −1 s'il est en attente. */
export function seatOf(play: SlidesPlay, member: number): number {
  return play.seat.indexOf(member);
}

/**
 * Dépôt d'un membre sur l'emplacement de rang `slot` (`1170:08f5`) : l'emplacement qu'il occupait est libéré, l'occupant éventuel de `slot` est renvoyé
 * à une position d'attente. Renvoie cet occupant déplacé (−1 si aucun). L'écran ne l'appelle jamais sur un emplacement pris (`1168:1742` ne retient pas
 * une cible occupée, voir `slides.md` §9) : le renvoi n'est qu'une garde de cohérence.
 */
export function place(play: SlidesPlay, member: number, slot: number): number {
  const from = play.seat.indexOf(member);
  if (from === slot) return -1;
  if (from >= 0) play.seat[from] = -1;
  const displaced = play.seat[slot]!;
  play.seat[slot] = member;
  return displaced;
}

/** Retrait d'un membre lâché hors emplacement : il rejoint l'attente. */
export function remove(play: SlidesPlay, member: number): void {
  const from = play.seat.indexOf(member);
  if (from >= 0) play.seat[from] = -1;
}

export interface Evaluation {
  /** Pour chaque case, membre qui l'occupe (emplacements seulement), −1 sinon. */
  occupant: readonly number[];
  /** Case reliée : départ, emplacement relié (`0x1fc`). */
  live: readonly boolean[];
  /** Liaison montée (`0x1f6`). */
  raised: readonly boolean[];
  slotState: readonly SlotState[];
  /** Membres reliés, dans l'ordre des emplacements. */
  connected: readonly number[];
  /** Bouton « go » actif : au moins un emplacement relié (`1170:2dba`). */
  goEnabled: boolean;
  /** Tout le groupe est relié (`1150:2f9e` : emplacements reliés ≥ taille du groupe) : célébration. */
  victory: boolean;
  /** Pierres montées + emplacements reliés, et somme de leurs indices (`1170:4f50`) : entrée du son de bilan. */
  raisedCount: number;
  raisedSum: number;
  /** Niveau 3 : 57, 59 et 61 reliés et exactement 4 emplacements occupés (`1170:3aa3`) : déclenche le cycle de palette, que la scène garde ensuite jusqu'à la sortie. */
  paletteCycle: boolean;
}

/**
 * Montée recalculée de zéro (`1170:3dc0` aux niveaux 2 et 3 ; les niveaux 0 et 1 en sont l'équivalent, `1170:26b4` ne parcourant que la rangée
 * du dépôt). Point fixe :
 *  - un emplacement occupé touchant un départ ou une liaison montée est relié ;
 *  - une liaison libre monte dès qu'un voisin est relié (départ, emplacement relié ou liaison montée : les pierres libres se traversent) ;
 *  - une liaison à symbole monte si ses deux voisins sont des emplacements occupés dont l'un est relié et qui ont la même valeur de l'attribut.
 * Écart (**probable**) : l'original propage dans un ordre précis (`3eb1`, `48c4`, `40b5`) ; le point fixe en est l'état d'arrivée sur les plateaux générés.
 */
export function evaluate(play: SlidesPlay): Evaluation {
  const { board, members, seat } = play;
  const st = board.stones;
  const occupant = new Array<number>(STONE_COUNT).fill(-1);
  board.slots.forEach((c, k) => {
    occupant[c] = seat[k]!;
  });
  const live = new Array<boolean>(STONE_COUNT).fill(false);
  const raised = new Array<boolean>(STONE_COUNT).fill(false);
  for (const s of board.starts) live[s] = true;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < STONE_COUNT; i++) {
      const s = st[i]!;
      if (s.kind === "slot") {
        if (live[i] || occupant[i]! < 0) continue;
        if (s.neighbors.some((j) => j >= 0 && (st[j]!.kind === "start" || raised[j]))) {
          live[i] = true;
          changed = true;
        }
      } else if (s.kind === "link" && !raised[i]) {
        const around = s.neighbors.filter((j) => j >= 0);
        if (s.attr === null) {
          // Une liaison libre monte depuis un emplacement relié ou une liaison montée, pas depuis un départ (`1170:40b5` n'est appelée que depuis un emplacement occupé).
          if (around.some((j) => (live[j] && st[j]!.kind === "slot") || raised[j])) {
            raised[i] = true;
            changed = true;
          }
        } else {
          const ends = around.filter((j) => st[j]!.kind === "slot");
          if (ends.length !== 2) continue;
          const [a, b] = ends as [number, number];
          if (occupant[a]! < 0 || occupant[b]! < 0 || !(live[a] || live[b])) continue;
          if (members[occupant[a]!]!.attrs[s.attr] === members[occupant[b]!]!.attrs[s.attr]) {
            raised[i] = true;
            changed = true;
          }
        }
      }
    }
  }
  const slotState = board.slots.map<SlotState>((c, k) => (seat[k]! < 0 ? "free" : live[c] ? "connected" : "occupied"));
  const connected = board.slots.flatMap((c, k) => (seat[k]! >= 0 && live[c] ? [seat[k]!] : []));
  let raisedCount = 0;
  let raisedSum = 0;
  for (let i = 0; i < STONE_COUNT; i++) {
    if (raised[i] || (st[i]!.kind === "slot" && live[i])) {
      raisedCount++;
      raisedSum += i;
    }
  }
  const occupied = seat.filter((m) => m >= 0).length;
  return {
    occupant,
    live,
    raised,
    slotState,
    connected,
    goEnabled: connected.length > 0,
    victory: connected.length >= members.length,
    raisedCount,
    raisedSum,
    paletteCycle: board.level === 3 && live[57] === true && live[59] === true && live[61] === true && occupied === 4,
  };
}

/** Code d'état de l'original de la case `i` (pour les filtres de rendu). */
export function stateCode(board: SlidesBoard, ev: Evaluation, i: number): number {
  const s = board.stones[i]!;
  switch (s.kind) {
    case "void":
      return STATE.void;
    case "start":
      return board.startVariant === 1 ? STATE.startAlt : STATE.start;
    case "link":
      return ev.raised[i] ? STATE.linkRaised : STATE.linkLow;
    case "slot":
      return ev.occupant[i]! < 0 ? STATE.slotFree : ev.live[i] ? STATE.slotConnected : STATE.slotOccupied;
  }
}

/** Sons de bilan après un dépôt (`1170:4f98`, `\0SND` de `SLIDES.MHK`). */
export const FEEDBACK_SOUND = { downSmall: 8500, downBig: 8501, shuffle: 8502, upSmall: 8504, upBig: 8505 } as const;

/**
 * `1170:4f98` : son selon l'évolution du nombre de pierres montées : + 1 à 4 → 8504, + 5 et plus → 8505, − 1 à 4 → 8500, − 5 et plus → 8501 ; même nombre mais
 * autre somme d'indices (le Zoombini a changé de place sans effet) → 8502 ; sinon aucun.
 */
export function feedbackSound(before: Pick<Evaluation, "raisedCount" | "raisedSum">, after: Pick<Evaluation, "raisedCount" | "raisedSum">): number | null {
  const d = after.raisedCount - before.raisedCount;
  if (d > 0) return d < 5 ? FEEDBACK_SOUND.upSmall : FEEDBACK_SOUND.upBig;
  if (d < 0) return -d < 5 ? FEEDBACK_SOUND.downSmall : FEEDBACK_SOUND.downBig;
  return before.raisedSum !== after.raisedSum ? FEEDBACK_SOUND.shuffle : null;
}

export interface SlidesResult {
  /** Membres sauvés : ceux dont l'emplacement est relié au moment de « go » (`1170:2d65`). */
  saved: number[];
  lost: number[];
  /** Tout le groupe est sauvé. */
  perfect: boolean;
}

/** Résultat d'un « go » (définitif) ; `null` si le bouton est grisé (aucun emplacement relié). */
export function go(play: SlidesPlay): SlidesResult | null {
  const ev = evaluate(play);
  if (!ev.goEnabled) return null;
  const saved = [...ev.connected];
  const lost = play.members.flatMap((_, i) => (saved.includes(i) ? [] : [i]));
  return { saved, lost, perfect: lost.length === 0 };
}

// --- Robot ---

export interface Placement {
  member: number;
  /** Rang de l'emplacement. */
  slot: number;
}

const SEARCH_BUDGET = 30000;

/**
 * Cherche une pose qui relie **tout** le groupe : recherche en profondeur qui ajoute un membre à la fois sur un emplacement vide atteignable (liaison libre
 * montée, ou liaison à symbole dont le voisin relié a la même valeur), l'emplacement le plus contraint d'abord, sans reprendre deux fois la même pose.
 * Ordre rendu = ordre de pose (chaque pose relie le membre à ce moment-là). Repli : la solution prévue par le générateur. `null` si rien n'est trouvé (jamais
 * sur un plateau généré, vérifié par les tests).
 */
export function solve(board: SlidesBoard, members: Members): Placement[] | null {
  const n = members.length;
  const play = createPlay(board, members);
  const order: Placement[] = [];
  const seen = new Set<string>();
  let budget = SEARCH_BUDGET;
  const key = (): string => play.seat.join(",");

  const candidates = (ev: Evaluation): { slot: number; members: number[] }[] | null => {
    const out: { slot: number; members: number[] }[] = [];
    let dead = false;
    const used = new Set(play.seat);
    board.slots.forEach((c, k) => {
      if (play.seat[k]! >= 0) return;
      const nbs = board.stones[c]!.neighbors.filter((j) => j >= 0);
      let any = nbs.some((j) => board.stones[j]!.kind === "start" || ev.raised[j]!);
      const needs: { attr: number; other: number }[] = [];
      if (!any) {
        for (const j of nbs) {
          const s = board.stones[j]!;
          if (s.kind !== "link" || s.attr === null) continue;
          const other = s.neighbors.find((x) => x >= 0 && x !== c && board.stones[x]!.kind === "slot");
          if (other !== undefined && ev.live[other]! && ev.occupant[other]! >= 0) needs.push({ attr: s.attr, other: ev.occupant[other]! });
        }
        any = needs.length > 0;
      }
      if (!any) return;
      const list: number[] = [];
      const seenAttrs = new Set<string>();
      for (let m = 0; m < n; m++) {
        if (used.has(m)) continue;
        const sig = members[m]!.attrs.join(",");
        if (seenAttrs.has(sig)) continue;
        // Le départ ou une liaison libre montée suffit (`any` sans `needs`) ; sinon il faut une liaison à symbole satisfaite.
        const free = nbs.some((j) => board.stones[j]!.kind === "start" || ev.raised[j]!);
        if (free || needs.some((q) => members[m]!.attrs[q.attr] === members[q.other]!.attrs[q.attr])) {
          list.push(m);
          seenAttrs.add(sig);
        }
      }
      if (list.length > 0) {
        out.push({ slot: k, members: list });
      } else if (nbs.every((j) => board.stones[j]!.kind !== "link" || board.stones[j]!.neighbors.every((x) => x < 0 || x === c || (board.stones[x]!.kind === "slot" && ev.occupant[x]! >= 0)))) {
        // Atteignable, mais aucun membre ne convient et plus aucune liaison ne peut changer : impasse.
        dead = true;
      }
    });
    if (dead) return null;
    return out.sort((a, b) => a.members.length - b.members.length || a.slot - b.slot);
  };

  const dfs = (): boolean => {
    if (play.seat.filter((m) => m >= 0).length === Math.min(n, board.slots.length)) return evaluate(play).connected.length === n;
    if (budget-- <= 0) return false;
    const k = key();
    if (seen.has(k)) return false;
    seen.add(k);
    // Membres les moins « partenaires » d'abord (ceux qui n'ont presque personne avec qui se relier sont les plus contraints).
    const free = members.map((_, i) => i).filter((i) => !play.seat.includes(i));
    const degree = (m: number): number => free.filter((o) => o !== m && members[o]!.attrs.some((v, a) => v === members[m]!.attrs[a])).length;
    for (const cand of candidates(evaluate(play)) ?? []) {
      const ordered = cand.members.map((m) => [degree(m), m] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (const [, m] of ordered) {
        play.seat[cand.slot] = m;
        order.push({ member: m, slot: cand.slot });
        if (dfs()) return true;
        order.pop();
        play.seat[cand.slot] = -1;
      }
    }
    return false;
  };
  if (dfs()) return order;

  // Repli : la solution du générateur, complétée par les membres restants dans les emplacements restants.
  const fallback = createPlay(board, members);
  const left = new Set(members.map((_, i) => i));
  board.solution.forEach((m, k) => {
    if (m >= 0) {
      fallback.seat[k] = m;
      left.delete(m);
    }
  });
  for (let k = 0; k < fallback.seat.length; k++) {
    if (fallback.seat[k]! < 0) {
      const m = left.values().next().value;
      if (m === undefined) break;
      fallback.seat[k] = m;
      left.delete(m);
    }
  }
  if (evaluate(fallback).connected.length !== n) return null;
  // Ordre de pose : à chaque tour, une pose de la solution qui relie son membre tout de suite (il en existe toujours une, la solution étant un arbre).
  const target = fallback.seat.flatMap((m, slot) => (m >= 0 ? [{ member: m, slot }] : []));
  const done = createPlay(board, members);
  const plan: Placement[] = [];
  const todo = [...target];
  while (todo.length > 0) {
    const i = todo.findIndex((p) => {
      done.seat[p.slot] = p.member;
      const ok = evaluate(done).connected.includes(p.member);
      if (!ok) done.seat[p.slot] = -1;
      return ok;
    });
    if (i < 0) break;
    plan.push(todo.splice(i, 1)[0]!);
  }
  return todo.length === 0 ? plan : null;
}

/** Robot de partie : applique `solve` à la partie en cours (les membres déjà posés sont repris) ; renvoie les poses faites, `null` si le groupe ne peut pas être relié. */
export function robot(play: SlidesPlay): Placement[] | null {
  const plan = solve(play.board, play.members);
  if (plan === null) return null;
  for (let k = 0; k < play.seat.length; k++) play.seat[k] = -1;
  for (const p of plan) play.seat[p.slot] = p.member;
  return plan;
}
