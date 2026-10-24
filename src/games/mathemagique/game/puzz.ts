/**
 * Ressources `PUZZ` des trois puzzles (Hidden, Puzzle Patterns, Super Sticklers) et formules d'identifiants.
 *
 * Le tag `PUZZ` est partagé mais **pas la structure** (hidden.md §2.1, patterns.md §2.1, sticklers.md §2.1) : un analyseur par activité.
 * Niveaux (« Level Brothers ») : 0 vert, 1 orange, 2 rouge ; `k` = rang de la vignette dans le menu, 0 à 8 (ligne par ligne).
 * Module pur : octets en entrée, aucune dépendance au moteur.
 */

export const LEVELS = 3;
export const PUZZLES_PER_LEVEL = 9;

function checkLevel(level: number, k: number): void {
  if (!Number.isInteger(level) || level < 0 || level >= LEVELS) throw new RangeError(`niveau ${level} hors de 0 à ${LEVELS - 1}`);
  if (!Number.isInteger(k) || k < 0 || k >= PUZZLES_PER_LEVEL) throw new RangeError(`puzzle ${k} hors de 0 à ${PUZZLES_PER_LEVEL - 1}`);
}

// --- Hidden (hidden.md §2.1) ---

export interface Cell {
  /** Colonne (x), origine 0. */
  x: number;
  /** Ligne (y), origine 0. */
  y: number;
}

export interface HiddenPieceDef {
  cells: Cell[];
}

export interface HiddenPuzz {
  pieces: HiddenPieceDef[];
}

/** Taille maximale d'une pièce (cellules) dans le fichier : 7 × (a, b). */
const HIDDEN_MAX_CELLS = 7;
const HIDDEN_RECORD = 15;

/**
 * `PUZZ` de Hidden : `u8 n`, puis `n` × 15 octets = `u8 k` (1 à 7) et 7 × `(u8 a, u8 b)` (colonne, ligne) dont seules les `k` premières comptent
 * (les octets de bourrage, p. ex. le résidu `01` du 6e enregistrement de 1001, sont ignorés). Longueur exacte `1 + 15 n`.
 */
export function parseHiddenPuzz(bytes: Uint8Array): HiddenPuzz {
  if (bytes.length < 1) throw new Error("PUZZ Hidden : ressource vide");
  const n = bytes[0]!;
  // La ressource peut être complétée (multiple de 2048 dans l'archive) : on exige au moins la taille utile.
  if (bytes.length < 1 + HIDDEN_RECORD * n) throw new Error(`PUZZ Hidden : ${bytes.length} octets pour ${n} pièces (${1 + HIDDEN_RECORD * n} attendus)`);
  const pieces: HiddenPieceDef[] = [];
  for (let i = 0; i < n; i++) {
    const at = 1 + i * HIDDEN_RECORD;
    const k = bytes[at]!;
    if (k < 1 || k > HIDDEN_MAX_CELLS) throw new Error(`PUZZ Hidden : pièce ${i} : ${k} cellules (1 à ${HIDDEN_MAX_CELLS})`);
    const cells: Cell[] = [];
    for (let c = 0; c < k; c++) cells.push({ x: bytes[at + 1 + 2 * c]!, y: bytes[at + 2 + 2 * c]! });
    pieces.push({ cells });
  }
  return { pieces };
}

/** `PUZZ` du découpage : `1000 + 32 × niveau + tirage` (`1030:18eb`). `tirage` : 0 à 8, choisi au hasard sans remise (voir `HiddenSelection`). */
export function hiddenPuzzId(level: number, draw: number): number {
  checkLevel(level, draw);
  return 1000 + 32 * level + draw;
}

/** `SHPL` de la photo (une forme 238×238) : `5070 + 9 × niveau + k`, `k` = vignette (0 à 8). */
export function hiddenPhotoShplId(level: number, k: number): number {
  checkLevel(level, k);
  return 5070 + 9 * level + k;
}

/** `SCR` / `SHPL` / `SNDL` de l'animation de fin : `5100 + 900 × niveau + 100 × k`. */
export function hiddenRewardId(level: number, k: number): number {
  checkLevel(level, k);
  return 5100 + 900 * level + 100 * k;
}

/** `SHPL` du menu des 9 vignettes : `7800 + 10 × niveau`. */
export function hiddenMenuShplId(level: number): number {
  checkLevel(level, 0);
  return 7800 + 10 * level;
}

// --- Puzzle Patterns (patterns.md §2.1) ---

export const PATTERNS_PIECES = 8;

export interface PatternsPuzz {
  /** Par pièce : 0 = verticale (1 colonne × 2 lignes) dans la solution, 1 = horizontale (2 × 1). Sert aussi de rotation initiale. */
  orient: number[];
  /** Colonne de la case haut-gauche de la pièce dans la solution (orientation correcte), 0 à 3. */
  col: number[];
  /** Ligne idem. */
  row: number[];
}

/** `PUZZ` de Patterns : 8 octets d'orientation puis 8 × `(u16 col, u16 ligne)` gros-boutistes, 40 octets. */
export function parsePatternsPuzz(bytes: Uint8Array): PatternsPuzz {
  if (bytes.length < 8 + 4 * PATTERNS_PIECES) throw new Error(`PUZZ Patterns : ${bytes.length} octets, 40 attendus`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const orient: number[] = [];
  const col: number[] = [];
  const row: number[] = [];
  for (let i = 0; i < PATTERNS_PIECES; i++) {
    orient.push(bytes[i]!);
    col.push(view.getUint16(8 + 4 * i, false));
    row.push(view.getUint16(10 + 4 * i, false));
  }
  return { orient, col, row };
}

/** `PUZZ` et `SHPL` du puzzle : `6600 + 450 × niveau + 50 × k`. */
export function patternsPuzzId(level: number, k: number): number {
  checkLevel(level, k);
  return 6600 + 450 * level + 50 * k;
}

/** `SCR` / `SNDL` / `SHPL` de l'animation de victoire : `20000 + 900 × niveau + 100 × k`. */
export function patternsRewardId(level: number, k: number): number {
  checkLevel(level, k);
  return 20000 + 900 * level + 100 * k;
}

/** `SHPL` des vignettes du niveau : `6520 + 10 × niveau`. */
export function patternsThumbsShplId(level: number): number {
  checkLevel(level, 0);
  return 6520 + 10 * level;
}

// --- Super Sticklers (sticklers.md §2.1, §8.1) ---

export interface StickPieceDef {
  /** Nombre d'orientations de la pièce : 1, 2 ou 4. */
  orientations: 1 | 2 | 4;
  /** Coin haut-gauche de la position finale (écran), pour l'orientation 0. */
  x: number;
  y: number;
}

export interface SticklersPuzz {
  count: number;
  /** Coin du gabarit (`SHAP` 1) : 40, 29 pour la plupart des puzzles. */
  templateX: number;
  templateY: number;
  pieces: StickPieceDef[];
}

/** `PUZZ` de Sticklers : `u16` gros-boutistes `n`, drapeau (toujours 0), `x` et `y` du gabarit, puis `n` × `(a, x, y)` ; longueur `8 + 6 n`. */
export function parseSticklersPuzz(bytes: Uint8Array): SticklersPuzz {
  if (bytes.length < 8) throw new Error(`PUZZ Sticklers : ${bytes.length} octets`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(0, false);
  if (bytes.length < 8 + 6 * count) throw new Error(`PUZZ Sticklers : ${bytes.length} octets pour ${count} fragments (${8 + 6 * count} attendus)`);
  const pieces: StickPieceDef[] = [];
  for (let i = 0; i < count; i++) {
    const at = 8 + 6 * i;
    const a = view.getUint16(at, false);
    if (a !== 1 && a !== 2 && a !== 4) throw new Error(`PUZZ Sticklers : fragment ${i} : ${a} orientations (1, 2 ou 4)`);
    pieces.push({ orientations: a, x: view.getUint16(at + 2, false), y: view.getUint16(at + 4, false) });
  }
  return { count, templateX: view.getUint16(4, false), templateY: view.getUint16(6, false), pieces };
}

/** `PUZZ` et `SHPL` du puzzle : `2100 + 900 × niveau + 100 × k`. */
export function puzzId(level: number, k: number): number {
  checkLevel(level, k);
  return 2100 + 900 * level + 100 * k;
}

/** `SCR` / `SHPL` / `SNDL` de l'animation de récompense : `8000 + 50 × (9 × niveau + k)`. */
export function rewardId(level: number, k: number): number {
  checkLevel(level, k);
  return 8000 + 50 * (9 * level + k);
}

/** `SHPL` du menu : `2020`, `2030`, `2040`. */
export function sticklersMenuShplId(level: number): number {
  checkLevel(level, 0);
  return 2020 + 10 * level;
}

/** Index 0-based, dans la `SHPL` du puzzle, de la première forme de fragment : 1 (les formes 0 = gabarit) ou 2 au niveau rouge (miniature). */
export function firstShapeIndex(level: number): number {
  checkLevel(level, 0);
  return level === 2 ? 2 : 1;
}

/** Index 0-based, dans la `SHPL`, de la première orientation de chaque fragment (cumul des orientations des précédents). */
export function shapeBases(puzz: SticklersPuzz, level: number): number[] {
  const bases: number[] = [];
  let next = firstShapeIndex(level);
  for (const piece of puzz.pieces) {
    bases.push(next);
    next += piece.orientations;
  }
  return bases;
}

/** Nombre de formes attendu dans la `SHPL` du puzzle : fragments + gabarit (+ miniature au niveau rouge). */
export function expectedShapeCount(puzz: SticklersPuzz, level: number): number {
  return firstShapeIndex(level) + puzz.pieces.reduce((sum, piece) => sum + piece.orientations, 0);
}
