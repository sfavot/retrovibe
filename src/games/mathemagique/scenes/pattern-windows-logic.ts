/**
 * Pattern Windows (scène 3, `PATFILL.DAT`) : règles pures du coloriage de vitrail, sans DOM ni audio. Comportement d'origine :
 * `docs/mathemagique/screens/pattern-windows.md` (§1.3 à §1.6, §2.1, §5, §8.1).
 *
 * - `parsePtrn` / `layoutCells` : les 10 réseaux de tuiles (`PTRN`, 100 octets) → cellules colorables ;
 * - `unpackCells` / `packCells` / `readStorage` / `writeStorage` : le stockage du roster (2 cellules par octet, quartet bas = cellule paire) ;
 * - `paintAt` : un sondage de peinture (une cellule modifiée au plus), `toggleUndo` (Yuck !), `applyFaucet` (Robinet et outils cachés) ;
 * - `isColorful` (compliment de Poly), `rotatePalette` (kaléidoscope), `faucetMode` (zone du clic sur le Robinet) ;
 * - `encodeIndexedPng` / `cropPixels` : image PNG (palette indexée) de la fenêtre pour le bouton Imprimer.
 */

// --- Constantes (pattern-windows.md §1.3, §1.5, §2.1) ---

export const PATTERN_COUNT = 10;
export const COLOR_COUNT = 15;
export const VERSION_COUNT = 3;
/** Taille du tampon de travail (`DS:7053`, 0x20c) : 1 octet par cellule. */
export const MAX_CELLS = 524;
/** Première entrée de palette des 15 couleurs de peinture. */
export const PALETTE_FIRST = 180;
/** Couleur d'un vitrail neuf : le bleu clair du ciel (octet de stockage `0x77`). */
export const BLANK_COLOR = 7;
export const BLANK_BYTE = 0x77;
/** Coin haut-gauche de la fenêtre de peinture (les décalages de `PTRN` s'y ajoutent). */
export const WINDOW_ORIGIN = { x: 52, y: 46 } as const;
/** Rectangle imprimé, `(gauche, haut, droite, bas)` : la fenêtre agrandie d'un pixel (`1088:0000`). */
export const PRINT_EDGES = { left: 51, top: 45, right: 394, bottom: 388 } as const;

/** Premier masque (1-basé dans la `SHPL` 40200) de chaque motif : masque de la cellule `j` = `SHAP 40199 + base + j`. */
export const PATTERN_MASK_BASE = [1, 5, 9, 21, 25, 31, 40, 43, 47, 52] as const;
export const MASK_SHAPE_BASE = 40199;
/** Octets de stockage alloués à chaque motif (`1060:1271`). */
export const PATTERN_STORAGE_BYTES = [200, 168, 234, 206, 138, 262, 128, 88, 204, 126] as const;
/** Déplacement du motif dans une version : somme des tailles précédentes (0x000, 0x0c8, 0x170, 0x25a, …, 0x65c). */
export const PATTERN_VERSION_OFFSETS: readonly number[] = PATTERN_STORAGE_BYTES.map((_, i) =>
  PATTERN_STORAGE_BYTES.slice(0, i).reduce((sum, bytes) => sum + bytes, 0),
);
/** Taille d'une version (0x6da) et du stockage entier (3 versions, 5 262 octets). */
export const VERSION_STRIDE = 0x6da;
export const STORAGE_BYTES = VERSION_STRIDE * VERSION_COUNT;
/** Cellules de chaque motif (somme des `nb[r]` de `PTRN`), pour les contrôles. */
export const PATTERN_CELL_COUNTS = [400, 336, 468, 412, 276, 522, 255, 176, 405, 252] as const;
/** Seuil du compliment : le plafond de cellules comptées. */
const COLORFUL_MAX_CELLS = MAX_CELLS;

// --- Navigation circulaire ---

export function nextColor(color: number): number {
  return color >= COLOR_COUNT - 1 ? 0 : color + 1;
}

export function prevColor(color: number): number {
  return color <= 0 ? COLOR_COUNT - 1 : color - 1;
}

export function nextPattern(pattern: number): number {
  return pattern >= PATTERN_COUNT - 1 ? 0 : pattern + 1;
}

export function prevPattern(pattern: number): number {
  return pattern <= 0 ? PATTERN_COUNT - 1 : pattern - 1;
}

/** Rotation d'un cran vers le début de la palette (`1060:1627`) : `[a0…a14] → [a1…a14, a0]`. */
export function rotatePalette<T>(colors: readonly T[]): T[] {
  return colors.length === 0 ? [] : [...colors.slice(1), colors[0]!];
}

// --- Réseau de tuiles (`PTRN`) ---

export interface PatternGeometry {
  /** Cellules par tuile (= nombre de masques du motif). */
  cellsPerTile: number;
  /** Hauteur et largeur du rectangle d'une tuile (= celles des masques). */
  tileHeight: number;
  tileWidth: number;
  /** Décalage de la première tuile par rapport à `WINDOW_ORIGIN`. */
  originX: number;
  originY: number;
  /** Déplacement d'une tuile à la suivante dans une ligne. */
  tileStepX: number;
  tileStepY: number;
  /** Déplacement du départ d'une ligne à la suivante. */
  rowStepX: number;
  rowStepY: number;
  rows: number;
  /** Pas `(tileStep)` à faire avant la première tuile de la ligne `r`. */
  skip: number[];
  /** Tuiles de la ligne `r`. */
  count: number[];
}

/** Les 50 mots gros-boutistes signés de la ressource `PTRN` (exactement 100 octets). */
export function parsePtrn(bytes: Uint8Array): PatternGeometry {
  if (bytes.length !== 100) throw new Error(`PTRN : 100 octets attendus, ${bytes.length} reçus`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = (i: number) => view.getInt16(i * 2, false);
  const rows = word(9);
  if (rows < 0 || rows > 20) throw new Error(`PTRN : ${rows} lignes (20 au plus)`);
  return {
    cellsPerTile: word(0),
    tileHeight: word(1),
    tileWidth: word(2),
    originX: word(3),
    originY: word(4),
    tileStepX: word(5),
    tileStepY: word(6),
    rowStepX: word(7),
    rowStepY: word(8),
    rows,
    skip: Array.from({ length: rows }, (_, r) => word(10 + r)),
    count: Array.from({ length: rows }, (_, r) => word(30 + r)),
  };
}

export function patternCellCount(geometry: PatternGeometry): number {
  return geometry.count.reduce((sum, n) => sum + n, 0) * geometry.cellsPerTile;
}

export interface CellDef {
  /** Indice de la cellule (ligne, tuile, `j` dans l'ordre : 0 à `cellules - 1`). */
  index: number;
  /** Coin haut-gauche du rectangle de la tuile (le masque y est dessiné). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Id `SHAP` du masque 1 bit de la cellule. */
  maskId: number;
}

/** Cellules d'un motif, dans l'ordre de dessin et de parcours de la peinture (`1060:0e35`). */
export function layoutCells(geometry: PatternGeometry, pattern: number): CellDef[] {
  const base = PATTERN_MASK_BASE[pattern];
  if (base === undefined) throw new RangeError(`motif ${pattern} hors de 0 à ${PATTERN_COUNT - 1}`);
  const cells: CellDef[] = [];
  for (let r = 0; r < geometry.rows; r++) {
    for (let i = 0; i < geometry.count[r]!; i++) {
      const step = geometry.skip[r]! + i;
      const x = WINDOW_ORIGIN.x + geometry.originX + r * geometry.rowStepX + step * geometry.tileStepX;
      const y = WINDOW_ORIGIN.y + geometry.originY + r * geometry.rowStepY + step * geometry.tileStepY;
      for (let j = 0; j < geometry.cellsPerTile; j++) {
        cells.push({ index: cells.length, x, y, width: geometry.tileWidth, height: geometry.tileHeight, maskId: MASK_SHAPE_BASE + base + j });
      }
    }
  }
  return cells;
}

// --- Stockage du roster (pattern-windows.md §1.5) ---

/** Stockage d'un vitrail jamais touché : tout à `0x77`. */
export function blankStorage(): Uint8Array {
  return new Uint8Array(STORAGE_BYTES).fill(BLANK_BYTE);
}

/** Déplacement du motif `pattern` dans la version `version` du stockage. */
export function storageOffset(pattern: number, version: number): number {
  return version * VERSION_STRIDE + PATTERN_VERSION_OFFSETS[pattern]!;
}

/**
 * `bytes` (2 cellules par octet, quartet bas = cellule paire) → tampon de `MAX_CELLS` cellules. Les cellules au-delà des octets lus valent
 * `BLANK_COLOR`, comme un quartet hors de 0 à 14 (valeur qu'aucune écriture ne produit).
 */
export function unpackCells(bytes: Uint8Array): Uint8Array {
  const cells = new Uint8Array(MAX_CELLS).fill(BLANK_COLOR);
  const n = Math.min(bytes.length * 2, MAX_CELLS);
  for (let i = 0; i < n; i++) {
    const nibble = (i & 1) === 0 ? bytes[i >> 1]! & 0x0f : bytes[i >> 1]! >> 4;
    cells[i] = nibble < COLOR_COUNT ? nibble : BLANK_COLOR;
  }
  return cells;
}

/** Tampon de cellules → `byteCount` octets de stockage. */
export function packCells(cells: Uint8Array, byteCount: number): Uint8Array {
  const out = new Uint8Array(byteCount);
  for (let b = 0; b < byteCount; b++) out[b] = ((cells[2 * b] ?? BLANK_COLOR) & 0x0f) | (((cells[2 * b + 1] ?? BLANK_COLOR) & 0x0f) << 4);
  return out;
}

/** Cellules du motif `pattern`, version `version`. */
export function readStorage(storage: Uint8Array, pattern: number, version: number): Uint8Array {
  const at = storageOffset(pattern, version);
  return unpackCells(storage.subarray(at, at + PATTERN_STORAGE_BYTES[pattern]!));
}

/** Écrit tout le tampon dans le stockage (`1271(0)`). */
export function writeStorage(storage: Uint8Array, pattern: number, version: number, cells: Uint8Array): void {
  storage.set(packCells(cells, PATTERN_STORAGE_BYTES[pattern]!), storageOffset(pattern, version));
}

/** Met à jour le quartet d'une seule cellule (`1060:169c`, à chaque cellule peinte). */
export function writeStorageCell(storage: Uint8Array, pattern: number, version: number, cell: number, color: number): void {
  const at = storageOffset(pattern, version) + (cell >> 1);
  storage[at] = (cell & 1) === 0 ? (storage[at]! & 0xf0) | (color & 0x0f) : (storage[at]! & 0x0f) | ((color & 0x0f) << 4);
}

// --- Peinture (pattern-windows.md §1.4) ---

export interface PaintState {
  /** Tampon de travail (`DS:7053`) : une couleur 0 à 14 par cellule. */
  cells: Uint8Array;
  /** Instantané (`DS:725f`) : ce que l'effacement restaure. */
  snapshot: Uint8Array;
  /** `DS:20b4` : Yuck ! a échangé les tampons (le tampon courant est l'état annulé). */
  undoActive: boolean;
}

export function createPaintState(cells: Uint8Array = new Uint8Array(MAX_CELLS).fill(BLANK_COLOR)): PaintState {
  return { cells, snapshot: cells.slice(), undoActive: false };
}

/** `18c9(1)` : instantané ← tampon. */
export function takeSnapshot(state: PaintState): void {
  state.snapshot.set(state.cells);
}

/** Un geste de peinture : la première cellule touchée décide s'il peint (`mode` 0) ou s'il restaure l'instantané (`mode` 1). */
export interface Stroke {
  first: boolean;
  mode: 0 | 1;
}

export function beginStroke(state: PaintState): Stroke {
  if (state.undoActive) {
    state.undoActive = false;
    takeSnapshot(state);
  }
  return { first: true, mode: 0 };
}

/** Le point `(dx, dy)`, relatif au coin de la tuile de la cellule, est-il dans le masque de la cellule ? */
export type CellHit = (cell: CellDef, dx: number, dy: number) => boolean;

/**
 * Un sondage (`1060:0fe8`) au point `(x, y)` : parcourt les cellules dans l'ordre et s'arrête à la **première cellule modifiée**.
 * Une cellule touchée mais sans changement n'arrête pas le parcours (les rectangles des tuiles se chevauchent). Renvoie l'indice de la
 * cellule modifiée, ou -1.
 */
export function paintAt(state: PaintState, cells: readonly CellDef[], hit: CellHit, x: number, y: number, color: number, stroke: Stroke): number {
  for (const cell of cells) {
    const dx = x - cell.x;
    const dy = y - cell.y;
    if (dx < 0 || dy < 0 || dx >= cell.width || dy >= cell.height) continue;
    if (!hit(cell, dx, dy)) continue;
    const c = cell.index;
    if (stroke.first) {
      stroke.first = false;
      if (state.cells[c] === color) stroke.mode = 1;
    }
    if (stroke.mode === 0) {
      if (state.cells[c] === color) continue;
      state.cells[c] = color;
    } else {
      if (state.cells[c] === state.snapshot[c]) continue;
      state.cells[c] = state.snapshot[c]!;
    }
    return c;
  }
  return -1;
}

/**
 * Yuck ! (`008a` cas 7) : si le tampon et l'instantané diffèrent, bascule `undoActive` et les **échange**. Rend vrai si quelque chose a changé.
 * Deux appels de suite redonnent l'état de départ.
 */
export function toggleUndo(state: PaintState): boolean {
  let same = true;
  for (let i = 0; i < MAX_CELLS && same; i++) same = state.cells[i] === state.snapshot[i];
  if (same) return false;
  state.undoActive = !state.undoActive;
  const swap = state.cells.slice();
  state.cells.set(state.snapshot);
  state.snapshot.set(swap);
  return true;
}

// --- Robinet et outils cachés (pattern-windows.md §1.6) ---

export type FaucetMode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Rectangle du bouton Robinet `(453, 369, 482, 397)` et marge de 7 px des zones du clic (`008a` cas 5). */
const FAUCET = { left: 453, top: 369, right: 482, bottom: 397, margin: 7 } as const;

/** Mode du Robinet selon le point du clic dans le bouton (utile seulement quand Ctrl était enfoncé à l'entrée de la scène). */
export function faucetMode(x: number, y: number): FaucetMode {
  const notLeft = x - FAUCET.margin >= FAUCET.left;
  const notRight = x + FAUCET.margin <= FAUCET.right;
  if (y - FAUCET.margin < FAUCET.top) return !notLeft ? 1 : !notRight ? 2 : 4;
  if (FAUCET.bottom < y + FAUCET.margin) return !notLeft ? 3 : !notRight ? 5 : 6;
  return notLeft ? 0 : 7;
}

/** Tirage borné (`MsvcRandom` convient) : `range(lo, hi)` inclusif. */
export interface RangeRandom {
  range(lo: number, hi: number): number;
}

/**
 * Robinet (`1060:14eb`) sur les 524 cellules. Mode 0 : tout à `color`. Outils cachés : 1 / 2 rotation d'un cran vers le début / la fin,
 * 3 couleur la cellule de même rang dans chaque tuile, 4 couleurs aléatoires 0 à 14, 5 recopie la tuile de la dernière cellule peinte
 * partout, 6 inversion `c ← 14 - c`, 7 dégradé `i mod 15`. Les modes 3 et 5 ne font rien tant qu'aucune cellule n'a été peinte (`lastCell < 0`).
 */
export function applyFaucet(
  state: PaintState,
  mode: FaucetMode,
  color: number,
  lastCell: number,
  cellsPerTile: number,
  rng: RangeRandom,
): void {
  const cells = state.cells;
  switch (mode) {
    case 0:
      cells.fill(color);
      return;
    case 1: {
      const old = cells.slice();
      for (let i = 0; i < MAX_CELLS; i++) cells[i] = old[(i + 1) % MAX_CELLS]!;
      return;
    }
    case 2: {
      const old = cells.slice();
      for (let i = 0; i < MAX_CELLS; i++) cells[i] = old[(i + MAX_CELLS - 1) % MAX_CELLS]!;
      return;
    }
    case 3:
      if (lastCell < 0 || cellsPerTile <= 0) return;
      for (let i = lastCell % cellsPerTile; i < MAX_CELLS; i += cellsPerTile) cells[i] = color;
      return;
    case 4:
      for (let i = 0; i < MAX_CELLS; i++) cells[i] = rng.range(0, COLOR_COUNT - 1);
      return;
    case 5: {
      if (lastCell < 0 || cellsPerTile <= 0) return;
      const old = cells.slice();
      const start = lastCell - (lastCell % cellsPerTile);
      for (let i = 0; i < MAX_CELLS; i++) cells[i] = old[Math.min(MAX_CELLS - 1, start + (i % cellsPerTile))]!;
      return;
    }
    case 6:
      for (let i = 0; i < MAX_CELLS; i++) cells[i] = COLOR_COUNT - 1 - cells[i]!;
      return;
    case 7:
      for (let i = 0; i < MAX_CELLS; i++) cells[i] = i % COLOR_COUNT;
      return;
  }
}

// --- Image « variée » (compliment de Poly, `1060:1b2d`) ---

/**
 * Vrai si aucune couleur ne dépasse les deux tiers des cellules comptées : `min(2 × byteCount, 524)` cellules, seuil `⌊n / 3⌋ × 2`
 * (`byteCount` = octets de stockage du motif). Un compte égal au seuil reste « varié ».
 */
export function isColorful(cells: Uint8Array, byteCount: number): boolean {
  const n = Math.min(2 * byteCount, COLORFUL_MAX_CELLS);
  const threshold = Math.floor(n / 3) * 2;
  const counts = new Array<number>(COLOR_COUNT + 1).fill(0);
  for (let i = 0; i < n; i++) counts[Math.min(cells[i]!, COLOR_COUNT)]!++;
  return counts.every((count) => count <= threshold);
}

// --- Nom de fichier de l'impression ---

/** Nom du motif en minuscules ASCII, mots séparés par un tiret (« Turtle Shell » → « turtle-shell »). */
export function slugPatternName(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "motif" : slug;
}

/** `vitrail-<motif>.png`. */
export function printFileName(patternName: string): string {
  return `vitrail-${slugPatternName(patternName)}.png`;
}

// --- Image PNG de la fenêtre ---

/** Copie le rectangle `[left, right[ × [top, bottom[` d'une image indexée `width` de large. */
export function cropPixels(pixels: Uint8Array, width: number, left: number, top: number, right: number, bottom: number): Uint8Array {
  const w = right - left;
  const h = bottom - top;
  const out = new Uint8Array(w * h);
  for (let row = 0; row < h; row++) out.set(pixels.subarray((top + row) * width + left, (top + row) * width + right), row * w);
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, seed = 0): number {
  let c = ~seed >>> 0;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const v of bytes) {
    a = (a + v) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * PNG à palette (8 bits, type 3) : `paletteRgb` = 3 octets par entrée (au plus 256). Les données sont dans un flux zlib en blocs « stockés »
 * (sans compression : ~118 Ko pour 343 × 343), ce qui évite toute dépendance et reste synchrone.
 */
export function encodeIndexedPng(width: number, height: number, pixels: Uint8Array, paletteRgb: Uint8Array): Uint8Array {
  if (pixels.length !== width * height) throw new RangeError("PNG : taille des pixels incohérente");
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header[8] = 8; // profondeur
  header[9] = 3; // palette
  const raw = new Uint8Array(height * (width + 1));
  for (let row = 0; row < height; row++) raw.set(pixels.subarray(row * width, (row + 1) * width), row * (width + 1) + 1);
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const zlib = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  zlib[0] = 0x78;
  zlib[1] = 0x01;
  let at = 2;
  for (let b = 0; b < blocks; b++) {
    const part = raw.subarray(b * 65535, Math.min(raw.length, (b + 1) * 65535));
    zlib[at++] = b === blocks - 1 ? 1 : 0;
    zlib[at++] = part.length & 0xff;
    zlib[at++] = part.length >> 8;
    zlib[at++] = ~part.length & 0xff;
    zlib[at++] = (~part.length >> 8) & 0xff;
    zlib.set(part, at);
    at += part.length;
  }
  new DataView(zlib.buffer).setUint32(at, adler32(raw));
  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk("IHDR", header),
    chunk("PLTE", paletteRgb.subarray(0, 768)),
    chunk("IDAT", zlib),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}
