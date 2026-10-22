/**
 * Générateur congruentiel de la bibliothèque Borland (`1000:07a7`) :
 * `seed = seed × 0x015A4E35 + 1` (32 bits), retour de `(seed >> 16) & 0x7FFF`.
 * L'original le graine avec `time(NULL) & 0xFFFF` (`1f33:0085`) ; ici la graine est injectable.
 */
export class BorlandRandom {
  private state: number;

  constructor(seed = 0) {
    this.state = seed >>> 0;
  }

  seed(seed: number): void {
    this.state = seed >>> 0;
  }

  /** Entier de 0 à 32767 (`rand()`). */
  next(): number {
    this.state = (Math.imul(this.state, 0x015a4e35) + 1) >>> 0;
    return (this.state >>> 16) & 0x7fff;
  }

  /** Tirage uniforme dans `[0, n[` à la manière du jeu : `rand() × n / 0x8000` (division entière). */
  below(n: number): number {
    return Math.floor((this.next() * n) / 0x8000);
  }
}
