/**
 * Décompression RNC méthode 1 (« Rob Northen Compression »).
 *
 * Référence : ScummVM common/compression/rnc_deco.cpp, `RncDecoder::unpackM1`, `crcBlock`, `inputBits`, `makeHufftable`, `inputValue`
 * (GPL v3 ou ultérieure), relu avec le lecteur Python de contrôle `scripts/bass/split_dsk.py`.
 *
 * Format : en-tête de 18 octets (`"RNC\x01"`, taille décompressée `u32` BE, taille compressée `u32` BE, CRC de la sortie `u16` BE, CRC de
 * l'entrée `u16` BE, un octet de marge, nombre de blocs), puis un flux de bits lu par mots `u16` LE, poids faible d'abord. Par bloc : trois
 * tables de Huffman (littéraux, distances, longueurs), un compte `u16`, puis des couples (suite de littéraux copiés tels quels depuis le flux
 * d'octets, copie arrière). Les CRC sont des CRC-16 de polynôme `0xA001` (réfléchi).
 *
 * Écarts volontaires :
 * - ScummVM rend 0 (« pas compressé ») quand la signature manque et un code négatif quand un CRC est faux, puis `Disk::loadFile` ne distingue
 *   pas ce second cas ; ici l'absence de signature se teste avec `hasRnc1Signature` et toute corruption (CRC, tailles, code de Huffman
 *   inconnu, copie hors de la sortie) lève `RncError` ;
 * - la sortie est allouée d'après l'en-tête (plafonnée par `MAX_UNPACKED_SIZE`) et chaque écriture est bornée ; ScummVM ne contrôle que les CRC ;
 * - une table de Huffman de plus de 16 codes (tableau de 16 octets dans ScummVM) est refusée.
 */

export const RNC1_SIGNATURE = 0x524e4301;
export const RNC_HEADER_SIZE = 18;
/** Garde-fou : taille décompressée maximale acceptée (le plus gros fichier du jeu fait moins de 1 Mo). */
export const MAX_UNPACKED_SIZE = 64 * 1024 * 1024;
const MIN_LENGTH = 2;
const MAX_CODES = 16;

export class RncError extends Error {
  constructor(message: string) {
    super(`RNC : ${message}`);
    this.name = "RncError";
  }
}

const CRC_TABLE = (() => {
  const table = new Uint16Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/** `RncDecoder::crcBlock` : CRC-16, polynôme `0xA001`, valeur initiale 0. */
export function crc16(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0;
  for (let i = start; i < end; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]!) & 0xff]!;
  return crc;
}

/** Vrai si `bytes` commence par `"RNC\x01"` (sinon `unpackM1` rend « pas compressé »). */
export function hasRnc1Signature(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0 === RNC1_SIGNATURE;
}

/** Table de Huffman canonique : codes classés par longueur puis par symbole, bits arrivant poids faible d'abord. */
interface HuffTable {
  readonly lengths: Uint8Array;
  readonly codes: Uint16Array;
  readonly symbols: Uint8Array;
}

/**
 * Décompresse un flux RNC méthode 1 (en-tête compris). Lève `RncError` si la signature manque ou si le flux est corrompu.
 * `input` peut être plus long que le flux : seuls les `18 + taille compressée` premiers octets sont lus.
 */
export function rnc1Unpack(input: Uint8Array): Uint8Array {
  if (!hasRnc1Signature(input)) throw new RncError("signature absente");
  if (input.length < RNC_HEADER_SIZE) throw new RncError("en-tête tronqué");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const unpackedSize = view.getUint32(4, false);
  const packedSize = view.getUint32(8, false);
  const crcUnpacked = view.getUint16(12, false);
  const crcPacked = view.getUint16(14, false);
  const blocks = input[17]!;
  if (unpackedSize > MAX_UNPACKED_SIZE) throw new RncError(`taille décompressée aberrante (${unpackedSize})`);
  if (RNC_HEADER_SIZE + packedSize > input.length) throw new RncError("flux tronqué");
  if (crc16(input, RNC_HEADER_SIZE, RNC_HEADER_SIZE + packedSize) !== crcPacked) throw new RncError("CRC du flux compressé");

  const out = new Uint8Array(unpackedSize);
  let outPos = 0;
  // Lecture de bits : `bits` contient `count` bits non consommés ; `pos` est l'octet du prochain mot de 16 bits à charger. Les mots sont
  // chargés au besoin seulement, ce qui place la suite de littéraux d'un bloc exactement où ScummVM la lit.
  let bits = 0;
  let count = 0;
  let pos = RNC_HEADER_SIZE;
  const word = (p: number): number => (p + 1 < input.length ? input[p]! | (input[p + 1]! << 8) : p < input.length ? input[p]! : 0);

  const take = (n: number): number => {
    while (count < n) {
      bits |= word(pos) << count;
      pos += 2;
      count += 16;
    }
    const value = bits & ((1 << n) - 1);
    bits >>>= n;
    count -= n;
    return value;
  };
  const peek16 = (): number => {
    let b = bits;
    let c = count;
    let p = pos;
    while (c < 16) {
      b |= word(p) << c;
      p += 2;
      c += 16;
    }
    return b & 0xffff;
  };

  const readTable = (): HuffTable | null => {
    const numCodes = take(5);
    if (numCodes === 0) return null;
    if (numCodes > MAX_CODES) throw new RncError(`table de Huffman de ${numCodes} codes`);
    const lengthOf = new Uint8Array(numCodes);
    for (let i = 0; i < numCodes; i++) lengthOf[i] = take(4);
    const lengths: number[] = [];
    const codes: number[] = [];
    const symbols: number[] = [];
    let huffCode = 0;
    for (let bitLength = 1; bitLength < 17; bitLength++) {
      for (let i = 0; i < numCodes; i++) {
        if (lengthOf[i] !== bitLength) continue;
        const b = huffCode >>> (16 - bitLength);
        let mirrored = 0;
        for (let j = 0; j < bitLength; j++) mirrored |= ((b >>> j) & 1) << (bitLength - j - 1);
        lengths.push(bitLength);
        codes.push(mirrored);
        symbols.push(i);
        huffCode += 1 << (16 - bitLength);
      }
    }
    return { lengths: Uint8Array.from(lengths), codes: Uint16Array.from(codes), symbols: Uint8Array.from(symbols) };
  };

  const readValue = (table: HuffTable | null): number => {
    if (!table) throw new RncError("table de Huffman vide");
    const window = peek16();
    let found = -1;
    for (let k = 0; k < table.lengths.length; k++) {
      if ((window & ((1 << table.lengths[k]!) - 1)) === table.codes[k]!) {
        found = k;
        break;
      }
    }
    if (found < 0) throw new RncError("code de Huffman inconnu");
    take(table.lengths[found]!);
    let value = table.symbols[found]!;
    if (value >= 2) {
      value--;
      value = take(value) | (1 << value);
    }
    return value;
  };

  take(2);
  // `do { ... } while (--blocks)` sur un octet : 0 bloc en vaut 256.
  let blocksLeft = blocks === 0 ? 256 : blocks;
  do {
    const rawTable = readTable();
    const distTable = readTable();
    const lenTable = readTable();
    let counts = take(16) || 0x10000;
    do {
      const literals = readValue(rawTable);
      if (literals) {
        if (pos + literals > input.length) throw new RncError("littéraux au-delà de l'entrée");
        if (outPos + literals > unpackedSize) throw new RncError("sortie plus grande que prévu");
        out.set(input.subarray(pos, pos + literals), outPos);
        outPos += literals;
        pos += literals;
      }
      if (counts > 1) {
        const distance = readValue(distTable) + 1;
        const length = readValue(lenTable) + MIN_LENGTH;
        if (distance > outPos) throw new RncError("distance de copie invalide");
        if (outPos + length > unpackedSize) throw new RncError("sortie plus grande que prévu");
        // Les zones peuvent se recouvrir : copie octet par octet.
        for (let i = 0; i < length; i++, outPos++) out[outPos] = out[outPos - distance]!;
      }
    } while (--counts);
  } while (--blocksLeft);

  if (outPos !== unpackedSize) throw new RncError(`${outPos} octets produits pour ${unpackedSize} annoncés`);
  if (crc16(out) !== crcUnpacked) throw new RncError("CRC de la sortie");
  return out;
}
