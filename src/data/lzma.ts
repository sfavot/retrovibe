/**
 * Décodeur LZMA1 au format « alone » (fichiers `.lzma` : ce qu'écrit `lzma.compress(..., format=FORMAT_ALONE)` en
 * Python, ou `xz --format=lzma`). Sans dépendance. Référence : la spécification publique de LZMA (Igor Pavlov,
 * `lzma-specification.txt` du SDK), dont ce fichier reprend les noms.
 *
 * En-tête de 13 octets : propriétés (`(pb × 5 + lp) × 9 + lc`), taille du dictionnaire (u32 LE), taille décompressée
 * (u64 LE, ou huit `FF` si elle est inconnue : le flux finit alors par un marqueur de fin). Suit le flux du codeur
 * d'intervalles.
 *
 * Le décodage est progressif : `LzmaDecoder.read` remplit le tampon qu'on lui donne et reprend là où il s'était arrêté,
 * ce qui permet de lire un gros fichier morceau par morceau sans le décompresser d'un bloc. La seule mémoire gardée est
 * la fenêtre (taille du dictionnaire).
 */

const HEADER_BYTES = 13;
const MIN_DICTIONARY = 1 << 12;
const END_MARKER_DISTANCE = 0xffffffff;

const NUM_STATES = 12;
const MATCH_MIN_LENGTH = 2;
const PROB_INIT = 1024;
const TOP_VALUE = 1 << 24;

// Disposition des probabilités dans un seul tableau.
const IS_MATCH = 0; // [état << 4 | posState]
const IS_REP = IS_MATCH + (NUM_STATES << 4);
const IS_REP_G0 = IS_REP + NUM_STATES;
const IS_REP_G1 = IS_REP_G0 + NUM_STATES;
const IS_REP_G2 = IS_REP_G1 + NUM_STATES;
const IS_REP0_LONG = IS_REP_G2 + NUM_STATES; // [état << 4 | posState]
const POS_SLOT = IS_REP0_LONG + (NUM_STATES << 4); // 4 arbres de 6 bits
const POS_DECODERS = POS_SLOT + (4 << 6); // 1 + 128 − 14 probabilités
const ALIGN = POS_DECODERS + 115; // arbre inversé de 4 bits
const LENGTH = ALIGN + 16;
/** Un décodeur de longueur : 2 choix, 16 arbres bas de 3 bits, 16 arbres moyens de 3 bits, un arbre haut de 8 bits. */
const LENGTH_PROBS = 2 + (16 << 3) + (16 << 3) + 256;
const REP_LENGTH = LENGTH + LENGTH_PROBS;
const LITERAL = REP_LENGTH + LENGTH_PROBS; // 0x300 par contexte de littéral

export class LzmaDecoder {
  /** Taille décompressée annoncée par l'en-tête, `null` si elle est inconnue (marqueur de fin). */
  readonly uncompressedSize: number | null;
  readonly dictionarySize: number;

  private readonly input: Uint8Array;
  private pos = HEADER_BYTES;
  private range = 0xffffffff;
  private code = 0;

  private readonly lc: number;
  private readonly lpMask: number;
  private readonly pbMask: number;
  private readonly probs: Uint16Array;

  /** Fenêtre circulaire des derniers octets produits. */
  private readonly window: Uint8Array;
  private windowPos = 0;
  private windowFull = false;
  /** Octets produits depuis le début. */
  private total = 0;

  private state = 0;
  private rep0 = 0;
  private rep1 = 0;
  private rep2 = 0;
  private rep3 = 0;
  /** Octets restant à recopier de la correspondance en cours (à la distance `rep0`). */
  private pending = 0;
  private done = false;

  constructor(input: Uint8Array) {
    if (input.length < HEADER_BYTES + 5) throw new Error("LZMA : fichier trop court");
    let props = input[0];
    if (props >= 9 * 5 * 5) throw new Error("LZMA : propriétés invalides");
    this.lc = props % 9;
    props = (props - this.lc) / 9;
    const lp = props % 5;
    const pb = (props - lp) / 5;
    this.lpMask = (1 << lp) - 1;
    this.pbMask = (1 << pb) - 1;

    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    this.dictionarySize = Math.max(view.getUint32(1, true), MIN_DICTIONARY);
    const low = view.getUint32(5, true);
    const high = view.getUint32(9, true);
    if (low === 0xffffffff && high === 0xffffffff) this.uncompressedSize = null;
    else {
      if (high >= 1 << 21) throw new Error("LZMA : taille décompressée trop grande");
      this.uncompressedSize = high * 2 ** 32 + low;
    }

    this.input = input;
    this.window = new Uint8Array(this.dictionarySize);
    this.probs = new Uint16Array(LITERAL + (0x300 << (this.lc + lp))).fill(PROB_INIT);

    // Codeur d'intervalles : un octet nul, puis les quatre premiers octets du code, poids fort d'abord.
    if (input[this.pos++] !== 0) throw new Error("LZMA : début de flux invalide");
    for (let i = 0; i < 4; i++) this.code = this.code * 256 + input[this.pos++];
  }

  /**
   * Vrai quand tout a été décodé (taille annoncée atteinte, ou marqueur de fin lu). La fin n'est constatée que par un
   * `read` qui la rencontre : après avoir lu exactement le dernier octet, il faut un `read` de plus (qui rend 0).
   */
  get finished(): boolean {
    return this.done && this.pending === 0;
  }

  /**
   * Décode jusqu'à `length` octets dans `out` à partir de `offset` et renvoie le nombre d'octets écrits : moins que
   * `length` seulement à la fin des données. Lève une erreur si le flux est tronqué ou corrompu.
   */
  read(out: Uint8Array, offset = 0, length = out.length - offset): number {
    const end = offset + length;
    const window = this.window;
    const size = window.length;
    let o = offset;
    let w = this.windowPos;

    while (o < end) {
      if (this.pending > 0) {
        // Suite (ou début) d'une correspondance : recopie octet par octet, la source pouvant chevaucher la cible.
        let n = Math.min(this.pending, end - o);
        this.pending -= n;
        let from = w - this.rep0 - 1;
        if (from < 0) from += size;
        while (n-- > 0) {
          const byte = window[from];
          if (++from === size) from = 0;
          window[w] = byte;
          if (++w === size) {
            w = 0;
            this.windowFull = true;
          }
          out[o++] = byte;
        }
        continue;
      }
      if (this.done) break;
      const produced = this.total + (o - offset);
      if (this.uncompressedSize !== null && produced >= this.uncompressedSize) {
        this.done = true;
        break;
      }

      const posState = produced & this.pbMask;
      const state = this.state;
      if (this.bit(IS_MATCH + (state << 4) + posState) === 0) {
        const previous = w > 0 || this.windowFull ? window[w > 0 ? w - 1 : size - 1] : 0;
        const probs = LITERAL + 0x300 * (((produced & this.lpMask) << this.lc) + (previous >> (8 - this.lc)));
        let symbol = 1;
        if (state >= 7) {
          // Après une correspondance, le littéral est codé par rapport à l'octet situé à la distance rep0.
          let from = w - this.rep0 - 1;
          if (from < 0) from += size;
          let matchByte = window[from];
          do {
            const matchBit = (matchByte >> 7) & 1;
            matchByte <<= 1;
            const bit = this.bit(probs + ((1 + matchBit) << 8) + symbol);
            symbol = (symbol << 1) | bit;
            if (matchBit !== bit) break;
          } while (symbol < 0x100);
        }
        while (symbol < 0x100) symbol = (symbol << 1) | this.bit(probs + symbol);
        const byte = symbol & 0xff;
        window[w] = byte;
        if (++w === size) {
          w = 0;
          this.windowFull = true;
        }
        out[o++] = byte;
        this.state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
        continue;
      }

      let matchLength: number;
      if (this.bit(IS_REP + state) !== 0) {
        if (w === 0 && !this.windowFull) throw new Error("LZMA : répétition avant toute donnée");
        if (this.bit(IS_REP_G0 + state) === 0) {
          if (this.bit(IS_REP0_LONG + (state << 4) + posState) === 0) {
            // Répétition courte : un seul octet à la distance rep0.
            this.state = state < 7 ? 9 : 11;
            this.pending = 1;
            continue;
          }
        } else {
          let distance: number;
          if (this.bit(IS_REP_G1 + state) === 0) distance = this.rep1;
          else {
            if (this.bit(IS_REP_G2 + state) === 0) distance = this.rep2;
            else {
              distance = this.rep3;
              this.rep3 = this.rep2;
            }
            this.rep2 = this.rep1;
          }
          this.rep1 = this.rep0;
          this.rep0 = distance;
        }
        matchLength = this.length(REP_LENGTH, posState);
        this.state = state < 7 ? 8 : 11;
      } else {
        this.rep3 = this.rep2;
        this.rep2 = this.rep1;
        this.rep1 = this.rep0;
        matchLength = this.length(LENGTH, posState);
        this.state = state < 7 ? 7 : 10;
        this.rep0 = this.distance(matchLength);
        if (this.rep0 === END_MARKER_DISTANCE) {
          if (this.code !== 0) throw new Error("LZMA : marqueur de fin invalide");
          if (this.uncompressedSize !== null && produced !== this.uncompressedSize) {
            throw new Error("LZMA : marqueur de fin avant la taille annoncée");
          }
          this.done = true;
          break;
        }
      }
      if (this.rep0 >= (this.windowFull ? size : w)) throw new Error("LZMA : distance hors de la fenêtre");
      matchLength += MATCH_MIN_LENGTH;
      if (this.uncompressedSize !== null && produced + matchLength > this.uncompressedSize) {
        throw new Error("LZMA : données au-delà de la taille annoncée");
      }
      this.pending = matchLength;
    }

    this.windowPos = w;
    this.total += o - offset;
    return o - offset;
  }

  /** Décode un bit avec la probabilité adaptative d'indice `index`. */
  private bit(index: number): number {
    const probs = this.probs;
    const prob = probs[index];
    const bound = (this.range >>> 11) * prob;
    let bit: number;
    if (this.code < bound) {
      this.range = bound;
      probs[index] = prob + ((2048 - prob) >> 5);
      bit = 0;
    } else {
      this.range -= bound;
      this.code -= bound;
      probs[index] = prob - (prob >> 5);
      bit = 1;
    }
    if (this.range < TOP_VALUE) this.normalize();
    return bit;
  }

  private normalize(): void {
    if (this.pos >= this.input.length) throw new Error("LZMA : flux tronqué");
    this.range *= 256;
    this.code = this.code * 256 + this.input[this.pos++];
  }

  /** `count` bits équiprobables, poids fort d'abord. */
  private directBits(count: number): number {
    let result = 0;
    for (; count > 0; count--) {
      this.range = this.range >>> 1;
      let bit = 0;
      if (this.code >= this.range) {
        this.code -= this.range;
        bit = 1;
      }
      if (this.range < TOP_VALUE) this.normalize();
      result = result * 2 + bit;
    }
    return result;
  }

  /** Arbre de `bits` bits, poids fort d'abord. */
  private tree(base: number, bits: number): number {
    let m = 1;
    for (let i = 0; i < bits; i++) m = (m << 1) + this.bit(base + m);
    return m - (1 << bits);
  }

  /** Arbre de `bits` bits, poids faible d'abord. */
  private reverseTree(base: number, bits: number): number {
    let m = 1;
    let symbol = 0;
    for (let i = 0; i < bits; i++) {
      const bit = this.bit(base + m);
      m = (m << 1) + bit;
      symbol |= bit << i;
    }
    return symbol;
  }

  /** Longueur d'une correspondance, moins `MATCH_MIN_LENGTH` (0 à 271). */
  private length(base: number, posState: number): number {
    if (this.bit(base) === 0) return this.tree(base + 2 + (posState << 3), 3);
    if (this.bit(base + 1) === 0) return 8 + this.tree(base + 2 + (16 << 3) + (posState << 3), 3);
    return 16 + this.tree(base + 2 + (32 << 3), 8);
  }

  /** Distance d'une correspondance (0 = l'octet précédent) ; `END_MARKER_DISTANCE` pour le marqueur de fin. */
  private distance(length: number): number {
    const slot = this.tree(POS_SLOT + (Math.min(length, 3) << 6), 6);
    if (slot < 4) return slot;
    const directBits = (slot >> 1) - 1;
    let distance = (2 | (slot & 1)) * 2 ** directBits;
    if (slot < 14) distance += this.reverseTree(POS_DECODERS + distance - slot, directBits);
    else distance += this.directBits(directBits - 4) * 16 + this.reverseTree(ALIGN, 4);
    return distance;
  }
}

/**
 * Décompresse d'un bloc un fichier LZMA « alone ». Si l'en-tête n'annonce pas la taille, le tampon de sortie grandit
 * au fil du décodage.
 */
export function decodeLzma(input: Uint8Array): Uint8Array {
  const decoder = new LzmaDecoder(input);
  if (decoder.uncompressedSize !== null) {
    const out = new Uint8Array(decoder.uncompressedSize);
    decoder.read(out);
    return out;
  }
  let out = new Uint8Array(Math.max(1 << 16, input.length * 4));
  let length = 0;
  for (;;) {
    length += decoder.read(out, length);
    if (decoder.finished) return out.subarray(0, length);
    const bigger = new Uint8Array(out.length * 2);
    bigger.set(out);
    out = bigger;
  }
}
