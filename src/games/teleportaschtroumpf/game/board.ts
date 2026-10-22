import type { BorlandRandom } from "../engine/rng";
import {
  ARRIVALS,
  ARRIVE_FROM_RIGHT_X,
  DOORS,
  DOOR_CLASSES,
  DOOR_ZONES,
  EDGE_RIGHT,
  START_X,
  type DoorClass,
  type Position,
  type Row,
} from "./tables";

/** Zone (0 gauche, 1 centre, 2 droite) d'une abscisse pour l'indice d'action : `291e:1536` (`x < 0x6B`, `< 0xD4`). */
export function zoneOf(x: number): 0 | 1 | 2 {
  if (x < 0x6b) return 0;
  if (x < 0xd4) return 1;
  return 2;
}

/**
 * Bords d'une zone : quand un clic tombe sur une ligne de séparation (`x = 0x6B` ou `0xD4`) ou hors des zones
 * (`x < 7`, `x > 0x13A`), l'original pousse d'abord le pion hors de la ligne (`2813:0886`, `0728..0840`) selon
 * son regard. Renvoie l'abscisse corrigée.
 */
export function settleX(x: number, facingRight: boolean): number {
  if (x < 7) return START_X;
  if (x > 0x13a) return ARRIVE_FROM_RIGHT_X;
  if (x === 0x6b) return facingRight ? 0x70 : 0x66;
  if (x === 0xd4) return facingRight ? 0xd9 : 0xcf;
  return x;
}

/** Porte devant le pion (`2813:000d`) : code de scène (voir `DOORS`) ou `null` (`0xFFFF`) hors zone ou sans porte. */
export function doorAt(screen: number, row: Row, x: number): number | null {
  const doors = DOORS[screen - 1]?.[row];
  if (!doors) return null;
  for (let z = 0; z < 3; z++) {
    const zone = DOOR_ZONES[z];
    if (x >= zone.min && x <= zone.max) return doors[z];
  }
  return null;
}

/** Classe de la zone pour le bouton (table `291e:11f4`). */
export function doorClassAt(screen: number, row: Row, x: number): DoorClass {
  const index = (screen - 1) * 6 + (row === "bottom" ? 3 : 0) + zoneOf(x);
  return DOOR_CLASSES[index] ?? "door";
}

export interface EdgeResult {
  position: Position;
  /** Vrai si le pion a changé d'écran ou de rangée. */
  crossed: boolean;
  /** Sortie du plateau (`291e:13f2` renvoie 1 ou `0x13E`, codes 100 et 101). */
  exit?: "left" | "right";
}

/**
 * Passage de bord du plateau (`291e:13f2`). Le plateau est un seul chemin de 18 segments : écran 1 haut, écran 1
 * bas, écran 2 haut, … écran 9 bas. Quitter une rangée par la droite mène au début de la suivante ; par la gauche, à la
 * fin de la précédente (rangée haute → rangée basse de l'écran précédent ; rangée basse → rangée haute du même écran).
 */
export function resolveEdges(pos: Position): EdgeResult {
  const { screen, row, x } = pos;
  if (x < 1) {
    if (row === "top") {
      if (screen < 2) return { position: { screen: 1, row: "top", x: START_X }, crossed: false, exit: "left" };
      return { position: { screen: screen - 1, row: "bottom", x: ARRIVE_FROM_RIGHT_X }, crossed: true };
    }
    return { position: { screen, row: "top", x: ARRIVE_FROM_RIGHT_X }, crossed: true };
  }
  if (x > EDGE_RIGHT) {
    if (row === "top") return { position: { screen, row: "bottom", x: START_X }, crossed: true };
    if (screen < 9) return { position: { screen: screen + 1, row: "top", x: START_X }, crossed: true };
    return { position: { screen: 9, row: "bottom", x: ARRIVE_FROM_RIGHT_X }, crossed: false, exit: "right" };
  }
  return { position: pos, crossed: false };
}

/** Position d'arrivée après une téléportation aléatoire vers `screen` (`2a78:13c1`). */
export function arrival(screen: number, rng: BorlandRandom): Position {
  const spec = ARRIVALS[screen - 1];
  const choice = spec.length === 1 ? spec[0] : spec[rng.below(spec.length)];
  const pick = choice.xs.length === 1 ? choice.xs[0] : choice.xs[rng.below(choice.xs.length)];
  const x = typeof pick === "number" ? pick : pick[0] + rng.below(pick[1] - pick[0] + 1);
  return { screen, row: choice.row, x };
}
