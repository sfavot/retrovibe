import type { RoomLimits, Scene, SceneZone } from "../data/scene";

/**
 * Terrain de marche d'une scène d'*Armaeth* : grille de cases par plan, hauteur du sol, collision avec le terrain
 * (`docs/armaeth/movement.md` § 1, § 2.3, § 3.4 ; `engine.md` § 7.1). Module pur : aucun accès au navigateur.
 *
 * Conventions : `colonne = X >> 2`, `rangée = P >> 3` ; X = centre du sprite, Y = pied (hauteur à l'écran), P = profondeur.
 */

export const GRID_COLUMNS = 81;
export const GRID_ROWS = 21;
/** Nombre de plans alloués (la grille est un tableau statique de trois plans, `DGROUP:0ef8`). */
export const MAX_PLANES = 3;
const GRID_RECORD_BYTES = 16;

/** Étendues maximales hors salle (`DGROUP:4acc`, `4ad2`, `4ad8`), minimum 0. */
export const MAX_X = 319;
export const MAX_Y = 199;
export const MAX_P = 255;

/** `Sol` : type de la case. 0 = rien, 1 = obstacle plein, >= 2 = sol praticable (`movement.md` § 1.1). */
export const GROUND_NONE = 0;
export const GROUND_WALL = 1;
export const GROUND_FLOOR = 2;

/** Intervalle vide (case non couverte). */
export const SPAN_EMPTY = 0xffff;

export function isWalkable(type: number): boolean {
  return type >= GROUND_FLOOR;
}

/**
 * Grille de marche : par plan, `GRID_ROWS` rangées de `GRID_COLUMNS` cases. `types` donne le type de case ; `spans` le mot
 * `(hi << 8) | lo` ou `SPAN_EMPTY`. Pour un sol (type >= 2) `lo` est la hauteur Y des pieds ; pour un type 1 `[lo, hi]` est
 * l'étendue verticale du mur. L'indexation est à plat (`(plan * 21 + rangée) * 81 + colonne`) : comme dans le moteur, une
 * case voisine hors de la rangée déborde sur la rangée suivante (les accès hors tableau valent « rien »).
 */
export interface WalkGrid {
  types: Uint8Array;
  spans: Uint16Array;
}

export function cellIndex(plane: number, row: number, col: number): number {
  return (plane * GRID_ROWS + row) * GRID_COLUMNS + col;
}

/** Type de la case d'indice `index` (0 hors tableau). */
export function typeAt(grid: WalkGrid, index: number): number {
  return grid.types[index] ?? GROUND_NONE;
}

/** Mot d'intervalle de la case d'indice `index` (`SPAN_EMPTY` hors tableau). */
export function spanAt(grid: WalkGrid, index: number): number {
  return grid.spans[index] ?? SPAN_EMPTY;
}

/** `lo` : hauteur Y du sol (ou bas du mur). */
export function lowAt(grid: WalkGrid, index: number): number {
  return spanAt(grid, index) & 0xff;
}

/** `hi` : haut de l'intervalle (179 pour un sol). */
export function highAt(grid: WalkGrid, index: number): number {
  return spanAt(grid, index) >> 8;
}

/**
 * Remplit la grille depuis les enregistrements de 16 octets de la scène (`1cc3:02b0..048a`, `movement.md` § 1.1) :
 * `{u8 type, u8 plan, s16 rangée, s16 c0, s16 hi0, s16 lo0, s16 c1, s16 hi1, s16 lo1}` ; pour `i` de 0 à `n - 1`
 * (`n = c1 - c0 + 1`) `hi` et `lo` sont interpolés linéairement (produit signé tronqué vers zéro), une seule case prend la moyenne.
 */
export function buildWalkGrid(records: Uint8Array): WalkGrid {
  const size = MAX_PLANES * GRID_ROWS * GRID_COLUMNS;
  const types = new Uint8Array(size);
  const spans = new Uint16Array(size).fill(SPAN_EMPTY);
  const view = new DataView(records.buffer, records.byteOffset, records.byteLength);
  for (let at = 0; at + GRID_RECORD_BYTES <= records.length; at += GRID_RECORD_BYTES) {
    const type = records[at];
    const plane = records[at + 1];
    const row = view.getInt16(at + 2, true);
    const c0 = view.getInt16(at + 4, true);
    const hi0 = view.getInt16(at + 6, true);
    const lo0 = view.getInt16(at + 8, true);
    const c1 = view.getInt16(at + 10, true);
    const hi1 = view.getInt16(at + 12, true);
    const lo1 = view.getInt16(at + 14, true);
    if (plane >= MAX_PLANES || row < 0 || row >= GRID_ROWS) continue;
    const n = c1 - c0 + 1;
    for (let i = 0; i < n; i++) {
      const col = c0 + i;
      if (col < 0 || col >= GRID_COLUMNS) continue;
      const hi = n === 1 ? (hi0 + hi1) >> 1 : hi0 + Math.trunc(((hi1 - hi0) * i) / n);
      const lo = n === 1 ? (lo0 + lo1) >> 1 : lo0 + Math.trunc(((lo1 - lo0) * i) / n);
      const index = cellIndex(plane, row, col);
      types[index] = type;
      spans[index] = ((hi & 0xff) << 8) | (lo & 0xff);
    }
  }
  return { types, spans };
}

/**
 * Hauteur du sol en un point, formule planaire de `1c96:0000` (`movement.md` § 2.3, validée sur les 59 objets posés de `CFG`) :
 * la pente en X est lue à la case voisine (+1 si praticable, sinon -1), celle en P à la rangée voisine, sans interpolation croisée.
 */
export function groundHeight(grid: WalkGrid, plane: number, x: number, p: number): number {
  const base = cellIndex(plane, p >> 3, x >> 2);
  const h0 = lowAt(grid, base);
  let result = h0;
  if (x & 3) {
    let d = 0;
    if (isWalkable(typeAt(grid, base + 1))) d = lowAt(grid, base + 1) - h0;
    else if (isWalkable(typeAt(grid, base - 1))) d = h0 - lowAt(grid, base - 1);
    result = h0 + (((x & 3) * d) >> 2);
  }
  if (p & 7) {
    let d = 0;
    if (isWalkable(typeAt(grid, base + GRID_COLUMNS))) d = lowAt(grid, base + GRID_COLUMNS) - h0;
    else if (isWalkable(typeAt(grid, base - GRID_COLUMNS))) d = h0 - lowAt(grid, base - GRID_COLUMNS);
    result += ((p & 7) * d) >> 3;
  }
  return result;
}

/** Hauteurs des quatre coins d'une case : `[(col, rangée), (col + 1, rangée), (col, rangée + 1), (col + 1, rangée + 1)]`. */
export type CellCorners = [number, number, number, number];

/**
 * Coins de la case pour le placement (`1b11:000c`, `movement.md` § 2.3 et § 4.3) : un voisin non praticable est remplacé par
 * l'extrapolation `2 * lo - lo(voisin opposé)` (ou `lo` s'il n'y a pas non plus de voisin opposé).
 */
export function cellCorners(grid: WalkGrid, plane: number, row: number, col: number): CellCorners {
  const base = cellIndex(plane, row, col);
  const a = lowAt(grid, base);
  const b = isWalkable(typeAt(grid, base + 1))
    ? lowAt(grid, base + 1)
    : isWalkable(typeAt(grid, base - 1))
      ? a * 2 - lowAt(grid, base - 1)
      : a;
  const c = isWalkable(typeAt(grid, base + GRID_COLUMNS))
    ? lowAt(grid, base + GRID_COLUMNS)
    : isWalkable(typeAt(grid, base - GRID_COLUMNS))
      ? a * 2 - lowAt(grid, base - GRID_COLUMNS)
      : a;
  const d = isWalkable(typeAt(grid, base + GRID_COLUMNS + 1)) ? lowAt(grid, base + GRID_COLUMNS + 1) : c;
  return [a, b, c, d];
}

/** Interpolation bilinéaire dans une case, à partir de ses coins (`x & 3`, `p & 7`). */
export function bilinearHeight(corners: CellCorners, x: number, p: number): number {
  const [a, b, c, d] = corners;
  const h1 = (((b - a) * (x & 3)) >> 2) + a;
  const h2 = (((d - c) * (x & 3)) >> 2) + c;
  return (((h2 - h1) * (p & 7)) >> 3) + h1;
}

/** Variante bilinéaire de la hauteur du sol, utilisée par la recherche de placement (diffère de 1 sur 0,8 % des points). */
export function placementHeight(grid: WalkGrid, plane: number, x: number, p: number): number {
  return bilinearHeight(cellCorners(grid, plane, p >> 3, x >> 2), x, p);
}

/** Permutation de 6 octets de l'en-tête (`DGROUP:4b88`) : identité si ce n'est pas une permutation de 0..5 (hypothèse, `graphics.md`). */
export function normalizePermutation(raw: readonly number[]): number[] {
  const valid = raw.length === 6 && new Set(raw).size === 6 && raw.every((v) => v >= 0 && v <= 5);
  return valid ? [...raw] : [0, 1, 2, 3, 4, 5];
}

/** Inverse de la permutation (`DGROUP:4b94`) : côté géométrique -> emplacement de sortie. */
export function invertPermutation(permutation: readonly number[]): number[] {
  const inverse: number[] = [];
  permutation.forEach((value, index) => {
    inverse[value] = index;
  });
  return inverse;
}

/** Une salle chargée : grille, limites, zones, nombre de plans actifs (`DGROUP:4ae0`) et permutation des côtés. */
export interface Terrain {
  grid: WalkGrid;
  limits: RoomLimits;
  zones: readonly SceneZone[];
  /** `DGROUP:4ae0` : plans actifs (1 à 3), ajusté par le scénario pour les salles 202 et 205 (`movement.md` § 1.1). */
  planes: number;
  /** `DGROUP:4b88` et `4b94`. */
  permutation: number[];
  inversePermutation: number[];
  /** Étendues horizontales par rangée (`DGROUP:4bac`), pour le masque de profondeur. */
  rowRanges: readonly { min: number; max: number }[];
}

/** Terrain d'une scène lue ; `planes` remplace le nombre de plans du fichier (`4ae0`). */
export function createTerrain(scene: Scene, planes: number = scene.header.planeCount): Terrain {
  const permutation = normalizePermutation(scene.header.permutation);
  return {
    grid: buildWalkGrid(scene.grid),
    limits: scene.header.limits,
    zones: scene.zones,
    planes: Math.min(planes, MAX_PLANES),
    permutation,
    inversePermutation: invertPermutation(permutation),
    rowRanges: scene.rowRanges,
  };
}

/** Ce que les collisions de terrain lisent d'un objet. */
export interface Footprint {
  x: number;
  y: number;
  p: number;
  /** `Dep` (+0x07). */
  dep: number;
  /** `Txt` (+0x08) : 2 = immatériel pour le terrain. */
  txt: number;
  /** `Hau` (+0x4C) et `Lar` (+0x4D). */
  height: number;
  width: number;
}

export interface TerrainHit {
  /** 0 libre, 1 obstacle plein, 2 case refusée à un voleur, 4 masque de profondeur. */
  code: number;
  /** Type de la case qui bloque (`Inf`), 0 sinon. */
  info: number;
}

/** Vrai si l'objet est un voleur (`Dep` 1 ou 3). */
export function isFlyer(dep: number): boolean {
  return dep === 1 || dep === 3;
}

/**
 * Test du masque de profondeur (couche B de la scène, `movement.md` § 3.2) : seulement si `P & 7 == 0`, `Txt == 0` et si la boîte
 * horizontale du sprite recoupe l'étendue de la rangée (`DGROUP:4bac`) ; le test lui-même (pilote vidéo, non porté) est fourni.
 */
export function depthMaskHit(terrain: Terrain, body: Footprint, depthBlocked?: (body: Footprint) => boolean): boolean {
  if (!depthBlocked || (body.p & 7) !== 0 || body.txt !== 0) return false;
  const range = terrain.rowRanges[body.p >> 3];
  const left = body.x - (body.width >> 1);
  return !!range && left <= range.max && left + body.width - 1 >= range.min && depthBlocked(body);
}

/**
 * Collision avec le terrain, `1c96:0102` (`movement.md` § 3.4). Cases de `max(gauche, Xmin) >> 2` à
 * `min(gauche + Lar - 1, Xmax) >> 2` à la rangée de P, plans du dernier au premier ; une case bloque si elle est définie,
 * recouvre la hauteur de l'objet et (type 1 ou `hi < Y`) ; pour un voleur toute case qui recouvre bloque (résultat 2).
 * Sans blocage : masque de profondeur (`depthBlocked`, non porté ici : fourni par l'appelant) si `P & 7 == 0` et `Txt == 0`.
 */
export function terrainCollision(
  terrain: Terrain,
  body: Footprint,
  depthBlocked?: (body: Footprint) => boolean,
): TerrainHit {
  if (body.txt === 2) return { code: 0, info: 0 };
  const { grid, limits } = terrain;
  const left = body.x - (body.width >> 1);
  const first = Math.max(left, limits.xMin) >> 2;
  const last = Math.min(left + body.width - 1, limits.xMax) >> 2;
  const row = body.p >> 3;
  const flyer = isFlyer(body.dep);
  for (let col = first; col <= last; col++) {
    for (let plane = terrain.planes - 1; plane >= 0; plane--) {
      const index = cellIndex(plane, row, col);
      const span = spanAt(grid, index);
      if (span === SPAN_EMPTY) continue;
      const lo = span & 0xff;
      const hi = span >> 8;
      if (!(lo <= body.y && body.y - (body.height - 1) <= hi)) continue;
      const type = typeAt(grid, index);
      if (flyer) return { code: 2, info: type };
      if (type === GROUND_WALL || hi < body.y) return { code: 1, info: type };
    }
  }
  if (depthMaskHit(terrain, body, depthBlocked)) return { code: 4, info: 0 };
  return { code: 0, info: 0 };
}
