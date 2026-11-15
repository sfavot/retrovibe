/**
 * Arithmétique entière exacte du moteur de TIMWIN.EXE (`docs/tim3/engine.md` § 4).
 *
 * Le jeu n'a aucune instruction flottante : tout est en entiers 32 bits signés, avec des produits 16 × 16 (413808), des
 * divisions `idiv` qui tronquent vers 0 et des décalages `sar` qui arrondissent vers −∞. Aucune valeur de l'état de la
 * simulation ne doit sortir de ces helpers sous forme de flottant.
 */

/** Entier 32 bits signé (débordement comme `add` / `sub` x86). */
export function i32(v: number): number {
  return v | 0;
}

/** Mot de 16 bits signé (`movsx … word`). */
export function s16(v: number): number {
  return (v << 16) >> 16;
}

/** Mot de 16 bits non signé (`movzx … word`, registre `ax`). */
export function u16(v: number): number {
  return v & 0xffff;
}

/** Octet signé (`movsx … byte`). */
export function s8(v: number): number {
  return (v << 24) >> 24;
}

/** 413808 : produit de deux mots signés (`movsx word` des deux opérandes, `imul`), résultat 32 bits. */
export function mul16(a: number, b: number): number {
  return Math.imul(s16(a), s16(b));
}

/** Produit 32 × 32 bits tronqué à 32 bits (`imul r32, r/m32`). */
export function imul(a: number, b: number): number {
  return Math.imul(a, b);
}

/** `cdq ; idiv` : quotient tronqué vers 0. Une division par 0 lève une erreur, comme l'exception du processeur. */
export function idiv(a: number, b: number): number {
  if ((b | 0) === 0) throw new Error("TIM3 : division entière par zéro");
  return (a / b) | 0;
}

/** `sar` : décalage arithmétique, arrondi vers −∞. */
export function sar(v: number, n: number): number {
  return v >> n;
}

/** Division par 2 du compilateur (`sar 1 ; jns ; adc 0`) : tronque vers 0. */
export function half(v: number): number {
  return ((v | 0) / 2) | 0;
}

/** `cdq ; xor ; sub` : valeur absolue 32 bits (|−2³¹| = −2³¹, comme le processeur). */
export function abs32(v: number): number {
  return v < 0 ? -v | 0 : v | 0;
}

/** Position en 1/512 de pixel → pixel (`sar 9`). */
export function toPixel(v: number): number {
  return v >> 9;
}
