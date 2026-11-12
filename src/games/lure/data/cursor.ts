/**
 * Lecture suivie des octets d'une ressource de `lure.dat` : chaque octet lu est marqué dans une `Coverage`, ce qui permet de vérifier (en test)
 * que la structure décodée explique la ressource jusqu'au dernier octet, et de lister ce qui reste (remplissage, mémoire non initialisée).
 * Écrit pour ce projet ; pas de référence ScummVM.
 */

/** Octets d'une ressource lus par un lecteur. */
export class Coverage {
  private readonly seen: Uint8Array;

  constructor(readonly size: number) {
    this.seen = new Uint8Array(size);
  }

  mark(from: number, to: number): void {
    this.seen.fill(1, from, Math.min(to, this.size));
  }

  /** Plages `[début, fin[` jamais lues, dans l'ordre. */
  unread(): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    let start = -1;
    for (let i = 0; i <= this.size; i++) {
      const missing = i < this.size && this.seen[i] === 0;
      if (missing && start < 0) start = i;
      if (!missing && start >= 0) {
        ranges.push([start, i]);
        start = -1;
      }
    }
    return ranges;
  }
}

/** Lecteur petit-boutiste avec position explicite ; refuse de lire hors de la ressource. */
export class Cursor {
  pos = 0;

  constructor(
    readonly bytes: Uint8Array,
    private readonly coverage?: Coverage,
  ) {}

  get length(): number {
    return this.bytes.length;
  }

  private take(count: number): number {
    if (this.pos < 0 || this.pos + count > this.bytes.length) throw new RangeError(`lecture hors de la ressource (position ${this.pos}, ${count} octets, taille ${this.bytes.length})`);
    const at = this.pos;
    this.coverage?.mark(at, at + count);
    this.pos += count;
    return at;
  }

  seek(pos: number): this {
    this.pos = pos;
    return this;
  }

  u8(): number {
    return this.bytes[this.take(1)]!;
  }

  i8(): number {
    return (this.u8() << 24) >> 24;
  }

  u16(): number {
    const at = this.take(2);
    return this.bytes[at]! | (this.bytes[at + 1]! << 8);
  }

  i16(): number {
    return (this.u16() << 16) >> 16;
  }

  u32(): number {
    const at = this.take(4);
    return (this.bytes[at]! | (this.bytes[at + 1]! << 8) | (this.bytes[at + 2]! << 16) | (this.bytes[at + 3]! << 24)) >>> 0;
  }

  /** `count` octets (une vue, pas une copie). */
  slice(count: number): Uint8Array {
    const at = this.take(count);
    return this.bytes.subarray(at, at + count);
  }

  /** Octet à la position courante sans l'avancer ni le marquer. */
  peekU16(): number {
    if (this.pos + 2 > this.bytes.length) throw new RangeError("lecture hors de la ressource");
    return this.bytes[this.pos]! | (this.bytes[this.pos + 1]! << 8);
  }
}
