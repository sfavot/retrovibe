/**
 * Ordre de tracé de la file des primitives tel que le construit `gm_queue_insert` (`00423620`) : une liste doublement chaînée bornée
 * par deux sentinelles (`gm_queue_reset` `00422eac` : tête `00499cd8` de clé 9 999 999, queue `00499d30` de clé −9 999 999), où
 * chaque insertion part du point d'arrêt de la précédente (`DAT_005774d8`). Vers les petites clés, on avance tant que la nouvelle
 * clé est plus petite et l'on se range après ; sinon on remonte tant qu'elle est plus grande et l'on se range avant. À clé égale,
 * l'ordre dépend donc du sens de la recherche. Le tracé suit la liste depuis la tête : du plus loin au plus proche.
 */
const HEAD_KEY = 9999999;
const TAIL_KEY = -9999999;

export class DepthList {
  private readonly head: number;
  private readonly tail: number;
  private readonly key: Int32Array;
  /** Champ `+0xc` : élément suivant dans l'ordre de tracé (clé plus petite). */
  private readonly smaller: Int32Array;
  /** Champ `+0x10` : élément précédent (clé plus grande). */
  private readonly larger: Int32Array;
  private cursor: number;

  constructor(capacity: number) {
    this.head = capacity;
    this.tail = capacity + 1;
    this.key = new Int32Array(capacity + 2);
    this.smaller = new Int32Array(capacity + 2);
    this.larger = new Int32Array(capacity + 2);
    this.key[this.head] = HEAD_KEY;
    this.key[this.tail] = TAIL_KEY;
    this.cursor = this.head;
    this.reset();
  }

  /** Liste vide, recherche repartant de la tête. */
  reset(): void {
    this.smaller[this.head] = this.tail;
    this.larger[this.tail] = this.head;
    this.cursor = this.head;
  }

  /** Range l'entrée `i` (0 ≤ i < capacité) de clé `k`. */
  insert(i: number, k: number): void {
    const { key, smaller, larger } = this;
    key[i] = k;
    let c = this.cursor;
    if (k < key[c]!) {
      while (k < key[c]!) c = smaller[c]!;
      smaller[i] = c;
      larger[i] = larger[c]!;
      larger[c] = i;
      smaller[larger[i]!] = i;
    } else {
      while (key[c]! < k) c = larger[c]!;
      smaller[i] = smaller[c]!;
      larger[i] = c;
      smaller[c] = i;
      larger[smaller[i]!] = i;
    }
    this.cursor = c;
  }

  /** Première entrée à tracer, ou -1 ; `next(i)` donne la suivante (parcours sans allocation). */
  first(): number {
    const i = this.smaller[this.head]!;
    return i === this.tail ? -1 : i;
  }

  next(i: number): number {
    const n = this.smaller[i]!;
    return n === this.tail ? -1 : n;
  }
}
