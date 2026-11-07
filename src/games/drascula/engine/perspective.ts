import type { AldRect } from "../data/ald";
import { CHARACTER_HEIGHT, CHARACTER_WIDTH } from "./state";

/**
 * Perspective : facteur de réduction du héros selon l'ordonnée de ses pieds (`factor_red`), d'après `enterRoom`
 * (engines/drascula/rooms.cpp, ScummVM). Hors chapitre 2, la fiche donne deux limites (pourcentages) : la limite haute
 * s'applique au-dessus de la zone de marche, la basse en dessous, et le facteur varie linéairement entre les deux sur la hauteur
 * de la zone. Le chapitre 2 n'a pas de perspective (taille fixe par pièce).
 *
 * Fidélité : les calculs de ScummVM sont en `float` 32 bits puis tronqués (`(int)`) ; on les refait avec `Math.fround`.
 * Les deux prolongements au-dessus de la zone (pièce 24, et pièce 54 au chapitre 5) continuent l'accumulation du premier
 * passage, comme dans ScummVM.
 */

/** Taille du tableau `factor_red[202]` : ordonnées 0 à 201. */
export const FACTOR_TABLE_SIZE = 202;

const f32 = Math.fround;

export function buildFactors(walk: AldRect, limits: { upper: number; lower: number }, room: number, chapter: number): number[] {
  const { upper, lower } = limits;
  const factors = new Array<number>(FACTOR_TABLE_SIZE).fill(0);
  for (let y = 0; y <= walk.y1 && y < FACTOR_TABLE_SIZE; y++) factors[y] = upper;
  for (let y = Math.max(walk.y1, 0); y < FACTOR_TABLE_SIZE; y++) factors[y] = lower;

  const slope = f32(f32(lower - upper) / f32(walk.y2 - walk.y1));
  let offset = 0;
  for (let y = walk.y1; y <= walk.y2; y++) {
    if (y >= 0 && y < FACTOR_TABLE_SIZE) factors[y] = Math.trunc(f32(upper + offset));
    offset = f32(offset + slope);
  }

  // Pièces où le héros monte au-dessus de la zone de marche (escaliers) : la réduction continue vers le haut.
  const extendTo = room === 24 ? 74 : chapter === 5 && room === 54 ? 84 : null;
  if (extendTo !== null) {
    for (let y = walk.y1 - 1; y > extendTo; y--) {
      if (y >= 0 && y < FACTOR_TABLE_SIZE) factors[y] = Math.trunc(f32(upper - offset));
      offset = f32(offset + slope);
    }
  }
  return factors;
}

/**
 * Facteur à l'ordonnée `y`. ScummVM lit `factor_red[y]` sans borne (hors tableau : comportement indéfini) ; on borne à 0..201.
 */
export function factorAt(factors: readonly number[], y: number): number {
  return factors[Math.min(Math.max(Math.trunc(y), 0), FACTOR_TABLE_SIZE - 1)];
}

/** Taille du héros réduit par un facteur (division entière, comme `(CHARACTER_HEIGHT * factor) / 100`). */
export function scaledSize(factor: number): { width: number; height: number } {
  return { width: Math.trunc((CHARACTER_WIDTH * factor) / 100), height: Math.trunc((CHARACTER_HEIGHT * factor) / 100) };
}
