/**
 * Générateur congruentiel linéaire 32 bits partagé par les jeux : `s ← s × multiplicateur + incrément (mod 2³²)`,
 * sortie `(s >>> décalage) & masque`. Les compilateurs des originaux (Microsoft C, Borland C) ne diffèrent que par ces
 * paramètres ; la graine est injectable pour que les parties soient reproductibles.
 *
 * Module pur : aucune dépendance au navigateur.
 */

export interface LcgParams {
  multiplier: number;
  increment: number;
  /** Nombre de bits écartés en bas de l'état pour former la sortie. */
  shift: number;
  /** Masque appliqué à la sortie décalée (`0x7fff` : 15 bits, `0xffff` : 16 bits). */
  mask: number;
}

/** `rand()` du CRT Microsoft : 15 bits (`(s >> 16) & 0x7fff`). Armaeth, Indiana Jones. */
export const msvcRand: LcgParams = { multiplier: 214013, increment: 2531011, shift: 16, mask: 0x7fff };
/** Même congruence, 16 bits hauts complets sans masque 15 bits (Mathémagique, `10a8:1473`). */
export const msvcRand16: LcgParams = { multiplier: 214013, increment: 2531011, shift: 16, mask: 0xffff };
/** `rand()` de la bibliothèque Borland : `s × 0x015A4E35 + 1`, 15 bits (Téléportaschtroumpf). */
export const borlandRand: LcgParams = { multiplier: 0x015a4e35, increment: 1, shift: 16, mask: 0x7fff };

export class Lcg {
  private value: number;

  constructor(
    seed = 0,
    private readonly params: LcgParams = msvcRand,
  ) {
    this.value = seed >>> 0;
  }

  /** Remplace l'état (la graine est l'état de départ : le premier tirage utilise l'état suivant). */
  seed(seed: number): void {
    this.value = seed >>> 0;
  }

  /** État interne (32 bits non signé) : `seed(state)` reprend la suite des tirages exactement là (sauvegarde de partie). */
  get state(): number {
    return this.value;
  }

  /** Avance d'un pas et renvoie la sortie masquée. */
  next(): number {
    const { multiplier, increment, shift, mask } = this.params;
    this.value = (Math.imul(this.value, multiplier) + increment) >>> 0;
    return (this.value >>> shift) & mask;
  }

  /** Entier dans [0, n) par `next() % n` (modulo non corrigé, comme le C d'origine). `n ≤ 0` renvoie 0 sans avancer l'état. */
  mod(n: number): number {
    return n <= 0 ? 0 : this.next() % n;
  }

  /** Entier dans [0, n] par `next() % (n + 1)`. `n ≤ 0` renvoie 0 sans avancer l'état. */
  inclusive(n: number): number {
    return n <= 0 ? 0 : this.next() % (n + 1);
  }

  /** Tirage « à l'échelle » `⌊next() × n / (masque + 1)⌋` (division entière à la Borland). */
  scaled(n: number): number {
    return Math.floor((this.next() * n) / (this.params.mask + 1));
  }

  pick<T>(items: readonly T[]): T | undefined {
    return items.length ? items[this.mod(items.length)] : undefined;
  }

  /** Mélange de Fisher-Yates (copie ; l'argument n'est pas modifié). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.mod(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

/** Graine aléatoire 31 bits, pour les parties non reproductibles. */
export function randomSeed(): number {
  return (Math.random() * 0x7fffffff) | 0;
}
