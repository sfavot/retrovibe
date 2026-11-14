/**
 * Grilles de collision (« grids ») : 70 fichiers de 120 octets, un bit par bloc de 8 × 8 pixels de l'écran de jeu (40 colonnes × 24 lignes).
 *
 * Référence : ScummVM engines/sky/grid.cpp (`Grid::loadGrids`, `getGridValues`, `objectToWalk`, `removeObjectFromWalk`, `_gridConvertTable`) et
 * skydefs.h (`TOT_NO_GRIDS`, `GRID_SIZE`) (GPL v3 ou ultérieure).
 *
 * Ordre des bits : la case (colonne, ligne) a le rang `k = ligne * 40 + colonne` ; la grille est lue par mots de 32 bits petit-boutistes dont
 * le bit de poids fort est la première case : numéro de bit = `(k & ~31) + (31 - (k & 31))`, octet = `bit >> 3`, masque = `1 << (bit & 7)`.
 * Un bit à 1 marque un bloc infranchissable. Les lignes de 40 cases ne sont pas alignées sur les mots de 32 bits.
 *
 * Écart volontaire : seul le format est porté ici ; le retrait et la pose d'objets sur la grille (`getGridValues` : décalages écran, largeurs)
 * relèvent du moteur.
 */

export const GRID_FILE_START = 60000;
export const TOT_NO_GRIDS = 70;
export const GRID_SIZE = 120;
export const GRID_COLUMNS = 40;
export const GRID_ROWS = 24;
/** Taille d'un bloc, en pixels. */
export const GRID_BLOCK = 8;

/** `Grid::_gridConvertTable` : écran (0 à 96) vers numéro de grille ; -1 : aucune grille, `TOT_NO_GRIDS` : valeur hors plage de ScummVM. */
export const GRID_CONVERT_TABLE: readonly number[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, -1, 35, 36,
  37, 38, 39, 40, 41, -1, 42, 43, 44, 45, 46, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 47, 70, 48, 49, 50, 51, 52, 53, 54,
  55, 56, 57, 58, 59, 60, -1, 61, 62, -1, -1, -1, -1, -1, -1, 70, 63, 64, 65, 66, 67, 68, 69,
];

/** Numéro de grille de l'écran `screen`, ou `undefined` s'il n'en a pas (`giveGrid`). */
export function gridIndexOfScreen(screen: number): number | undefined {
  const grid = GRID_CONVERT_TABLE[screen];
  return grid !== undefined && grid >= 0 && grid < TOT_NO_GRIDS ? grid : undefined;
}

/** Numéro de bit (dans la grille de 960 bits) de la case `(column, row)`. */
export function gridBitNumber(column: number, row: number): number {
  if (!Number.isInteger(column) || !Number.isInteger(row) || column < 0 || column >= GRID_COLUMNS || row < 0 || row >= GRID_ROWS) {
    throw new RangeError(`case de grille (${column}, ${row}) hors limites`);
  }
  const k = row * GRID_COLUMNS + column;
  return (k & ~31) + (31 - (k & 31));
}

function checkGrid(grid: Uint8Array): void {
  if (grid.length !== GRID_SIZE) throw new Error(`grille invalide : ${grid.length} octets, ${GRID_SIZE} attendus`);
}

export function isGridBlocked(grid: Uint8Array, column: number, row: number): boolean {
  checkGrid(grid);
  const bit = gridBitNumber(column, row);
  return (grid[bit >> 3]! & (1 << (bit & 7))) !== 0;
}

export function setGridBlocked(grid: Uint8Array, column: number, row: number, blocked: boolean): void {
  checkGrid(grid);
  const bit = gridBitNumber(column, row);
  if (blocked) grid[bit >> 3]! |= 1 << (bit & 7);
  else grid[bit >> 3]! &= ~(1 << (bit & 7));
}

/** Développe une grille en 960 cases (0 ou 1), ligne par ligne. */
export function gridToCells(grid: Uint8Array): Uint8Array {
  checkGrid(grid);
  const cells = new Uint8Array(GRID_COLUMNS * GRID_ROWS);
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let column = 0; column < GRID_COLUMNS; column++) cells[row * GRID_COLUMNS + column] = isGridBlocked(grid, column, row) ? 1 : 0;
  }
  return cells;
}
