import type { SceneContext } from "./scene";

/**
 * Attente de fin de bruitage de l'original : `while (348d:0b42(1, 0)) 1764:018a`, à la fin de chaque itération d'une boucle de
 * saisie (menus, carte S02 `1a3c:0bee`, choix du magicien S41 `2143:0659`), avant le test de sortie de la boucle.
 *
 * Le port ne bloque pas la boucle : `step` lit une itération (`read`) quand rien ne sonne ; si un bruitage sonne à la fin de
 * l'itération, son résultat (une sortie éventuelle) est gardé en suspens et rendu une seule fois quand le bruitage est fini.
 * Pendant l'attente `read` n'est pas appelé : les appuis de ces pas sont perdus, la boucle d'origine ne les lit pas non plus.
 */
export class EffectWait<T> {
  private waiting = false;
  private held: T | null = null;

  /** Une itération. Renvoie le résultat de `read` (ou celui retenu par l'attente précédente), `null` si rien n'est à rendre. */
  step(ctx: SceneContext, read: () => T | null): T | null {
    if (this.waiting) {
      if (ctx.voice.effectPlaying) return null;
      this.waiting = false;
      const held = this.held;
      this.held = null;
      if (held !== null) return held;
    }
    const result = read();
    if (!ctx.voice.effectPlaying) return result;
    this.waiting = true;
    this.held = result;
    return null;
  }

  /** Abandonne l'attente en cours (entrée dans la scène) : le résultat retenu est perdu. */
  reset(): void {
    this.waiting = false;
    this.held = null;
  }
}
