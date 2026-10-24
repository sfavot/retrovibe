/**
 * Masques de cellules de l'équivalence de fractions (screens/bowling.md §1.7) : `1010:2e4b` (`contiguousMask`), `1010:2f08`
 * (`popcount`), `1010:2f34` (rejet), `1010:2fb8` (`scatteredMask`), simplification de fraction `1018:064d`.
 * Un masque de `n` cellules (8, 12 ou 24) est un entier dont le bit `i` dit si la cellule `i` est coloriée.
 */
import { MsvcRandom } from "../../engine/rng";

function fullMask(cells: number): number {
  return cells >= 32 ? 0xffffffff : (1 << cells) - 1;
}

/** `1010:2e4b` : `k` bits contigus à partir du bit 0, tournés de `rotation` vers le haut dans `cells` bits (`k = 0` → 0, `k = cells` → plein). */
export function contiguousMask(cells: number, k: number, rotation: number): number {
  if (k <= 0) return 0;
  const full = fullMask(cells);
  if (k === cells) return full;
  let mask = (1 << k) - 1;
  for (let i = 0; i < rotation; i++) {
    mask *= 2;
    if (mask > full) mask = (mask & full) | 1;
  }
  return mask;
}

/** `1010:2f08` : nombre de bits à 1 parmi les `cells` bits de poids faible. */
export function popcount(cells: number, value: number): number {
  let count = 0;
  for (let bit = 0; bit < cells; bit++) count += (value >>> bit) & 1;
  return count;
}

/**
 * `1010:2f34` : rejet d'un masque de 8 cellules trop simple (sous-types 3 à 5 seulement ; pour 2 et 3 le test est rarement atteint) :
 * rejeté si `k ≤ 1`, `k ≥ 7` ou si le masque compte au plus 3 plages de bits identiques.
 */
function rejected(subType: number, k: number, mask: number): boolean {
  if (subType < 2 || subType > 5) return false;
  if (k <= 1 || k >= 7) return true;
  let state = (mask & 1) === 0;
  let bit = 0;
  for (let run = 0; run < 3; run++) {
    while (bit < 8 && (((mask >>> bit) & 1) === 0) === state) bit++;
    if (bit === 8) return true;
    state = !state;
  }
  return false;
}

/** Garde-fou : le tirage rejeté se termine très vite (probabilité de rejet < 1/2 pour k de 2 à 6). */
const MAX_SCATTER_ATTEMPTS = 100000;

/**
 * `1010:2fb8` : masque de `k` cellules éparpillées, déterministe pour (`cells`, `k`, `seed`). Hors de 2 ≤ k < cells − 1 c'est un
 * masque contigu tourné de `seed`. Sinon un générateur local est réamorcé à `signext16(seed)` (l'original sauve et restaure
 * l'état global : le générateur du jeu n'avance pas), et chaque cellule `i` est posée si toutes les restantes sont nécessaires
 * (`restantes = k`) ou sur un tirage `rand1(2) ≠ 0`. `subType` règle le rejet des masques trop simples.
 */
export function scatteredMask(cells: number, k: number, seed: number, subType: number): number {
  if (k < 2 || k >= cells - 1) return contiguousMask(cells, k, seed);
  const rng = new MsvcRandom(((seed << 16) >> 16) >>> 0);
  for (let attempt = 0; attempt < MAX_SCATTER_ATTEMPTS; attempt++) {
    let remaining = k;
    let mask = 0;
    for (let i = 0, left = cells; i < cells && remaining !== 0; i++, left--) {
      if (left === remaining || rng.rand1(2) !== 0) {
        mask |= 1 << i;
        remaining--;
      }
    }
    if (!rejected(subType, k, mask)) return mask;
  }
  throw new Error(`masque éparpillé introuvable (${cells}, ${k}, ${seed}, ${subType})`);
}

/** Rotation circulaire vers le haut de `shift` cellules dans un masque de 12 cellules (`2150` cas 6 : `<< 1` avec report du bit 12 en bit 0). */
export function rotateMask12(mask: number, shift: number): number {
  let value = mask;
  for (let i = 0; i < shift; i++) {
    value <<= 1;
    if ((value & 0x1000) !== 0) value = (value & 0xfff) | 1;
  }
  return value;
}

/**
 * `1018:064d(3, den, num)` : réduction par 2 (autant de fois que possible) puis par 3. Sans effet si `num` ou `den` est nul ;
 * `num = den` donne 1/1. Le texte final est celui de `1010:12ad` : `k` seul quand `k = 0` ou `k = den` (après réduction), sinon `k/den`.
 */
export function simplifyFraction(numerator: number, denominator: number): { numerator: number; denominator: number } {
  if (numerator === 0 || denominator === 0) return { numerator, denominator };
  if (numerator === denominator) return { numerator: 1, denominator: 1 };
  let num = numerator;
  let den = denominator;
  while ((num & 1) === 0 && (den & 1) === 0) {
    num >>= 1;
    den >>= 1;
  }
  while (num % 3 === 0 && den % 3 === 0) {
    num /= 3;
    den /= 3;
  }
  return { numerator: num, denominator: den };
}
