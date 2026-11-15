/**
 * 4520a4 : générateur pseudo-aléatoire de TIMWIN.EXE (Fibonacci additif retardé, table de 56 mots).
 *
 * `docs/tim3/engine.md` § 4 disait « aucun hasard » : c'est faux. Ce générateur n'a pas de constante de congruence (ce
 * qui l'avait masqué) ; il est appelé par des handlers de pièces (chat, souris Mel, chauve-souris, mandrill, flipper,
 * lampe d'Aladdin…) et par l'interface. Il n'est jamais réamorcé par l'horloge (`4520fc` n'a pas d'appelant direct) :
 * son état part de la table statique de l'exe, donc la simulation reste déterministe à état initial égal.
 */
import { RNG_I0, RNG_J0, RNG_TABLE0 } from "../data/tables/random";

export class Random {
  private table = Uint32Array.from(RNG_TABLE0);
  private i = RNG_I0;
  private j = RNG_J0;

  /** Valeur suivante, 16 bits non signés (`movzx eax, ax`). */
  next(): number {
    const v = this.table[this.i]!;
    this.table[this.j] = (this.table[this.j]! + v) >>> 0;
    const r = this.table[this.j]!;
    if (++this.j === 56) this.j = 0;
    if (++this.i === 56) this.i = 0;
    return r & 0xffff;
  }

  clone(): Random {
    const r = new Random();
    r.table = Uint32Array.from(this.table);
    r.i = this.i;
    r.j = this.j;
    return r;
  }
}
