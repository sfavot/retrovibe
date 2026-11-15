export interface Point {
  x: number;
  y: number;
}

export const pt = (x: number, y: number): Point => ({ x, y });

export const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

export const addPoint = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });

/** Signe composante par composante de (target − origin) : direction unitaire vers la cible. */
export const directionTo = (origin: Point, target: Point): Point => ({
  x: Math.sign(target.x - origin.x),
  y: Math.sign(target.y - origin.y),
});

export const chebyshev = (a: Point, b: Point): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export enum Direction {
  Up,
  Down,
  Left,
  Right,
}

export const DIRECTION_VECTORS: Record<Direction, Point> = {
  [Direction.Up]: { x: 0, y: -1 },
  [Direction.Down]: { x: 0, y: 1 },
  [Direction.Left]: { x: -1, y: 0 },
  [Direction.Right]: { x: 1, y: 0 },
};

/** Direction cardinale dominante d'un vecteur (vertical prioritaire en cas de diagonale). */
export function directionOf(v: Point, fallback: Direction = Direction.Down): Direction {
  if (v.y < 0) return Direction.Up;
  if (v.y > 0) return Direction.Down;
  if (v.x < 0) return Direction.Left;
  if (v.x > 0) return Direction.Right;
  return fallback;
}
