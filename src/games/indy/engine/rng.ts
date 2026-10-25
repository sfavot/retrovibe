import { Lcg, msvcRand } from "../../../engine/rng";

export { randomSeed } from "../../../engine/rng";

/** Générateur pseudo-aléatoire du CRT Microsoft (celui du jeu original) : rand() ∈ [0, 0x7fff]. */
export class Rng extends Lcg {
  constructor(seed: number) {
    super(seed, msvcRand);
  }
}
