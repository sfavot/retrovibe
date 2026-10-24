/**
 * Tables constantes du Bowling (screens/bowling.md §1.4, §1.6, §1.7), copiées du segment de données du NE `MATH`
 * (`DS = 1108`) ; on ne relit jamais l'exécutable à l'exécution. Module pur.
 */

/** Opérations, dans l'ordre des boutons et des colonnes du roster : + − × ÷ = ≈. */
export const ADD = 0;
export const SUBTRACT = 1;
export const MULTIPLY = 2;
export const DIVIDE = 3;
export const EQUIVALENCE = 4;
export const ESTIMATION = 5;

/** Niveaux 0 à 3 (LEVEL 1 à 4) puis 4 = BONUS ROUND. */
export const BONUS = 4;
export const LEVEL_COUNT = 4;

/** Nombre de réponses affichées par problème. */
export const CHOICE_COUNT = 4;
/** Une réponse affichée ne dépasse jamais cette valeur (`1010:108d`, test signé sur 16 bits). */
export const MAX_DISPLAYED_ANSWER = 19999;
/** Bonnes réponses d'une partie pour un strike, strikes d'un niveau pour le terminer. */
export const CORRECT_PER_STRIKE = 10;
export const STRIKES_PER_LEVEL = 10;

/** `BONUS_N` (`1108:0436`) : nombre de sous-types de chaque opération, tous niveaux confondus (le bonus en tire un au hasard). */
export const SUBTYPE_COUNTS: readonly number[] = [9, 11, 10, 8, 13, 4];

/**
 * Seuils de strikes par opération (`1108:043c…`, `1108:0479 + 4·op`) : `STRIKE_THRESHOLDS[op][sous-type]` est le nombre de strikes
 * du niveau auquel on passe au sous-type suivant ; la valeur 10 clôt un niveau (le bonus a son propre 10 en fin de liste).
 */
export const STRIKE_THRESHOLDS: readonly (readonly number[])[] = [
  [5, 10, 5, 10, 5, 10, 3, 6, 10, 10],
  [2, 4, 6, 10, 5, 10, 5, 10, 3, 6, 10, 10],
  [3, 5, 10, 2, 10, 4, 10, 4, 7, 10, 10],
  [5, 10, 10, 5, 10, 4, 7, 10, 10],
  [5, 10, 3, 6, 8, 10, 2, 4, 7, 10, 3, 6, 10, 10],
  [10, 10, 10, 10, 10],
];

/**
 * Plus grand indice de problème de chaque sous-type (`1108:0491…04c4`, `1108:04c8 + 4·op`) : le sous-type compte `valeur + 1`
 * problèmes. L'estimation (dernière ligne) est calculée à l'entrée depuis `UNIT`/`TARG` (`EstimationTables.problemMax`) ;
 * ici, la valeur de repli du segment.
 */
export const PROBLEM_MAX: readonly (readonly number[])[] = [
  [40, 54, 59, 59, 49, 49, 63, 63, 255],
  [35, 17, 34, 41, 59, 59, 59, 65, 71, 63, 255],
  [32, 21, 65, 25, 90, 47, 71, 143, 255, 215],
  [47, 48, 107, 56, 44, 82, 255, 255],
  [35, 35, 25, 97, 57, 255, 143, 143, 143, 143, 107, 107, 107],
  [191, 191, 191, 191],
];

/** Table d'octets `1108:0a66` : 1, 2, 5, 10, 50 (diviseurs et facteurs ronds de × et ÷). */
export const ROUND_NUMBERS: readonly number[] = [1, 2, 5, 10, 50];
/** `1108:0a6b` et `1108:0a73` : diviseurs et quotients de ÷ sous-type 0, indices 0 à 7. */
export const DIVIDE_SMALL_DIVISORS: readonly number[] = [2, 4, 8, 2, 3, 6, 3, 9];
export const DIVIDE_SMALL_QUOTIENTS: readonly number[] = [4, 2, 1, 3, 2, 1, 3, 1];
/**
 * Tables de triplets `(seuil, x, y)` de `Search20ec` (`1010:20ec`) : `0xA2D` (÷ sous-type 0), `0xA3C` (sous-type 1) et `0xA51` (sous-type 5).
 * Le premier triplet de `0xA3C` et `0xA51` est `(0, 0, 0)`.
 */
export const DIVIDE_TABLE_0: readonly (readonly [number, number, number])[] = [
  [8, 0, 0],
  [21, 1, 0],
  [28, 2, 0],
  [38, 5, 1],
  [48, 10, 1],
];
export const DIVIDE_TABLE_1: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [5, 2, 6],
  [14, 3, 1],
  [24, 4, 1],
  [29, 5, 6],
  [39, 6, 1],
  [49, 10, 1],
];
export const DIVIDE_TABLE_5: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [37, 2, 13],
  [58, 3, 13],
  [70, 4, 13],
  [77, 5, 13],
  [81, 6, 13],
  [83, 7, 13],
];

/** Bandes des 36 images de pizza (`1108:0a7b`) : `[b[i], b[i+1][`. 0 = assiette vide, 1 à 7 entières, 8 à 21 moitiés, 22 à 29 quarts, 30 à 35 tiers. */
export const IMAGE_BANDS: readonly number[] = [0, 1, 8, 22, 26, 30, 33, 36];
export const IMAGE_COUNT = 36;

/** Multiplicateurs d'ordre de grandeur des distracteurs d'estimation (`1108:033a`), par catégorie longueur / durée / poids. */
export const ORDER_MULTIPLIERS: readonly number[] = [4, 6, 4];
/** Bornes des 4 bandes d'estimation en multiples de l'unité (`1108:0ab3`, `1108:0abb`). */
export const BAND_LOW: readonly number[] = [1, 5, 20, 20];
export const BAND_HIGH: readonly number[] = [20, 50, 100, 9999];

/** Ids `STRL`/`UNIT`/`TARG` de `BOWLING.DAT` (screens/bowling.md §3). */
export const STRL_UNITS_BASE = 1000;
export const STRL_TARGETS_BASE = 1005;
export const STRL_RANKS = 5000;
