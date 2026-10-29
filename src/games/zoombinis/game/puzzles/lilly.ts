import type { MsvcRandom } from "../../../../engine/mohawk/rng";

/**
 * Règles des têtards tatoués (`LILLY.MHK`, écran 11 ; `docs/zoombinis/puzzles/lilly.md`) : l'étang de 12 × 12 nénuphars, les 12 crapauds,
 * leur pas à pas, la réussite, la fée (échange de deux nénuphars), les grenouilles et l'état de fin. Fonctions pures sur `LillyState` : aucun
 * rendu, aucun service, aucun texte. Le hasard vient d'un `MsvcRandom` injecté, tiré **dans l'ordre de l'original** (`10f8:5f02` puis `10f8:484e`,
 * voir `createLilly`).
 *
 * Adresses : `10f8:*` et `10f0:*` sont les deux segments de code de l'écran ; `DS:` est le segment de données du jeu (`1530`), `DS2:` le second
 * (`1440`). Ghidra inverse l'ordre des arguments pascal (`docs/zoombinis/engine.md` §0) : `10a8:04e8(min, max)` = `rng.range(min, max)`.
 *
 * Conventions de ce module :
 *  - colonne `col` 0 à 11 (gauche, départ -> droite, arrivée), rangée `row` 0 à 11 (haut -> bas) ; une case = indice `row × 12 + col` ;
 *  - caractéristique `kind` 1 = A (3 valeurs), 2 = B (4 valeurs, la forme du nénuphar), 3 = C (5 valeurs) ; un tatouage est un couple
 *    `(kind, value)`, numéroté 0 à 11 (`TATTOOS`) ;
 *  - cap 0 haut, 1 droite, 2 bas, 3 gauche ;
 *  - niveau 0 à 3 (comme `currentLevel` de `route.ts`) = `DS:1396 − 1` ; le texte de l'étude parle des niveaux 1 à 4.
 *
 * Écarts avec l'original (sans effet sur les règles) :
 *  - le temps (cadence de 30 ticks des pas, 35 des grenouilles, 600 puis 480 du lancement des grenouilles) est laissé à la scène : le module
 *    ne connaît que des pas logiques (`stepToad`, `stepFrog`, `spawnFrog`) ; les constantes sont exportées ;
 *  - l'original libère la case quittée à l'événement 12 du saut (milieu de l'animation) : ici elle l'est au pas suivant (`settleToad`) ;
 *  - le verrou d'ouverture `DS:9702` (animation d'introduction, jetons d'entrée) n'est pas modélisé : c'est de la mise en scène (étude §3 point 3).
 */

// --- Constantes et tables ---

export const POND_SIZE = 12;
export const TOAD_COUNT = 12;
/** Niveaux (0 à 3). */
export type LillyLevel = 0 | 1 | 2 | 3;
/** Caractéristique d'un nénuphar : 1 = A, 2 = B, 3 = C. */
export type Kind = 1 | 2 | 3;
export type Heading = 0 | 1 | 2 | 3;

/** Nombre de valeurs de A, B et C. */
export const KIND_SIZES: readonly number[] = [3, 4, 5];

export interface Tattoo {
  kind: Kind;
  value: number;
}

/** Les 12 tatouages (`DS:14b6` : kind, `DS:14ce` : valeur) : 0 à 2 = A, 3 à 6 = B, 7 à 11 = C. L'image du tatouage `t` est `272 + t` de `tBMP` 10000. */
export const TATTOOS: readonly Tattoo[] = [
  { kind: 1, value: 0 },
  { kind: 1, value: 1 },
  { kind: 1, value: 2 },
  { kind: 2, value: 0 },
  { kind: 2, value: 1 },
  { kind: 2, value: 2 },
  { kind: 2, value: 3 },
  { kind: 3, value: 0 },
  { kind: 3, value: 1 },
  { kind: 3, value: 2 },
  { kind: 3, value: 3 },
  { kind: 3, value: 4 },
];

/** Identifiant de chemin (1 à 12) -> premier identifiant de son kind (1, 4, 8) et nombre d'identifiants (3, 4, 5). */
const ID_RANGE: readonly (readonly [number, number])[] = [
  [1, 3],
  [4, 4],
  [8, 5],
];

/** `DS2:25bc[N]` : nombre de tatouages au moins qui passent au niveau 1 (`⌊(N + 1) / 2⌋`, 1 pour N = 0). */
const GUARANTEED_PATHS: readonly number[] = [1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10];

export function guaranteedPaths(group: number): number {
  return GUARANTEED_PATHS[Math.max(0, Math.min(group, GUARANTEED_PATHS.length - 1))]!;
}

/** `DS2:25a8` : image du motif = `MOTIF_BASE[C] + A` (images 5 à 19 de `tBMP` 13000). */
export const MOTIF_BASE: readonly number[] = [5, 8, 11, 14, 17];
/** `DS:145a` : la rangée penche vers le bas de 2 pixels toutes les deux colonnes. */
export const ROW_SLOPE_Y: readonly number[] = [2, 2, 4, 4, 6, 6, 8, 8, 10, 10, 12, 12];

/** Échanges fixes au niveau 1 et plus (`DS2:2484` à `2494`, appelés par `10f8:5f02` avant la fin de la génération) : (colonne, rangée) <-> (colonne, rangée). */
const FIXED_EXCHANGES: readonly (readonly [Cell, Cell])[] = [
  [
    { col: 4, row: 4 },
    { col: 3, row: 6 },
  ],
  [
    { col: 8, row: 3 },
    { col: 10, row: 5 },
  ],
];

/** Cadence (ticks de 17 ms) : pas d'un crapaud après le début du saut (`10f8:20bc` événement 10), d'une grenouille (`10f8:267b`), première grenouille après l'entrée, suivantes. */
export const TOAD_STEP_TICKS = 30;
export const FROG_STEP_TICKS = 35;
export const FROG_FIRST_TICKS = 600;
export const FROG_PERIOD_TICKS = 480;
/** Grenouilles vivantes en même temps (`DS:8074 < 0x14`). */
export const FROG_MAX_ALIVE = 20;
/** Remise à zéro de la matrice de passages d'un crapaud (`10f8:41ec`). */
const COUNTER_LIMIT = 10000;
/** Longueur de la jauge de la baguette (`DS:7bd0`, 0 à 6). */
export const FAIRY_GAUGE = 6;

// --- Types ---

export interface Cell {
  col: number;
  row: number;
}

/** Un nénuphar (13 octets à `DS2:062c + 0xA9 × row + 13 × col`) : occupation (+8), A, B, C (+9 à +11), image du motif (+12). */
export interface Lily {
  occupied: boolean;
  attrs: [number, number, number];
  motif: number;
}

export interface Pond {
  /** 144 nénuphars, indice `row × 12 + col`. */
  cells: Lily[];
  /** Case d'abordage de la berge droite de chaque rangée (la 13e colonne de l'original, `+8` de `col = 12`). */
  landing: boolean[];
}

/** Gabarit `REGS` 15000 à 15002 : grille 12 × 12 de mots (rangée par rangée), 0 = case libre, sinon l'identifiant du chemin (1 à 3 = A, 4 à 7 = B, 8 à 12 = C). */
export type LillyTemplates = readonly [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>];

/** Une case d'entrée de grenouille (`DS:7c74`, 8 octets) : colonne de la rangée 0 et tatouage du chemin qui y passe. */
export interface FrogEntry {
  col: number;
  kind: Kind;
  value: number;
  tattoo: number;
}

export interface PondInfo {
  /** Nombre total de coupures posées (`local_20` de `10f8:5f02`) ; il règle le budget d'échanges. */
  cuts: number;
  /** Gabarit tourné de 90° (niveaux 2 et 3) : 0 aucun, sinon le kind (1 à 3). Ses chemins vont de haut en bas. */
  rotated: 0 | Kind;
  entries: FrogEntry[];
  /** Pour chaque identifiant de chemin (indice 1 à 12 ; l'indice 0 est vide) : sa caractéristique, sa valeur et son tatouage. */
  ids: readonly { kind: Kind; value: number; tattoo: number }[];
}

export interface Toad {
  /** Rangée de repos sur la berge gauche, 0 à 11 (`SCRB 10043 + index`). */
  index: number;
  tattoo: number;
  kind: Kind;
  value: number;
  /** Paramètre d'animation tiré par `10f8:484e` (3 à 6 ticks par image) : ne sert qu'à garder l'ordre des tirages. */
  frameDelay: number;
  /** Sur l'étang (`+0xf2`) : de la pose à l'arrivée. */
  active: boolean;
  col: number;
  row: number;
  heading: Heading;
  /** Matrice 12 × 12 de passages (`+0xf2` de la donnée), indice `row × 12 + col`. */
  counters: Uint16Array;
  /** `+0xd6` : colonne la plus à droite atteinte par le pré-calcul ; 11 = un chemin existe jusqu'à la berge droite. */
  target: number;
  /** `+0xd7` : dernier numéro de passage du pré-calcul. */
  stamp: number;
  /** `+0xc7` / `+0xc8` : case la plus à gauche du pré-calcul. */
  minCol: number;
  minRow: number;
  /** Indice (dans l'ordre de lancement) du Zoombini porté, -1 hors étang. */
  token: number;
  /** Indice de la case quittée au dernier saut, libérée au pas suivant (`settleToad`). */
  leaving: number | null;
  /** Le crapaud a pris la case d'abordage et attend `arrive` (événement 30). */
  landed: boolean;
  /** Dans la liste `DS:7cf2` des crapauds : retiré à la fin de la première sortie (`10f8:3614`) ; seuls les crapauds listés sont recalculés par la fée et comptés par `settleRemaining`. */
  listed: boolean;
  /** Traversées réussies. */
  trips: number;
}

export interface Frog {
  /** Numéro de création (0, 1, 2…), pas l'identifiant d'objet de l'original. */
  id: number;
  /** Indice de la case d'entrée utilisée. */
  entry: number;
  /** 0 tant que la variante n'a pas adopté le tatouage d'un nénuphar libre. */
  kind: Kind | 0;
  value: number;
  col: number;
  row: number;
  /** Variante (`+0x62 = 1`, `10f0:14cb`) : descend tout droit jusqu'au premier nénuphar libre, puis devient une grenouille ordinaire. */
  variant: boolean;
  /** Variante qui a adopté un tatouage (`+0x64`) : devient ordinaire à son prochain pas. */
  adopted: boolean;
  alive: boolean;
  /** Case quittée au dernier saut (libérée à l'atterrissage, `settleFrog`) ; une variante ne libère rien (`10f8:267b` cas 6). */
  leaving: number | null;
}

export interface Fairy {
  /** Jauge de la baguette (`DS:7bd0`) : 0 à 6, 6 = épuisée. */
  gauge: number;
  /** Échanges par cran (`DS:7bd2` = ⌈(coupures + 5) / 6⌉). */
  perGauge: number;
  /** Échanges déjà faits dans le cran courant (`DS:7bd4`). */
  inGauge: number;
  /** Échanges faits au total. */
  total: number;
}

export interface LillyState {
  level: LillyLevel;
  /** Zoombinis du groupe (`DS:8076`). */
  group: number;
  pond: Pond;
  info: PondInfo;
  toads: Toad[];
  frogs: Frog[];
  /** Grenouilles créées au total, et indice du prochain point d'entrée (`DS:8072`). */
  frogsCreated: number;
  nextEntry: number;
  /** Cases d'entrée déjà occupées par une grenouille ordinaire (`DS:21e6[col] = 1`). */
  frogSeen: boolean[];
  /** Champ de distance de chaque valeur de la caractéristique des grenouilles (`10f0:00e5`), indice `(row + 1) × 12 + col` ; absent tant qu'un échange ne l'a pas calculé. */
  frogField: (Int16Array | null)[];
  fairy: Fairy;
  /** Jetons lancés (`DS:807a`). */
  launched: number;
  /** Arrivées (`DS:7bca`) : le bouton « suite » est actif dès la première. */
  arrivals: number;
  /** Zoombini sauvé, indexé par ordre de lancement. */
  saved: boolean[];
}

// --- Gabarits ---

function rotate90(t: number[]): number[] {
  // `10f8:69f5` mode 0 : nouveau[j][11 − i] = ancien[i][j].
  const out = new Array<number>(144).fill(0);
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) out[j * 12 + (11 - i)] = t[i * 12 + j]!;
  return out;
}

function rotate180(t: number[]): number[] {
  // mode 1 : nouveau[11 − i][11 − j] = ancien[i][j].
  const out = new Array<number>(144).fill(0);
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) out[(11 - i) * 12 + (11 - j)] = t[i * 12 + j]!;
  return out;
}

function mirror(t: number[], mode: 0 | 1): number[] {
  // `10f8:6b7d` : mode 0 inverse les colonnes, mode 1 les rangées.
  const out = new Array<number>(144).fill(0);
  for (let i = 0; i < 12; i++)
    for (let j = 0; j < 12; j++) {
      if (mode === 0) out[i * 12 + (11 - j)] = t[i * 12 + j]!;
      else out[(11 - i) * 12 + j] = t[i * 12 + j]!;
    }
  return out;
}

export function cellIndex(col: number, row: number): number {
  return row * POND_SIZE + col;
}

function inPond(col: number, row: number): boolean {
  return col >= 0 && col < POND_SIZE && row >= 0 && row < POND_SIZE;
}

/** Valeur de la caractéristique `kind` du nénuphar. */
export function attrOf(lily: Lily, kind: Kind): number {
  return lily.attrs[kind - 1]!;
}

function matches(lily: Lily, kind: Kind, value: number): boolean {
  return attrOf(lily, kind) === value;
}

function swapLilies(pond: Pond, a: Cell, b: Cell): void {
  const la = pond.cells[cellIndex(a.col, a.row)]!;
  const lb = pond.cells[cellIndex(b.col, b.row)]!;
  const attrs = la.attrs;
  const motif = la.motif;
  la.attrs = lb.attrs;
  la.motif = lb.motif;
  lb.attrs = attrs;
  lb.motif = motif;
}

// --- Génération de l'étang (`10f8:5f02`, `10f8:5c1e`) ---

/**
 * Génère l'étang. Ordre des tirages de l'original (**sûr**, relu sur `10f8:5f02`) :
 *  1. niveaux 2 et 3 : tirage du gabarit à tourner de 90° (`rand(3..5)` ou `rand(4..5)` si `⌊(N + 1) / 2⌋ < 8`, sinon le gabarit B sans tirage) ;
 *  2. `rand(0..2)` : 0 -> les trois gabarits tournent de 180°, 1 -> chacun est retourné (`rand(0..1)` par gabarit : 0 colonnes, 1 rangées), 2 -> rien ;
 *  3. les identifiants « coupables » : `K` tirages sans remise dans 1..12 (`K = 12 − ⌊(N + 1) / 2⌋` au niveau 0, 12 sinon) ;
 *  4. `10f8:5c1e` : les 12 identifiants reçoivent un tatouage par permutation aléatoire à l'intérieur de leur kind ;
 *  5. case par case (rangée par rangée), pour chacun des 3 gabarits : coupure possible (`rand(0..100) > 75`, ou rangée 11 sans coupure encore),
 *     puis tirage de chaque caractéristique que les gabarits n'ont pas fixée (A, B, C dans cet ordre) ;
 *  6. niveaux 1 à 3 : deux échanges fixes ; 7. le budget d'échanges de la fée.
 */
export function generatePond(rng: MsvcRandom, level: LillyLevel, group: number, templates: LillyTemplates): { pond: Pond; info: PondInfo } {
  const tpl = templates.map((t) => Array.from({ length: 144 }, (_, i) => t[i] ?? 0));
  const small = guaranteedPaths(group) < 8;
  let guilty = 12;
  let entryCount = 0;
  let rotated: 0 | Kind = 0;
  if (level === 0) guilty = 12 - guaranteedPaths(group);
  else if (level === 2) {
    entryCount = 2;
    rotated = small ? ((rng.range(3, 5) - 2) as Kind) : 2;
  } else if (level === 3) {
    entryCount = 3;
    rotated = small ? ((rng.range(4, 5) - 2) as Kind) : 2;
  }
  if (rotated !== 0) tpl[rotated - 1] = rotate90(tpl[rotated - 1]!);

  const symmetry = rng.range(0, 2);
  if (symmetry === 0) for (let i = 0; i < 3; i++) tpl[i] = rotate180(tpl[i]!);
  else if (symmetry === 1) for (let i = 0; i < 3; i++) tpl[i] = mirror(tpl[i]!, rng.range(0, 1) as 0 | 1);

  const isGuilty = new Array<boolean>(13).fill(false);
  const remaining = Array.from({ length: 12 }, (_, i) => i + 1);
  for (let i = 0; i < guilty; i++) {
    const pick = rng.range(1, remaining.length);
    isGuilty[remaining[pick - 1]!] = true;
    remaining.splice(pick - 1, 1);
  }

  // `10f8:5c1e` : un tatouage par identifiant, tiré sans remise dans le sac de son kind.
  const bags: number[][] = [
    [0, 1, 2],
    [3, 4, 5, 6],
    [7, 8, 9, 10, 11],
  ];
  const ids: { kind: Kind; value: number; tattoo: number }[] = [{ kind: 1, value: 0, tattoo: 0 }];
  for (let id = 1; id <= 12; id++) {
    const k = id <= 3 ? 0 : id <= 7 ? 1 : 2;
    const bag = bags[k]!;
    const tattoo = bag.splice(rng.range(0, bag.length - 1), 1)[0]!;
    ids.push({ kind: TATTOOS[tattoo]!.kind, value: TATTOOS[tattoo]!.value, tattoo });
  }

  const cuts = new Array<number>(13).fill(0);
  let totalCuts = 0;
  const entries: FrogEntry[] = [];
  const cells: Lily[] = [];
  for (let row = 0; row < POND_SIZE; row++) {
    for (let col = 0; col < POND_SIZE; col++) {
      const attrs: [number, number, number] = [0, 0, 0];
      const fixed = [false, false, false];
      for (let k = 0; k < 3; k++) {
        let id = tpl[k]![row * 12 + col]!;
        if (id !== 0) {
          const [first, count] = ID_RANGE[k]!;
          // Identifiant suivant dans le même kind, avec bouclage ; le gabarit tourné n'est jamais changé (mais la coupure est comptée).
          let next = rotated === k + 1 ? id : id + 1;
          if (next > first + count - 1) next = first;
          if (row >= 2 && col >= 2 && isGuilty[id] && cuts[id]! < 2 && (rng.range(0, 100) > 75 || (row === 11 && cuts[id] === 0))) {
            cuts[id]!++;
            totalCuts++;
            id = next;
          }
        }
        if (id > 0 && id < 13) {
          const info = ids[id]!;
          attrs[info.kind - 1] = info.value;
          fixed[info.kind - 1] = true;
          if (row === 0 && entries.length < entryCount && rotated !== 0 && ID_RANGE[rotated - 1]![0] <= id && id < ID_RANGE[rotated - 1]![0] + ID_RANGE[rotated - 1]![1])
            entries.push({ col, kind: info.kind, value: info.value, tattoo: info.tattoo });
        }
      }
      for (let k = 0; k < 3; k++) if (!fixed[k]) attrs[k] = rng.range(0, KIND_SIZES[k]! - 1);
      cells.push({ occupied: false, attrs, motif: MOTIF_BASE[attrs[2]]! + attrs[0] });
    }
  }
  const pond: Pond = { cells, landing: new Array<boolean>(POND_SIZE).fill(false) };
  if (level >= 1) for (const [a, b] of FIXED_EXCHANGES) swapLilies(pond, a, b);
  return { pond, info: { cuts: totalCuts, rotated, entries, ids } };
}

/** Origine d'un nénuphar à l'écran (`10f8:5f02`) : `x = REGS100[row + 1] + 35 col`, `y = REGS101[row + 1] + pente`. */
export function lilyOrigin(col: number, row: number, regs100: ArrayLike<number>, regs101: ArrayLike<number>): { x: number; y: number } {
  return { x: regs100[row + 1]! + 35 * col, y: regs101[row + 1]! + ROW_SLOPE_Y[col]! };
}

// --- Création de l'écran ---

/**
 * `10f8:0000` : état au démarrage de l'épreuve. L'étang est généré d'abord (`10f8:5f02`), puis les 12 crapauds (`10f8:484e`) : pour chaque rangée de repos
 * un tirage dans le sac des tatouages restants, puis le paramètre d'animation `rand(3..6)`. `group` est le nombre de Zoombinis (1 à 16).
 * (Ordre établi sur le code ; **probable** qu'aucun tirage intermédiaire ne vienne du moteur entre les deux appels.)
 */
export function createLilly(rng: MsvcRandom, level: LillyLevel, group: number, templates: LillyTemplates): LillyState {
  const { pond, info } = generatePond(rng, level, group, templates);
  const bag = Array.from({ length: TOAD_COUNT }, (_, i) => i);
  const toads: Toad[] = [];
  for (let index = 0; index < TOAD_COUNT; index++) {
    const tattoo = bag.splice(rng.rand(bag.length - 1), 1)[0]!;
    const frameDelay = rng.range(3, 6);
    const { kind, value } = TATTOOS[tattoo]!;
    toads.push({
      index,
      tattoo,
      kind,
      value,
      frameDelay,
      active: false,
      col: 0,
      row: 0,
      heading: 1,
      counters: new Uint16Array(144),
      target: 11,
      stamp: 0,
      minCol: 0,
      minRow: 0,
      token: -1,
      leaving: null,
      landed: false,
      listed: true,
      trips: 0,
    });
  }
  return {
    level,
    group,
    pond,
    info,
    toads,
    frogs: [],
    frogsCreated: 0,
    nextEntry: 0,
    frogSeen: new Array<boolean>(POND_SIZE).fill(false),
    frogField: new Array<Int16Array | null>(5).fill(null),
    fairy: { gauge: 0, perGauge: Math.ceil((info.cuts + 5) / 6), inGauge: 0, total: 0 },
    launched: 0,
    arrivals: 0,
    saved: new Array<boolean>(group).fill(false),
  };
}

/** La fée existe aux niveaux 1 à 3 (`DS:82e4`). */
export function hasFairy(state: LillyState): boolean {
  return state.level >= 1;
}

/** Échanges encore permis (6 crans de `perGauge` échanges). */
export function exchangesLeft(state: LillyState): number {
  if (!hasFairy(state)) return 0;
  const f = state.fairy;
  return f.gauge >= FAIRY_GAUGE ? 0 : (FAIRY_GAUGE - f.gauge) * f.perGauge - f.inGauge;
}

// --- Chemins ---

function neighbors(col: number, row: number): Cell[] {
  const out: Cell[] = [];
  if (row > 0) out.push({ col, row: row - 1 });
  if (col < 11) out.push({ col: col + 1, row });
  if (row < 11) out.push({ col, row: row + 1 });
  if (col > 0) out.push({ col: col - 1, row });
  return out;
}

/**
 * Un chemin de nénuphars du tatouage `(kind, value)` existe-t-il de la colonne 0 à la colonne 11 ? (4 voisins ; `respectOccupied` ne retient que les
 * nénuphars libres.) C'est la condition de réussite (étude §2.4 : l'explorateur de l'original parcourt toute la composante).
 */
export function pathExists(pond: Pond, kind: Kind, value: number, respectOccupied = false): boolean {
  return shortestPath(pond, kind, value, respectOccupied) !== null;
}

/** Plus court chemin (liste de cases de la colonne 0 à la colonne 11) du tatouage, ou null. */
export function shortestPath(pond: Pond, kind: Kind, value: number, respectOccupied = false): Cell[] | null {
  const ok = (c: Cell) => {
    const lily = pond.cells[cellIndex(c.col, c.row)]!;
    return matches(lily, kind, value) && !(respectOccupied && lily.occupied);
  };
  const prev = new Map<number, number>();
  const queue: Cell[] = [];
  for (let row = 0; row < POND_SIZE; row++) {
    const c = { col: 0, row };
    if (ok(c)) {
      prev.set(cellIndex(0, row), -1);
      queue.push(c);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    if (cur.col === 11) {
      const path: Cell[] = [];
      for (let i = cellIndex(cur.col, cur.row); i !== -1; i = prev.get(i)!) path.push({ col: i % POND_SIZE, row: Math.trunc(i / POND_SIZE) });
      return path.reverse();
    }
    for (const n of neighbors(cur.col, cur.row)) {
      const i = cellIndex(n.col, n.row);
      if (!prev.has(i) && ok(n)) {
        prev.set(i, cellIndex(cur.col, cur.row));
        queue.push(n);
      }
    }
  }
  return null;
}

/** Tatouages (0 à 11) qui ont un chemin sur l'étang tel qu'il est. */
export function passingTattoos(pond: Pond): number[] {
  const out: number[] = [];
  for (let t = 0; t < TATTOOS.length; t++) if (pathExists(pond, TATTOOS[t]!.kind, TATTOOS[t]!.value)) out.push(t);
  return out;
}

// --- Pré-calcul du chemin d'un crapaud (`10f0:0000`, `051a`, `086f`) ---

/** `10f0:051a` (crapaud : orientation 0, progression en colonne) : marche d'au plus 200 pas, même règle de voisinage que `41ec` sans l'occupation. */
function precomputeWalk(toad: Toad, pond: Pond, limit: number): number {
  const m = toad.counters;
  let progress = toad.col;
  let x = toad.col;
  let y = toad.row;
  if (toad.target !== 11) {
    x = toad.minCol;
    y = toad.minRow;
  }
  let cx = x;
  let cy = y;
  let h: number = toad.heading;
  m[y * 12 + x] = toad.stamp;
  let threshold = toad.stamp;
  let last = h;
  for (let steps = 0; steps < 200 && progress < limit; steps++) {
    const stamp0 = threshold;
    const px = cx;
    const py = cy;
    for (let k = 0; k < 4 && progress < limit; k++) {
      let nx = px;
      let ny = py;
      let ok = true;
      switch (h) {
        case 0:
          ny = py - 1;
          ok = ny >= 0;
          break;
        case 1:
          nx = px + 1;
          if (nx > 11) {
            ok = false;
            progress = px;
          }
          break;
        case 2:
          ny = py + 1;
          ok = ny <= 11;
          break;
        default:
          nx = px - 1;
          ok = nx >= 0;
      }
      if (ok && matches(pond.cells[cellIndex(nx, ny)]!, toad.kind, toad.value) && m[ny * 12 + nx]! < threshold) {
        threshold = m[ny * 12 + nx]!;
        cx = nx;
        cy = ny;
        last = h;
        if (progress < nx) progress = nx;
        if (nx < toad.minCol) {
          toad.minCol = nx;
          toad.minRow = ny;
        }
      }
      h = (h + 1) % 4;
    }
    m[cy * 12 + cx] = stamp0 + 1;
    threshold = stamp0 + 1;
    h = last;
  }
  toad.stamp = m[cy * 12 + cx]!;
  toad.target = progress;
  return progress;
}

/** `10f0:086f` : efface la piste en remontant les numéros croissants depuis le départ, pour que le crapaud préfère les cases de la piste. */
function eraseTrail(toad: Toad, limit: number): void {
  const m = toad.counters;
  m[toad.minRow * 12 + toad.minCol] = 0;
  let cx = toad.minCol;
  let cy = toad.minRow;
  let progress = toad.col;
  let best = 0;
  for (let steps = 0; progress < limit && steps < 200; steps++) {
    const px = cx;
    const py = cy;
    for (let dir = 0; dir < 4; dir++) {
      let nx = px;
      let ny = py;
      let v = 0;
      if (dir === 0) {
        if (py - 1 >= 0) {
          ny = py - 1;
          v = m[ny * 12 + px]!;
        }
      } else if (dir === 1) {
        if (px + 1 < 12) {
          nx = px + 1;
          v = m[py * 12 + nx]!;
        }
      } else if (dir === 2) {
        if (py + 1 < 12) {
          ny = py + 1;
          v = m[ny * 12 + px]!;
        }
      } else if (px - 1 >= 0) {
        nx = px - 1;
        v = m[py * 12 + nx]!;
      }
      if (best < v) {
        cx = nx;
        cy = ny;
        best = v;
        if (progress < nx) progress = nx;
      }
    }
    m[cy * 12 + cx] = 0;
  }
}

/** `10f0:0000` : remet la matrice à zéro et pré-calcule le chemin depuis la case courante (deux marches puis le nettoyage). */
export function precomputeToad(toad: Toad, pond: Pond): void {
  toad.counters.fill(0);
  toad.minCol = toad.col;
  toad.minRow = toad.row;
  toad.target = 11;
  toad.stamp = 1;
  precomputeWalk(toad, pond, toad.target);
  precomputeWalk(toad, pond, toad.target);
  eraseTrail(toad, toad.target);
  toad.counters[toad.row * 12 + toad.col] = toad.stamp;
}

// --- Dépôt d'un crapaud ---

/** Le nénuphar de la première colonne de la rangée `row` est libre et porte la caractéristique du tatouage (`10f8:6cdf`). */
export function canDrop(state: LillyState, toadIndex: number, row: number): boolean {
  const toad = state.toads[toadIndex];
  if (!toad || toad.active || state.launched >= state.group || row < 0 || row >= POND_SIZE) return false;
  const lily = state.pond.cells[cellIndex(0, row)]!;
  return !lily.occupied && matches(lily, toad.kind, toad.value);
}

/** Rangées où le crapaud peut être déposé. */
export function dropRows(state: LillyState, toadIndex: number): number[] {
  const out: number[] = [];
  for (let row = 0; row < POND_SIZE; row++) if (canDrop(state, toadIndex, row)) out.push(row);
  return out;
}

/**
 * `10f8:1b3a` (région 3) : dépôt valide. Le nénuphar devient occupé, le crapaud part de la colonne 0 vers la droite, le Zoombini suivant monte dessus,
 * le chemin est pré-calculé. Au dernier jeton, si la fée est épuisée, les crapauds qui ont un chemin sont comptés (`settleRemaining`).
 */
export function drop(state: LillyState, toadIndex: number, row: number): boolean {
  if (!canDrop(state, toadIndex, row)) return false;
  const toad = state.toads[toadIndex]!;
  state.pond.cells[cellIndex(0, row)]!.occupied = true;
  toad.active = true;
  toad.landed = false;
  toad.leaving = null;
  toad.col = 0;
  toad.row = row;
  toad.heading = 1;
  toad.token = state.launched;
  precomputeToad(toad, state.pond);
  state.launched++;
  if (state.launched === state.group && state.fairy.gauge === FAIRY_GAUGE) settleRemaining(state);
  return true;
}

// --- Pas d'un crapaud (`10f8:41ec`) ---

export type ToadStep =
  | { kind: "jump"; heading: Heading; from: Cell; to: Cell }
  | { kind: "exit"; row: number }
  | { kind: "wait"; reason: "landing" | "blocked" };

/** Libère la case quittée au saut précédent (événement 12 du saut). */
export function settleToad(state: LillyState, toad: Toad): void {
  if (toad.leaving !== null) {
    state.pond.cells[toad.leaving]!.occupied = false;
    toad.leaving = null;
  }
}

/**
 * Un pas du crapaud (`10f8:41ec`, **sûr**). Règle : le compteur `n` de la case courante est remis à 0 (matrice entière) s'il atteint 10 000, vaut au moins 1 ;
 * on examine les 4 voisins dans l'ordre du cap, du cap + 1, + 2, + 3 ; un voisin est candidat s'il est dans l'étang, libre, de la bonne caractéristique, et si
 * son compteur est strictement inférieur à `n` (puis au meilleur déjà trouvé : à égalité le premier gagne). Le candidat retenu reçoit le compteur `n + 1`,
 * devient occupé, et le cap devient la direction du saut. Un compteur qui est l'heure de dernier passage fait de cette règle un parcours « le moins récemment
 * visité d'abord » : il couvre toute la composante connexe (donc le crapaud finit par sortir quand un chemin existe). **Sortie** : quand le sens « droite » est
 * examiné depuis la colonne 11 (au plus tard au 4e sens), le crapaud abandonne les candidats trouvés et prend la case d'abordage de sa rangée si elle est
 * libre, sinon il attend. Aucun voisin : il ne bouge pas et réessaie.
 *
 * Le crapaud occupe la case choisie dès ce pas ; la case quittée reste occupée jusqu'à `settleToad` (appelé ici avant le pas suivant).
 */
export function stepToad(state: LillyState, toad: Toad): ToadStep {
  if (!toad.active || toad.landed) return { kind: "wait", reason: "blocked" };
  settleToad(state, toad);
  const m = toad.counters;
  const here = toad.row * 12 + toad.col;
  if (m[here]! >= COUNTER_LIMIT) {
    m.fill(0);
    m[here] = 1;
  }
  let n = m[here]!;
  if (n === 0) {
    n = 1;
    m[here] = 1;
  }
  let best = -1;
  let bestValue = n;
  let target: Cell = { col: toad.col, row: toad.row };
  let exit = false;
  let h = toad.heading;
  for (let k = 0; k < 4 && !exit; k++) {
    let nx = toad.col;
    let ny = toad.row;
    let ok = true;
    if (h === 0) {
      ny--;
      ok = ny >= 0;
    } else if (h === 1) {
      nx++;
      if (nx >= POND_SIZE) {
        ok = false;
        exit = true;
      }
    } else if (h === 2) {
      ny++;
      ok = ny < POND_SIZE;
    } else {
      nx--;
      ok = nx >= 0;
    }
    if (ok) {
      const lily = state.pond.cells[cellIndex(nx, ny)]!;
      if (!lily.occupied && matches(lily, toad.kind, toad.value) && m[ny * 12 + nx]! < bestValue) {
        best = h;
        bestValue = m[ny * 12 + nx]!;
        target = { col: nx, row: ny };
      }
    }
    h = ((h + 1) % 4) as Heading;
  }
  if (exit) {
    if (state.pond.landing[toad.row]) return { kind: "wait", reason: "landing" };
    state.pond.landing[toad.row] = true;
    toad.heading = 1;
    toad.landed = true;
    return { kind: "exit", row: toad.row };
  }
  if (best < 0) return { kind: "wait", reason: "blocked" };
  const from = { col: toad.col, row: toad.row };
  toad.heading = best as Heading;
  m[target.row * 12 + target.col] = n + 1;
  state.pond.cells[cellIndex(target.col, target.row)]!.occupied = true;
  toad.leaving = here;
  toad.col = target.col;
  toad.row = target.row;
  return { kind: "jump", heading: toad.heading, from, to: target };
}

/**
 * Événement 30 de l'arrivée (`10f8:3c03`) : le Zoombini est sauvé, `DS:7bca` monte, la case de la colonne 11 est libérée, le crapaud rentre (il pourra
 * être déposé de nouveau ; la scène attend la fin de son animation de retour). Le crapaud sort de la liste `DS:7cf2` à la fin de sa première sortie
 * (`10f8:3614`, **probable** : lu au désassemblage de la plage que Ghidra n'a pas décompilée).
 */
export function arrive(state: LillyState, toad: Toad): boolean {
  if (!toad.active || !toad.landed) return false;
  state.pond.cells[cellIndex(toad.col, toad.row)]!.occupied = false;
  settleToad(state, toad);
  if (toad.token >= 0) state.saved[toad.token] = true;
  state.arrivals++;
  toad.trips++;
  toad.target = 0;
  toad.active = false;
  toad.landed = false;
  toad.listed = false;
  toad.token = -1;
  return true;
}

/** Événement 54 puis 60 (`10f8:3614`, `10f8:30ba`) : le Zoombini a quitté la case d'abordage de la rangée. */
export function releaseLanding(state: LillyState, row: number): void {
  state.pond.landing[row] = false;
}

/** Le bouton « suite » est actif dès la première arrivée (`DS:82f4`). */
export function canLeave(state: LillyState): boolean {
  return state.arrivals > 0;
}

// --- La fée (`10f8:6cdf`, `10f8:5831`) ---

/** Les deux nénuphars sont libres, distincts, la fée existe et sa baguette n'est pas épuisée. */
export function canExchange(state: LillyState, a: Cell, b: Cell): boolean {
  if (!hasFairy(state) || state.fairy.gauge >= FAIRY_GAUGE) return false;
  if (!inPond(a.col, a.row) || !inPond(b.col, b.row) || (a.col === b.col && a.row === b.row)) return false;
  return !state.pond.cells[cellIndex(a.col, a.row)]!.occupied && !state.pond.cells[cellIndex(b.col, b.row)]!.occupied;
}

/**
 * Échange de deux nénuphars libres. Ordre de l'original : le compte (`DS:7bd4`, cran de la jauge tous les `perGauge` échanges) est fait au deuxième choix,
 * et si la jauge atteint 6 avec tous les jetons lancés, `settleRemaining` s'exécute **avant** que l'échange ne soit appliqué (`10f8:6cdf`) ; puis `10f8:5831` :
 * les 4 octets (A, B, C, motif) sont permutés, les compteurs des deux cases sont remis à 0 chez les crapauds listés, qui sont recalculés (`10f0:0000`) si l'une des
 * deux cases correspond à leur tatouage ; le champ de distance des grenouilles est recalculé pour les valeurs des grenouilles dans ce cas.
 * Un échange refusé renvoie false sans rien changer.
 */
export function exchange(state: LillyState, a: Cell, b: Cell): boolean {
  if (!canExchange(state, a, b)) return false;
  const f = state.fairy;
  f.total++;
  f.inGauge++;
  if (f.inGauge >= f.perGauge && f.gauge < FAIRY_GAUGE) {
    f.inGauge = 0;
    f.gauge++;
    if (f.gauge === FAIRY_GAUGE && state.launched === state.group) settleRemaining(state);
  }
  applyExchange(state, a, b);
  return true;
}

/** `10f8:5831` : l'échange lui-même, sans compte. Appelé aussi par la génération (échanges fixes). */
function applyExchange(state: LillyState, a: Cell, b: Cell): void {
  swapLilies(state.pond, a, b);
  const ia = cellIndex(a.col, a.row);
  const ib = cellIndex(b.col, b.row);
  for (const toad of state.toads) {
    if (!toad.listed || !toad.active) continue;
    toad.counters[ia] = 0;
    toad.counters[ib] = 0;
    if (matches(state.pond.cells[ia]!, toad.kind, toad.value) || matches(state.pond.cells[ib]!, toad.kind, toad.value)) precomputeToad(toad, state.pond);
  }
  const values = new Set<number>();
  for (const frog of state.frogs) {
    if (!frog.alive || frog.kind === 0) continue;
    if (matches(state.pond.cells[ia]!, frog.kind, frog.value) || matches(state.pond.cells[ib]!, frog.kind, frog.value)) values.add(frog.value);
  }
  for (const value of values) state.frogField[value] = computeFrogField(state.pond, frogKind(state), value);
}

// --- Fin d'épreuve (`10f8:7866`) ---

/**
 * `10f8:7866` : quand la baguette est épuisée et tous les jetons lancés, les crapauds encore sur l'étang, listés, dont le pré-calcul atteint la colonne 11
 * (`+0x106 == 11`) comptent comme arrivés : leur Zoombini est sauvé sans attendre. À appeler aussi à la sortie si la scène veut cette règle ; ici elle est
 * déclenchée par `drop` et `exchange` comme dans l'original.
 */
export function settleRemaining(state: LillyState): void {
  for (const toad of state.toads) if (toad.listed && toad.active && toad.target === 11 && toad.token >= 0) state.saved[toad.token] = true;
}

export interface LillyOutcome {
  /** Zoombinis sauvés (indices dans l'ordre de lancement, donc dans l'ordre du groupe). */
  saved: number;
  /** Zoombinis perdus : le groupe moins les sauvés (ceux qui n'ont pas été lancés sont perdus aussi). */
  lost: number;
  /** Drapeau par Zoombini (`+0x127` de l'objet). */
  flags: readonly boolean[];
}

export function outcome(state: LillyState): LillyOutcome {
  const saved = state.saved.filter(Boolean).length;
  return { saved, lost: state.group - saved, flags: state.saved.slice() };
}

// --- Simulation sans temps ---

/**
 * Fait avancer les crapaudss actifs, un pas chacun par tour dans l'ordre des rangées de repos, jusqu'à l'arrivée de tous ou `maxTurns`. L'arrivée est
 * immédiate (événement 30 puis 60). Renvoie le nombre de tours. Sert aux tests et au robot ; la scène, elle, cadence les pas.
 */
export function runToads(state: LillyState, maxTurns = 5000): number {
  let turns = 0;
  while (turns < maxTurns && state.toads.some((t) => t.active)) {
    turns++;
    for (const toad of state.toads) {
      if (!toad.active) continue;
      const step = stepToad(state, toad);
      if (step.kind === "exit") {
        arrive(state, toad);
        releaseLanding(state, step.row);
      }
    }
  }
  return turns;
}

// --- Grenouilles (`10f8:4a84`, `10f0:1207`, `10f0:14cb`, `10f0:00e5`, `10f0:0321`) ---

/** Caractéristique des grenouilles = celle du gabarit tourné (`10f8:5f02` : `DS:7c76`). 0 sans grenouille. */
export function frogKind(state: LillyState): Kind | 0 {
  return state.info.entries[0]?.kind ?? 0;
}

/**
 * `10f0:00e5` : champ de distance des nénuphars de valeur `value` pour la caractéristique `kind`. Les graines sont, en remontant de la rangée 11 à la rangée 0,
 * les nénuphars de la valeur pas encore atteints (distance 1) ; un parcours en largeur étend le champ à 4 voisins. Chaque composante est donc mesurée depuis sa
 * rangée la plus basse. Indice `(row + 1) × 12 + col` (la rangée 0 de l'original est vide).
 */
export function computeFrogField(pond: Pond, kind: Kind | 0, value: number): Int16Array {
  const field = new Int16Array(13 * 12);
  if (kind === 0) return field;
  const seen = new Uint8Array(13 * 12);
  const queue: Cell[] = [];
  const ok = (c: Cell) => matches(pond.cells[cellIndex(c.col, c.row)]!, kind, value);
  for (let row = 11; row >= 0; row--) {
    for (let col = 0; col < POND_SIZE; col++) {
      const i = (row + 1) * 12 + col;
      if (ok({ col, row }) && !seen[i]) {
        seen[i] = 1;
        field[i] = 1;
        queue.push({ col, row });
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head]!;
      for (const n of neighbors(cur.col, cur.row)) {
        const j = (n.row + 1) * 12 + n.col;
        if (!seen[j] && ok(n)) {
          seen[j] = 1;
          field[j] = field[(cur.row + 1) * 12 + cur.col]! + 1;
          queue.push(n);
        }
      }
    }
    queue.length = 0;
  }
  return field;
}

/** Les grenouilles ne se créent qu'aux niveaux 2 et 3 (`DS:1396 > 2`), tant que des jetons restent à lancer (`DS:9702 < 1`, **probable**) et sous la limite de vivantes. */
export function frogSpawnAllowed(state: LillyState): boolean {
  return state.info.entries.length > 0 && state.launched < state.group && state.frogs.filter((f) => f.alive).length < FROG_MAX_ALIVE;
}

/**
 * Création d'une grenouille au point d'entrée courant (`10f8:0bd7`, `10f8:4a84`), à appeler à l'échéance (premier appel `FROG_FIRST_TICKS` après l'entrée,
 * puis tous les `FROG_PERIOD_TICKS`). Le point d'entrée suivant devient courant dans tous les cas. Case d'entrée libre : grenouille ordinaire, qui prend
 * le tatouage de la case ; case occupée alors qu'une grenouille ordinaire est déjà venue là : variante qui descend tout droit ; sinon rien (null).
 */
export function spawnFrog(state: LillyState): Frog | null {
  const entries = state.info.entries;
  if (!frogSpawnAllowed(state)) return null;
  const index = state.nextEntry;
  const entry = entries[index]!;
  state.nextEntry = (index + 1) % entries.length;
  const lily = state.pond.cells[cellIndex(entry.col, 0)]!;
  let frog: Frog;
  if (!lily.occupied) {
    frog = { id: state.frogsCreated, entry: index, kind: entry.kind, value: attrOf(lily, entry.kind), col: entry.col, row: 0, variant: false, adopted: false, alive: true, leaving: null };
    lily.occupied = true;
    state.frogSeen[entry.col] = true;
  } else if (state.frogSeen[entry.col]) {
    frog = { id: state.frogsCreated, entry: index, kind: 0, value: 0, col: entry.col, row: 0, variant: true, adopted: false, alive: true, leaving: null };
  } else return null;
  state.frogsCreated++;
  state.frogs.push(frog);
  return frog;
}

export type FrogStep =
  | { kind: "jump"; heading: Heading; from: Cell; to: Cell }
  | { kind: "exit" }
  | { kind: "wait" };

/** Libère la case quittée au saut précédent (événement du saut, `10f8:267b` cas 6). */
export function settleFrog(state: LillyState, frog: Frog): void {
  if (frog.leaving !== null) {
    state.pond.cells[frog.leaving]!.occupied = false;
    frog.leaving = null;
  }
}

/**
 * Un pas de grenouille. Ordinaire (`10f0:1207`, **sûr**) : sens fixes haut, droite, bas, gauche ; elle va sur le premier voisin libre, de sa valeur, dont le
 * champ de distance est strictement plus petit que celui de sa case ; depuis la rangée 11 le sens « bas » la fait sortir. **Particularité** : le champ n'est
 * calculé que par un échange de la fée qui touche un nénuphar de sa valeur (`applyExchange`) ; tant que ce n'est pas arrivé, il vaut 0 partout et une grenouille
 * ordinaire ne bouge pas (sauf pour sortir de la rangée 11). Variante (`10f0:14cb`) : descend d'une case par pas, même sur un nénuphar occupé ; au premier
 * nénuphar libre elle adopte sa valeur, puis devient ordinaire au pas suivant. La grenouille ne tue ni n'enlève rien : elle occupe seulement ses cases.
 * Sortie : la case est libérée (événement 80, `10f8:2509`).
 */
export function stepFrog(state: LillyState, frog: Frog): FrogStep {
  if (!frog.alive) return { kind: "wait" };
  settleFrog(state, frog);
  const here = cellIndex(frog.col, frog.row);
  const leave = (): FrogStep => {
    state.pond.cells[here]!.occupied = false;
    frog.alive = false;
    return { kind: "exit" };
  };
  if (frog.variant) {
    if (frog.adopted) {
      frog.variant = false;
      frog.adopted = false;
      return { kind: "wait" };
    }
    const nr = frog.row + 1;
    if (nr >= POND_SIZE) return leave();
    const next = state.pond.cells[cellIndex(frog.col, nr)]!;
    if (!next.occupied) {
      frog.kind = frogKind(state);
      frog.value = attrOf(next, frog.kind as Kind);
      frog.adopted = true;
    }
    next.occupied = true;
    const from = { col: frog.col, row: frog.row };
    frog.row = nr;
    return { kind: "jump", heading: 2, from, to: { col: frog.col, row: nr } };
  }
  const kind = frog.kind as Kind;
  const field = state.frogField[frog.value];
  const dist = (col: number, row: number) => field?.[(row + 1) * 12 + col] ?? 0;
  for (let dir = 0; dir < 4; dir++) {
    let nx = frog.col;
    let ny = frog.row;
    if (dir === 0) ny--;
    else if (dir === 1) nx++;
    else if (dir === 2) {
      ny++;
      if (ny >= POND_SIZE) return leave();
    } else nx--;
    if (!inPond(nx, ny)) continue;
    const lily = state.pond.cells[cellIndex(nx, ny)]!;
    if (!lily.occupied && matches(lily, kind, frog.value) && dist(nx, ny) < dist(frog.col, frog.row)) {
      lily.occupied = true;
      const from = { col: frog.col, row: frog.row };
      frog.leaving = here;
      frog.col = nx;
      frog.row = ny;
      return { kind: "jump", heading: dir as Heading, from, to: { col: nx, row: ny } };
    }
  }
  return { kind: "wait" };
}

// --- Robot ---

export type LillyMove = { kind: "drop"; toad: number; row: number } | { kind: "exchange"; a: Cell; b: Cell };

interface Repair {
  toad: number;
  path: Cell[];
  gaps: Cell[];
  donors: Cell[];
}

/**
 * Cherche, pour le crapaud, le chemin libre de la colonne 0 à la colonne 11 qui demande le moins de réparations (une réparation = un nénuphar du chemin
 * qui n'a pas la valeur, échangé avec un nénuphar libre de la valeur situé hors du chemin), à coût égal le plus court. Dijkstra sur les nénuphars libres.
 */
function cheapestRepair(state: LillyState, toad: Toad): Repair | null {
  const pond = state.pond;
  const free = (c: Cell) => !pond.cells[cellIndex(c.col, c.row)]!.occupied;
  const good = (c: Cell) => matches(pond.cells[cellIndex(c.col, c.row)]!, toad.kind, toad.value);
  // coût = gaps × 1000 + longueur.
  const dist = new Array<number>(144).fill(Infinity);
  const prev = new Array<number>(144).fill(-2);
  const done = new Array<boolean>(144).fill(false);
  for (let row = 0; row < POND_SIZE; row++) {
    const c = { col: 0, row };
    if (free(c)) {
      dist[cellIndex(0, row)] = (good(c) ? 0 : 1000) + 1;
      prev[cellIndex(0, row)] = -1;
    }
  }
  for (;;) {
    let u = -1;
    for (let i = 0; i < 144; i++) if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0) return null;
    done[u] = true;
    const cu = { col: u % 12, row: Math.trunc(u / 12) };
    if (cu.col === 11) {
      const path: Cell[] = [];
      for (let i = u; i !== -1; i = prev[i]!) path.push({ col: i % 12, row: Math.trunc(i / 12) });
      path.reverse();
      const gaps = path.filter((c) => !good(c));
      const onPath = new Set(path.map((c) => cellIndex(c.col, c.row)));
      const donors: Cell[] = [];
      for (let i = 0; i < 144; i++) {
        const c = { col: i % 12, row: Math.trunc(i / 12) };
        if (!onPath.has(i) && free(c) && good(c)) donors.push(c);
      }
      return { toad: toad.index, path, gaps, donors };
    }
    for (const n of neighbors(cu.col, cu.row)) {
      const j = cellIndex(n.col, n.row);
      if (!free(n) || done[j]) continue;
      const alt = dist[u]! + (good(n) ? 0 : 1000) + 1;
      if (alt < dist[j]!) {
        dist[j] = alt;
        prev[j] = u;
      }
    }
  }
}

/**
 * Robot : choisit les coups pour sauver le plus de Zoombinis. Un seul chemin suffit pour tout le groupe, car un crapaud rentré peut être redéposé : le robot
 * prend le tatouage dont le chemin demande le moins d'échanges (aucun au niveau 0), prévoit ces échanges (nénuphar manquant <-> nénuphar libre de la bonne valeur
 * hors du chemin, dans la limite du budget de la fée) puis redépose ce crapaud `group − launched` fois, chaque fois à la rangée de départ du chemin. Sans chemin
 * réparable, il ne joue rien. L'état n'est pas modifié. Les cases occupées (grenouilles, crapauds en cours de route) comptent comme des obstacles à l'instant du calcul.
 */
export function planLilly(state: LillyState): LillyMove[] {
  const left = state.group - state.launched;
  if (left <= 0) return [];
  let best: Repair | null = null;
  for (const toad of state.toads) {
    if (toad.active) continue;
    const repair = cheapestRepair(state, toad);
    if (!repair || repair.gaps.length > repair.donors.length || repair.gaps.length > exchangesLeft(state)) continue;
    if (!best || repair.gaps.length < best.gaps.length || (repair.gaps.length === best.gaps.length && repair.path.length < best.path.length)) best = repair;
  }
  if (!best) return [];
  const moves: LillyMove[] = best.gaps.map((gap, i) => ({ kind: "exchange" as const, a: gap, b: best!.donors[i]! }));
  for (let i = 0; i < left; i++) moves.push({ kind: "drop", toad: best.toad, row: best.path[0]!.row });
  return moves;
}

/**
 * Joue un plan sur l'état avec `runToads` entre deux dépôts. Renvoie le nombre de coups acceptés. Sert aux tests et au futur robot de partie (vague J).
 */
export function playPlan(state: LillyState, moves: readonly LillyMove[]): number {
  let accepted = 0;
  for (const move of moves) {
    const ok = move.kind === "drop" ? drop(state, move.toad, move.row) : exchange(state, move.a, move.b);
    if (ok) accepted++;
    runToads(state);
  }
  return accepted;
}
