import { MAP_CELLS, MAP_LOCATIONS } from "../../game/tables";

/**
 * Géométrie et tables de la carte S02 (`1a3c:0225`, `docs/teleportaschtroumpf/screens-map.md`). Pur : pas de dessin ici.
 */

/** Fenêtre de la carte dans l'écran : lignes 6 à 175 (`317b:01b9(6, 0xAA)`), le reste est le cadre du fond MCG. */
export const VIEW_TOP = 6;
export const VIEW_ROWS = 170;

/** Hauteur du fond défilant : 170 + 148 + 163 lignes lues dans `s02a004d`, `005d` et `006d` (`lseek` 0xA82, 0x2602, 0x1342). */
export const MAP_ROWS = 481;
/** Décalage maximal de la fenêtre (0x137 = 311 ; 311 + 170 = 481). */
export const SCROLL_MAX = 0x137;
/** Pas du défilement en consultation (pixels par image tant que haut / bas est tenu). */
export const SCROLL_STEP = 5;

/** Morceaux du fond défilant : fichier, première ligne lue dans le MCG, nombre de lignes (empilés dans cet ordre). */
export const MAP_SEGMENTS: readonly { file: string; firstRow: number; rows: number }[] = [
  { file: "s02a004d.mcg", firstRow: 6, rows: 170 },
  { file: "s02a005d.mcg", firstRow: 28, rows: 148 },
  { file: "s02a006d.mcg", firstRow: 13, rows: 163 },
];

/** Lieux `k` de la sélection : 1 = retour, 2..18 = les 17 mini-jeux. */
export const K_BACK = 1;
export const K_FIRST_LOCATION = 2;
export const K_LAST = 18;

/** Case de la carte du lieu `k` (`DS:15BA[k]`) : la 1 pour « retour » (point de départ, en bas à gauche). */
const BACK_CELL = 1;

export function cellOfK(k: number): number {
  if (k === K_BACK) return BACK_CELL;
  const location = MAP_LOCATIONS.find((l) => l.k === k);
  if (!location) throw new RangeError(`lieu de la carte invalide : ${k}`);
  return location.cell;
}

/** Scène (mini-jeu) du lieu `k` (`CS:1a3c:0203`, aussi la table de voix d'aide `DS:15E0`) ; `undefined` pour le retour. */
export function sceneOfK(k: number): number | undefined {
  return MAP_LOCATIONS.find((l) => l.k === k)?.scene;
}

/** Position du marqueur (le Schtroumpf de la carte) : bord gauche, ligne du bas sur le fond défilant, sprite 0 ou 1 de `s02a000s.hy8`. */
export interface Marker {
  x: number;
  footY: number;
  sprite: number;
}

/**
 * Marqueur d'une case de `DS:1470` : `31fe:0481(sprite, x − 0x1E, 0x31)` est dessiné dans une bande de 50 lignes qui démarre à
 * la ligne `y − 0x45` du fond, soit une ligne du bas à `y − 0x45 + 0x31 = y − 20`. Une case hors table (zone 54 du pion) lit la
 * dernière ligne de `DS:1470`, identique à la case 53 (la mine).
 */
export function markerOfCell(cell: number): Marker {
  const [x, y, sprite] = MAP_CELLS[Math.min(Math.max(cell, 0), MAP_CELLS.length - 1)];
  return { x: x - 0x1e, footY: y - 20, sprite };
}

/** Décalage de la fenêtre pour montrer le lieu `k` (`1a3c:0225`) : bas de la carte jusqu'au lieu 4, centré ensuite, haut pour 17 et 18. */
export function scrollOfK(k: number): number {
  if (k < 5) return SCROLL_MAX;
  if (k < 0x11) return MAP_CELLS[cellOfK(k)][1] - 0x78;
  return 0;
}

/**
 * Sélection après un appui « haut » (`+1`) ou « bas » (`−1`) : bornée à `[min, 18]`, `min` = 1 en mode libre, 2 pour le puits
 * (pas de retour). Un appui contre la borne ne change rien (et n'émet pas de bip).
 */
export function moveSelection(k: number, delta: 1 | -1, min: number): number {
  return Math.min(K_LAST, Math.max(min, k + delta));
}

/** Défilement après `delta` pixels, borné à `[0, SCROLL_MAX]`. */
export function scrolled(scroll: number, delta: number): number {
  return Math.min(SCROLL_MAX, Math.max(0, scroll + delta));
}

/**
 * Ajout du port pour le doigt : un lieu se touche le long d'un segment qui va du centre du marqueur (le Schtroumpf posé à côté du
 * lieu) à la case elle-même (sur le chemin, au pied de l'objet du lieu), coordonnées du fond défilant. L'original n'a que le clavier.
 */
export interface LocationAnchor {
  k: number;
  /** Centre du marqueur du lieu. */
  mx: number;
  my: number;
  /** Case de `DS:1470`. */
  cx: number;
  cy: number;
}

/**
 * Distance (pixels) au-delà de laquelle un toucher ne désigne aucun lieu. Assez large pour l'objet dessiné du lieu (la guitare
 * du musicien est à ~25 px du marqueur), le lieu le plus proche l'emporte.
 */
export const TOUCH_RADIUS = 36;

/**
 * Ancres des lieux `k` = 1..18 ; `markerBounds(sprite)` = rectangle du sprite du marqueur autour de son ancre (bord gauche, ligne
 * du bas).
 */
export function locationAnchors(markerBounds: (sprite: number) => { minX: number; minY: number; maxX: number; maxY: number }): LocationAnchor[] {
  const anchors: LocationAnchor[] = [];
  for (let k = K_BACK; k <= K_LAST; k++) {
    const cell = cellOfK(k);
    const marker = markerOfCell(cell);
    const b = markerBounds(marker.sprite);
    const [cx, cy] = MAP_CELLS[cell];
    anchors.push({ k, mx: marker.x + (b.minX + b.maxX) / 2, my: marker.footY + (b.minY + b.maxY) / 2, cx, cy });
  }
  return anchors;
}

/** Lieu (≥ `min`) le plus proche du point (x, y) du fond défilant, à moins de `TOUCH_RADIUS` ; `null` sinon. */
export function locationAt(anchors: readonly LocationAnchor[], x: number, y: number, min: number): number | null {
  let best: number | null = null;
  let bestDistance = TOUCH_RADIUS;
  for (const a of anchors) {
    if (a.k < min) continue;
    const distance = segmentDistance(x, y, a.mx, a.my, a.cx, a.cy);
    if (distance <= bestDistance) {
      best = a.k;
      bestDistance = distance;
    }
  }
  return best;
}

function segmentDistance(x: number, y: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.min(1, Math.max(0, ((x - x0) * dx + (y - y0) * dy) / length));
  return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
}
