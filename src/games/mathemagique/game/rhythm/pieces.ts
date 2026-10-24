/**
 * Pièces du Rhythm Shop (rhythm.md §1.2) : tailles valides, fractions, sprites et géométrie des trois bacs. Pur.
 *
 * Unité interne : 1/144 de mesure. Une valeur `v > 0` est une pièce de taille `v`, `v < 0` un fantôme (emplacement vide de forme `-v`),
 * `0` termine le tableau. Un bac fait 24 mots au plus.
 */

/** Une mesure entière, en unités. */
export const MEASURE = 144;
/** Nombre de cases d'un bac (tableaux de 24 mots signés). */
export const SLOT_COUNT = 24;

/** Les 30 tailles qui ont un sprite (`1038:05d5`), dans l'ordre des sprites : `SHAP` `30000 + indice - 1`, indice 2 à 31 (`1038:0698`). */
export const PIECE_SIZES: readonly number[] = [
  144, 72, 48, 96, 36, 108, 24, 120, 18, 54, 90, 126, 16, 32, 64, 80, 112, 128, 12, 60, 84, 132, 9, 27, 45, 63, 81, 99, 117, 135,
];

const SPRITE_OF_SIZE = new Map(PIECE_SIZES.map((size, i) => [size, i + 2]));

export function isValidSize(size: number): boolean {
  return SPRITE_OF_SIZE.has(size);
}

/** Indice de sprite (2 à 31) d'une taille, 0 si elle n'en a pas (rien n'est dessiné). */
export function spriteIndex(size: number): number {
  return SPRITE_OF_SIZE.get(size) ?? 0;
}

/** Les fantômes utilisent le sprite de la pièce + 30 (vert vif). */
export function ghostSpriteIndex(size: number): number {
  const index = spriteIndex(size);
  return index === 0 ? 0 : index + 30;
}

/** Id `SHAP` de `RHYTHM.DAT` d'une pièce (`SHPL` 30000), 0 si la taille n'a pas de sprite. */
export function pieceShapeId(size: number): number {
  const index = spriteIndex(size);
  return index === 0 ? 0 : 30000 + index - 1;
}

/** Id `SHAP` du fantôme de cette taille, 0 si absent. */
export function ghostShapeId(size: number): number {
  const index = ghostSpriteIndex(size);
  return index === 0 ? 0 : 30000 + index - 1;
}

export interface Fraction {
  num: number;
  den: number;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Fraction réduite de la mesure : 54 → 3/8, 16 → 1/9, 144 → 1/1. */
export function reduceFraction(size: number): Fraction {
  const g = gcd(Math.abs(size), MEASURE);
  return { num: size / g, den: MEASURE / g };
}

/** `3/8` (texte de la recette Teletune). */
export function fractionText(size: number): string {
  const { num, den } = reduceFraction(size);
  return `${num}/${den}`;
}

// --- Outils ---

/** Outil d'un bouton (`PLST` : `kind` 2 = Cutter, 3 = Gluer si `param < 2` sinon Melder). */
export type Tool =
  /** Coupe la pièce du Fractionator en `n` parts égales. */
  | { kind: "cut"; n: number }
  /** Colle au moins deux pièces de taille `size`. */
  | { kind: "glue"; size: number }
  /** Fusionne des pièces quelconques en une pièce de taille `target`. */
  | { kind: "meld"; target: number };

/** Nombre de boutons d'outils : 3 Cutter (0-2), 3 Gluer (3-5), 3 Melder (6-8). */
export const TOOL_BUTTONS = 9;

// --- Bacs ---

export type BinId = "parts" | "pattern" | "fractionator";

/** Rectangles des bacs `(gauche, haut, droite, bas)` (`DS:1560`, `1574`, `1588`). */
export const BIN_EDGES: Readonly<Record<BinId, readonly [number, number, number, number]>> = {
  parts: [205, 231, 496, 274],
  pattern: [205, 305, 496, 348],
  fractionator: [194, 148, 485, 191],
};

export function binContains(bin: BinId, x: number, y: number): boolean {
  const [left, top, right, bottom] = BIN_EDGES[bin];
  return x >= left && x < right && y >= top && y < bottom;
}

/** Hauteur d'une pièce dessinée. */
export const PIECE_HEIGHT = 43;

/**
 * Position horizontale en unités de la souris dans un bac (`1038:0602`) : `((x - gauche) × 288 / (largeur - 4)) / 2`, divisions entières de C.
 * Divisions de C (vers zéro) : un point juste à gauche du bac donne 0 comme un point à son bord.
 */
export function unitAt(bin: BinId, x: number): number {
  const [left, , right] = BIN_EDGES[bin];
  return Math.trunc(Math.trunc(((x - left) * 288) / (right - left - 4)) / 2) || 0;
}

/**
 * Indice de la pièce (ou du fantôme) sous l'abscisse `x` : premier emplacement dont la somme cumulée des tailles (en valeur absolue) dépasse la position.
 * -1 hors du bac, sur du vide ou après la dernière pièce.
 */
export function pieceIndexAt(bin: BinId, words: readonly number[], x: number): number {
  const [left, , right] = BIN_EDGES[bin];
  if (x < left || x >= right) return -1;
  const position = unitAt(bin, x);
  let cumulative = 0;
  for (let i = 0; i < Math.min(words.length, SLOT_COUNT); i++) {
    const size = Math.abs(words[i]!);
    if (size === 0) return -1;
    cumulative += size;
    if (position < cumulative) return i;
  }
  return -1;
}

/** Abscisse et largeur (pixels) de la pièce `index` d'un bac (`1058:0592`) : `gauche + 2 + 2 × somme des tailles précédentes`, largeur `2 × taille`. */
export function pieceSpan(bin: BinId, words: readonly number[], index: number): { x: number; w: number } {
  let before = 0;
  for (let i = 0; i < index; i++) before += Math.abs(words[i] ?? 0);
  return { x: BIN_EDGES[bin][0] + 2 + 2 * before, w: 2 * Math.abs(words[index] ?? 0) };
}
