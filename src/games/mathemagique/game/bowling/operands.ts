/**
 * Opérandes d'un problème (`1010:1486`, screens/bowling.md §1.6 à §1.8) : fonction pure de (opération, sous-type, indice), sans aucun
 * tirage au hasard sauf le masque éparpillé de l'équivalence, déterministe par construction.
 */
import { contiguousMask, popcount, scatteredMask } from "./equivalence";
import type { EstimationTables } from "./estimation";
import {
  ADD,
  DIVIDE,
  DIVIDE_SMALL_DIVISORS,
  DIVIDE_SMALL_QUOTIENTS,
  DIVIDE_TABLE_0,
  DIVIDE_TABLE_1,
  DIVIDE_TABLE_5,
  EQUIVALENCE,
  ESTIMATION,
  MULTIPLY,
  PROBLEM_MAX,
  ROUND_NUMBERS,
  SUBTRACT,
  SUBTYPE_COUNTS,
} from "./tables";

/** Les quatre mots `e[0..3]` de l'original. */
export type OperandWords = [number, number, number, number];

export interface Operands {
  /**
   * `e` de `1010:1486`. + : opérandes (3 pour les sous-types 6 et 7). − : `a ≥ b`. × : facteurs (`e[2] = 1` par défaut).
   * ÷ : **diviseur, quotient** (la question affiche `d × q ÷ d`). = : voir `equivalenceOperands`. ≈ : unité, cible, catégorie, ordre de grandeur.
   */
  e: OperandWords;
  /** Masque de 24 cellules de la question d'équivalence (sous-types 10 à 12, `DS:4d10`) ; 0 sinon. */
  mask24: number;
}

/** `1010:20c1(A, D, B, N)` : `(N div D + B, N mod D + A)`. */
function split(a: number, d: number, b: number, n: number): [number, number] {
  return [Math.trunc(n / d) + b, (n % d) + a];
}

/** `1010:20ec` : premier triplet dont le seuil dépasse `n` ; `(x, n − seuil précédent + y)`. */
function searchTable(table: readonly (readonly [number, number, number])[], n: number): [number, number] {
  for (let i = 0; i < table.length; i++) {
    const [threshold, x, y] = table[i]!;
    if (threshold > n) return [x, n - (i > 0 ? table[i - 1]![0] : 0) + y];
  }
  throw new RangeError(`table de division : indice ${n} hors de la table`);
}

function additionOperands(subType: number, n: number): OperandWords {
  const e: OperandWords = [0, 0, 0, 0];
  switch (subType) {
    case 0:
      if (n < 36) [e[0], e[1]] = split(0, 6, 0, n);
      else e[0] = e[1] = n - 30;
      break;
    case 1:
      [e[0], e[1]] = split(6, 5, 0, n);
      break;
    case 2:
      [e[0], e[1]] = split(10, 10, 0, n);
      if (e[1] > 14) e[1] += 5;
      break;
    case 3:
      [e[0], e[1]] = split(30, 10, 0, n);
      if (e[1] > 34) e[1] += 5;
      break;
    case 4:
      [e[0], e[1]] = split(15, 10, 6, n);
      if (e[1] > 19) e[1] += 5;
      break;
    case 5:
      [e[0], e[1]] = split(15, 10, 11, n);
      if (e[1] > 19) e[1] += 5;
      break;
    case 6:
      [e[0], e[1]] = split(0, 16, 1, n);
      [e[1], e[2]] = split(0, 4, 5, e[1]);
      e[2] = e[2] * 2 + 3;
      break;
    case 7:
      [e[0], e[1]] = split(0, 16, 2, n);
      [e[1], e[2]] = split(10, 4, 6, e[1]);
      break;
    case 8: {
      // Débordement 16 bits de `N × 300` voulu (l'original multiplie sur un mot).
      const a = 500 + (((n * 300) & 0xffff) >> 8);
      const b = 100 + (Math.floor((n * 90000) / 256) % 300);
      [e[0], e[1]] = ((a ^ b) & 1) === 0 ? [b, a] : [a, b];
      break;
    }
    default:
      throw new RangeError(`addition : sous-type ${subType}`);
  }
  return e;
}

function subtractionOperands(subType: number, n: number): OperandWords {
  const e: OperandWords = [0, 0, 0, 0];
  switch (subType) {
    case 0:
      [e[0], e[1]] = split(0, 6, 0, n);
      break;
    case 1:
      if (n < 12) [e[0], e[1]] = split(6, 4, 0, n);
      else [e[0], e[1]] = [n - 12, 10];
      break;
    case 2:
      [e[0], e[1]] = split(6, 7, 6, n);
      break;
    case 3:
      [e[0], e[1]] = split(11, 14, 0, n);
      break;
    case 4:
      [e[0], e[1]] = split(0, 12, 2, n);
      e[1] = Math.trunc(e[1] / 4) + (e[1] % 4) * 10 + 17;
      break;
    case 5:
      [e[0], e[1]] = split(0, 15, 2, n);
      e[1] = Math.trunc(e[1] / 5) + (e[1] % 5) * 10 + 57;
      break;
    case 6:
      [e[0], e[1]] = split(0, 10, 3, n);
      if (e[0] > 5) e[0]++;
      e[1] = e[1] * 20 + 20;
      break;
    case 7:
      [e[0], e[1]] = split(0, 11, 3, n);
      if (e[0] > 5) e[0]++;
      e[1] = e[1] * 20 + 10;
      break;
    case 8:
      [e[0], e[1]] = split(0, 9, 11, n);
      if (e[0] > 14) e[0]++;
      e[1] = e[1] * 10 + 20;
      break;
    case 9:
      [e[0], e[1]] = split(0, 8, 11, n);
      if (e[0] > 14) e[0]++;
      e[1] = e[1] * 10 + 120;
      break;
    case 10:
      e[0] = 500 + (((n * 300) & 0xffff) >> 8);
      e[1] = 100 + (Math.floor((n * 90000) / 256) % 300);
      break;
    default:
      throw new RangeError(`soustraction : sous-type ${subType}`);
  }
  if (e[0] < e[1]) [e[0], e[1]] = [e[1], e[0]];
  return e;
}

function multiplicationOperands(subType: number, n: number): OperandWords {
  const e: OperandWords = [0, 0, 1, 0];
  switch (subType) {
    case 0:
      [e[0], e[1]] = split(0, 11, 0, n);
      if (e[0] === 2) e[0] = 10;
      break;
    case 1:
      [e[0], e[1]] = split(0, 11, 0, n);
      e[0] = e[0] === 0 ? 2 : 5;
      break;
    case 2:
      [e[0], e[1]] = split(0, 11, 3, n);
      if (e[0] > 4) e[0]++;
      break;
    case 3:
      [e[0], e[1]] = split(0, 13, 11, n);
      break;
    case 4:
      [e[0], e[1]] = split(0, 13, 6, n);
      break;
    case 5:
      [e[0], e[1]] = split(13, 12, 0, n);
      e[0] = ROUND_NUMBERS[e[0]]!;
      break;
    case 6:
      [e[0], e[1]] = split(0, 9, 3, n);
      e[1] = e[1] * 10 + 20;
      break;
    case 7:
      [e[0], e[1]] = split(0, 12, 0, n);
      e[0] = e[0] * 10 + 10;
      e[1] = e[1] * 10 + 10;
      break;
    case 8:
      [e[0], e[1]] = split(68, 32, 2, n);
      break;
    case 9:
      [e[0], e[1]] = split(0, 36, 2, n);
      [e[1], e[2]] = split(4, 6, 3, e[1]);
      break;
    default:
      throw new RangeError(`multiplication : sous-type ${subType}`);
  }
  return e;
}

function divisionOperands(subType: number, n: number): OperandWords {
  const e: OperandWords = [0, 0, 0, 0];
  switch (subType) {
    case 0:
      if (n < 8) [e[0], e[1]] = [DIVIDE_SMALL_DIVISORS[n]!, DIVIDE_SMALL_QUOTIENTS[n]!];
      else [e[0], e[1]] = searchTable(DIVIDE_TABLE_0, n);
      break;
    case 1:
      [e[0], e[1]] = searchTable(DIVIDE_TABLE_1, n);
      if (n > 6 && n < 14) e[1]++;
      break;
    case 2:
      [e[0], e[1]] = split(1, 12, 3, n);
      if (e[0] < 7) {
        e[0] = ROUND_NUMBERS[e[0] - 3]!;
        e[1] *= Math.trunc(100 / e[0]);
      } else if (e[0] > 9) e[0]++;
      break;
    case 3:
      [e[0], e[1]] = split(2, 19, 0, n);
      e[0] = ROUND_NUMBERS[1 + e[0]]!;
      e[1] *= Math.trunc(10 / e[0]);
      break;
    case 4:
      [e[0], e[1]] = split(1, 15, 0, n);
      e[0] = ROUND_NUMBERS[2 + e[0]]!;
      e[1] *= Math.trunc(50 / e[0]);
      break;
    case 5:
      [e[0], e[1]] = searchTable(DIVIDE_TABLE_5, n);
      break;
    case 6:
      [e[0], e[1]] = split(0, 64, 2, n);
      e[1] += Math.trunc((e[0] + 99) / e[0]);
      break;
    case 7:
      [e[0], e[1]] = split(0, 64, 6, n);
      e[1] += Math.trunc((e[0] + 99) / e[0]);
      break;
    default:
      throw new RangeError(`division : sous-type ${subType}`);
  }
  return e;
}

/** Nombre de cellules du masque de la question d'équivalence selon le sous-type : 8 (2 à 5), 12 (6 à 9), 24 (10 à 12) ; 0 pour les images (0, 1). */
export function equivalenceCells(subType: number): 0 | 8 | 12 | 24 {
  if (subType < 2) return 0;
  if (subType < 6) return 8;
  return subType < 10 ? 12 : 24;
}

function equivalenceOperands(subType: number, n: number): Operands {
  const e: OperandWords = [0, 0, 0, 0];
  let mask24 = 0;
  switch (subType) {
    case 0:
    case 1:
      e[0] = n;
      break;
    case 2:
      if (n < 24) {
        [e[1], e[2]] = split(0, 8, 0, n);
        e[1] = e[1] * 2 + 2;
      } else e[1] = 8 * n - 192;
      e[0] = contiguousMask(8, e[1], e[2]);
      break;
    case 3:
      if (n < 56) {
        [e[1], e[2]] = split(0, 8, 1, n);
        e[0] = contiguousMask(8, e[1], e[2]);
        e[2] = 1;
      } else if (n < 96) {
        [e[1], e[2]] = split(0, 8, 2, n - 56);
        e[0] = scatteredMask(8, e[1], e[2], subType);
        e[2] = 0;
      } else {
        e[1] = 8 * n - 768;
        e[0] = contiguousMask(8, e[1], e[2]);
      }
      break;
    case 4:
      if (n < 56) [e[1], e[2]] = split(0, 8, 1, n);
      else e[1] = 8 * n - 448;
      e[0] = contiguousMask(8, e[1], e[2]);
      break;
    case 5:
      e[0] = n;
      e[1] = popcount(8, n);
      break;
    case 6:
    case 7:
    case 8:
    case 9:
      [e[1], e[2]] = split(0, 12, 1, n);
      e[0] = scatteredMask(12, e[1], e[2], subType);
      break;
    case 10:
    case 11:
    case 12: {
      [e[0], e[1]] = split(0, 3, 0, n);
      let columns = 1;
      let sum = 0;
      while (e[0] > sum) {
        columns++;
        sum += columns;
      }
      e[1] = 24 - (columns * 3 - 3) - e[1];
      e[2] = (sum - e[0]) * 3;
      mask24 = subType === 12 ? scatteredMask(24, e[1], e[2], subType) : contiguousMask(24, e[1], e[2]);
      break;
    }
    default:
      throw new RangeError(`équivalence : sous-type ${subType}`);
  }
  return { e, mask24 };
}

/**
 * `1010:1486` : opérandes du problème `index` du sous-type `subType` (index plat dans les tables de l'opération) de l'opération `operation`.
 * L'estimation a besoin des tables construites depuis `UNIT`/`TARG` (`EstimationTables`).
 */
export function buildOperands(operation: number, subType: number, index: number, estimation?: EstimationTables): Operands {
  if (!Number.isInteger(operation) || operation < 0 || operation >= SUBTYPE_COUNTS.length) throw new RangeError(`opération ${operation} hors de 0 à 5`);
  if (!Number.isInteger(subType) || subType < 0 || subType >= SUBTYPE_COUNTS[operation]!) throw new RangeError(`sous-type ${subType} hors de 0 à ${SUBTYPE_COUNTS[operation]! - 1}`);
  const max = operation === ESTIMATION && estimation ? estimation.problemMax(subType) : PROBLEM_MAX[operation]![subType]!;
  if (!Number.isInteger(index) || index < 0 || index > max) throw new RangeError(`problème ${index} hors de 0 à ${max}`);
  switch (operation) {
    case ADD:
      return { e: additionOperands(subType, index), mask24: 0 };
    case SUBTRACT:
      return { e: subtractionOperands(subType, index), mask24: 0 };
    case MULTIPLY:
      return { e: multiplicationOperands(subType, index), mask24: 0 };
    case DIVIDE:
      return { e: divisionOperands(subType, index), mask24: 0 };
    case EQUIVALENCE:
      return equivalenceOperands(subType, index);
    default:
      if (!estimation) throw new Error("estimation : tables UNIT/TARG requises");
      return { e: estimation.operands(subType, index), mask24: 0 };
  }
}
