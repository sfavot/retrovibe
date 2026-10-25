/**
 * Hasard du jeu (screens/bowling.md §1.2, rockets.md §3.2) : congruentiel linéaire « à la Microsoft C »,
 * `s ← s × 0x343FD + 0x269EC3 (mod 2³²)`, sortie `(s >>> 16) % (n + 1)` : les 16 bits hauts complets, sans masque `& 0x7FFF`
 * (`10a8:1473`). Un seul générateur pour tout le jeu. L'original le graine paresseusement sur l'heure système
 * (`1098:060f`) : ici la graine est injectée, donc le jeu est reproductible à graine fixe.
 *
 * Module pur : aucune dépendance au navigateur. Mécanique dans `Lcg` (`src/engine/rng.ts`).
 */

import { Lcg, msvcRand16 } from "../../../engine/rng";

export class MsvcRandom extends Lcg {
  constructor(seed = 0) {
    super(seed, msvcRand16);
  }

  /** État interne (32 bits) : `seed(state)` reprend la suite des tirages exactement là. */
  get current(): number {
    return this.state;
  }

  /**
   * `10a8:1473(n)` : entier de 0 à `n` inclus. `n ≤ 0` renvoie 0 **sans avancer l'état** (comme l'original pour `n = 0`).
   * `n` doit rester sous 65535 (l'original divise en 16 bits non signés).
   */
  rand(n: number): number {
    return this.inclusive(n);
  }

  /** `10a8:14c1(n)` = `rand(n − 1)` : entier de 0 à `n − 1` (Bowling, Super Sticklers, Puzzle Patterns). `n ≤ 1` renvoie 0 sans avancer. */
  rand1(n: number): number {
    return this.inclusive(n - 1);
  }

  /** Synonyme de `rand1`, lisible là où la spec écrit « dans [0, n[ ». */
  below(n: number): number {
    return this.rand1(n);
  }

  /** `1018:04e1(max, min)` : `lo + rand(hi − lo)`, bornes incluses. */
  range(lo: number, hi: number): number {
    return lo + this.rand(hi - lo);
  }
}

/**
 * Tirage sans remise `10a8:13af(masque, n, &état)` : l'état est un champ de bits (au plus 32 valeurs) conservé par
 * l'appelant, donc **persistant et partageable** (il survit aux parties).
 *
 * Algorithme : `état |= masque` ; `départ = rand(n − 1)` ; tant que le bit `v` est pris : `v = (v + 1) mod n`, et au retour
 * sur `départ` l'état est remis au masque ; on marque `v` et on le renvoie. Ce n'est pas un tirage uniforme parmi les valeurs
 * restantes (sondage linéaire : une valeur précédée d'une longue série de valeurs prises est plus probable) : reproduit tel quel.
 */
export class NoRepeatPool {
  private bits = 0;

  /**
   * @param size nombre de valeurs (1 à 32)
   * @param mask valeurs toujours considérées comme prises (`masque0`, souvent 0)
   */
  constructor(
    readonly size: number,
    readonly mask = 0,
  ) {
    if (!Number.isInteger(size) || size < 1 || size > 32) throw new RangeError(`NoRepeatPool : taille ${size} hors de 1 à 32`);
    this.mask = mask >>> 0;
  }

  /** Champ de bits des valeurs déjà tirées (sauvegarde / restauration). */
  get state(): number {
    return this.bits;
  }

  set state(bits: number) {
    this.bits = bits >>> 0;
  }

  private taken(v: number): boolean {
    return ((this.bits >>> v) & 1) !== 0;
  }

  pick(rng: MsvcRandom): number {
    this.bits = (this.bits | this.mask) >>> 0;
    const start = rng.rand1(this.size);
    let v = start;
    while (this.taken(v)) {
      v = (v + 1) % this.size;
      if (v === start) {
        // Tout est pris : l'original signale « e2GetPoolValue Error » si la remise au masque ne change rien.
        if (this.bits === this.mask) throw new Error("NoRepeatPool : plus aucune valeur libre (le masque les occupe toutes)");
        this.bits = this.mask;
      }
    }
    this.bits = (this.bits | (1 << v)) >>> 0;
    return v;
  }

  /** Oublie l'historique (retour au masque). */
  reset(): void {
    this.bits = this.mask;
  }
}
