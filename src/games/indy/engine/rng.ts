/** Générateur pseudo-aléatoire du CRT Microsoft (celui du jeu original) : rand() ∈ [0, 0x7fff]. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  get seed(): number {
    return this.state;
  }

  next(): number {
    this.state = (Math.imul(this.state, 214013) + 2531011) | 0;
    return (this.state >>> 16) & 0x7fff;
  }

  /** Entier dans [0, n). */
  mod(n: number): number {
    return n <= 0 ? 0 : this.next() % n;
  }

  pick<T>(items: readonly T[]): T | undefined {
    return items.length ? items[this.mod(items.length)] : undefined;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.mod(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

export function randomSeed(): number {
  return (Math.random() * 0x7fffffff) | 0;
}
