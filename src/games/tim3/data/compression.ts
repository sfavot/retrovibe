/**
 * Compressions Dynamix de TIM3 (`docs/tim3/formats.md` § 3) : charge compressée = `u8 méthode`, `u32 taille décompressée`, flux.
 * Méthode 0 = brut, 1 = RLE, 2 = LZW.
 *
 * Algorithmes réécrits d'après `engines/dgds/decompress.cpp` de ScummVM (GPL v3 ou ultérieure), lu comme référence ; aucun code
 * n'en est repris tel quel.
 *
 * - RLE : un octet de commande ; bit 7 levé = répète l'octet suivant `cmd & 0x7f` fois, sinon recopie `cmd` octets.
 * - LZW : codes lus poids faible d'abord, 9 bits au départ, 12 au plus, code 256 = remise à zéro, première entrée libre 257.
 *   La largeur augmente dès que la table atteint 2^n entrées. Les codes sont écrits par blocs de 8 : le compteur `cache` suit
 *   les bits lus depuis le dernier bloc entier, remis à zéro à chaque changement de largeur ; à une remise à zéro du
 *   dictionnaire, le flux saute les bits restants du bloc de `nbits × 8` bits en cours.
 */

export const COMPRESSION_RAW = 0;
export const COMPRESSION_RLE = 1;
export const COMPRESSION_LZW = 2;

/** Décompresse une charge `u8 méthode, u32 taille, flux` (chunk `BIN:` / `VGA:` d'un BMP DGDS, police FNT). */
export function decompressPayload(payload: Uint8Array): Uint8Array {
  if (payload.length < 5) throw new Error("TIM3 : charge compressée tronquée");
  const method = payload[0];
  const size = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(1, true);
  return decompress(method, payload.subarray(5), size);
}

export function decompress(method: number, stream: Uint8Array, size: number): Uint8Array {
  switch (method) {
    case COMPRESSION_RAW:
      if (stream.length !== size) throw new Error("TIM3 : taille des données brutes incohérente");
      return stream.slice();
    case COMPRESSION_RLE:
      return rleDecompress(stream, size);
    case COMPRESSION_LZW:
      return lzwDecompress(stream, size);
    default:
      throw new Error(`TIM3 : méthode de compression ${method} inconnue`);
  }
}

/** RLE Dynamix ; lève une erreur si le flux s'épuise avant `size` octets ou s'il déborde. */
export function rleDecompress(src: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let p = 0;
  let o = 0;
  while (o < size) {
    if (p >= src.length) throw new Error("TIM3 : flux RLE tronqué");
    const cmd = src[p++];
    const n = cmd & 0x7f;
    if (o + n > size) throw new Error("TIM3 : flux RLE trop long");
    if (cmd & 0x80) {
      if (p >= src.length) throw new Error("TIM3 : flux RLE tronqué");
      out.fill(src[p++], o, o + n);
    } else {
      if (p + n > src.length) throw new Error("TIM3 : flux RLE tronqué");
      out.set(src.subarray(p, p + n), o);
      p += n;
    }
    o += n;
  }
  return out;
}

const RESET_CODE = 0x100;
const FIRST_FREE = 0x101;
const MIN_BITS = 9;
const MAX_BITS = 12;

/** LZW Dynamix ; lève une erreur si le flux s'épuise avant `size` octets ou contient un code invalide. */
export function lzwDecompress(src: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  // Dictionnaire : entrée = (préfixe, dernier octet, premier octet, longueur) ; 0-255 = octets seuls.
  const prefix = new Int16Array(1 << MAX_BITS);
  const suffix = new Uint8Array(1 << MAX_BITS);
  const first = new Uint8Array(1 << MAX_BITS);
  const length = new Uint16Array(1 << MAX_BITS);
  for (let i = 0; i < 256; i++) {
    prefix[i] = -1;
    suffix[i] = i;
    first[i] = i;
    length[i] = 1;
  }

  let pos = 0; // octet courant du flux
  let bitBuf = 0;
  let bitCount = 0;
  const readBits = (total: number): number => {
    let res = 0;
    let got = 0;
    while (got < total) {
      if (bitCount === 0) {
        if (pos >= src.length) throw new Error("TIM3 : flux LZW tronqué");
        bitBuf = src[pos++];
        bitCount = 8;
      }
      const use = Math.min(total - got, bitCount);
      res += (bitBuf & ((1 << use) - 1)) * 2 ** got;
      got += use;
      bitCount -= use;
      bitBuf >>= use;
    }
    return res;
  };

  let nbits = MIN_BITS;
  let tableMax = 1 << MIN_BITS;
  let tableLen = FIRST_FREE;
  let full = false;
  let cache = 0;
  let prev = -1; // code de l'entrée précédente
  let o = 0;

  while (o < size) {
    const code = readBits(nbits);
    cache += nbits;
    if (cache >= nbits * 8) cache -= nbits * 8;
    if (code === RESET_CODE) {
      if (cache > 0) readBits(nbits * 8 - cache);
      nbits = MIN_BITS;
      tableMax = 1 << MIN_BITS;
      tableLen = FIRST_FREE;
      full = false;
      cache = 0;
      prev = -1;
      continue;
    }

    let cur: number;
    if (code < tableLen) {
      cur = code;
    } else if (code === tableLen && !full && prev >= 0) {
      // Cas « KwKwK » : l'entrée n'existe pas encore, c'est la précédente suivie de son premier octet.
      cur = tableLen;
    } else {
      throw new Error(`TIM3 : code LZW invalide (${code})`);
    }
    if (prev >= 0 && !full) {
      prefix[tableLen] = prev;
      suffix[tableLen] = first[cur === tableLen ? prev : cur];
      first[tableLen] = first[prev];
      length[tableLen] = length[prev] + 1;
      tableLen++;
      if (tableLen === tableMax) {
        if (nbits < MAX_BITS) {
          nbits++;
          tableMax = 1 << nbits;
          cache = 0;
        } else {
          full = true;
        }
      }
    }
    // Écriture de l'entrée `cur` (de la fin vers le début) ; les octets au-delà de `size` sont ignorés.
    const len = length[cur];
    let c = cur;
    for (let i = len - 1; i >= 0; i--) {
      if (o + i < size) out[o + i] = suffix[c];
      c = prefix[c];
    }
    o += len;
    prev = cur;
  }
  return out;
}
