import { Lcg, borlandRand } from "../../../engine/rng";

/**
 * Générateur congruentiel de la bibliothèque Borland (`1000:07a7`) :
 * `seed = seed × 0x015A4E35 + 1` (32 bits), retour de `(seed >> 16) & 0x7FFF`.
 * L'original le graine avec `time(NULL) & 0xFFFF` (`1f33:0085`) ; ici la graine est injectable.
 * Paramètres et mécanique dans `Lcg` (`src/engine/rng.ts`).
 */
export class BorlandRandom extends Lcg {
  constructor(seed = 0) {
    super(seed, borlandRand);
  }

  /** État interne (32 bits) : `seed(state)` reprend la suite de tirages exactement là (sauvegarde de partie). */
  get current(): number {
    return this.state;
  }

  /** Tirage uniforme dans `[0, n[` à la manière du jeu : `rand() × n / 0x8000` (division entière). */
  below(n: number): number {
    return this.scaled(n);
  }
}
