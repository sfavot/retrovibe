/**
 * Décompression LZS (« STACpack »), méthode 32 des volumes SCI2 (`docs/gk1/formats.md` § 3).
 *
 * Référence : `engines/sci/resource/decompressor.cpp` (`DecompressorLZS`) de ScummVM (GPL v3 ou ultérieure), lu puis réécrit.
 * Écarts volontaires : la taille de sortie est connue d'avance (en-tête de volume) et **vérifiée** ; un flux tronqué, une
 * distance hors de la sortie ou un débordement lèvent une erreur au lieu de s'arrêter en silence.
 *
 * Flux de bits, poids fort d'abord :
 * - bit 0 : un octet littéral ;
 * - bit 1 : copie ; bit suivant 1 = distance sur 7 bits (**0 = fin du flux**), 0 = distance sur 11 bits ; puis la longueur :
 *   2 bits (0 à 2 → 2 à 4) ; si 3, 2 bits (0 à 2 → 5 à 7) ; si 3, 8 + somme de quartets tant que le quartet vaut 15.
 * - la copie se fait octet par octet (zones chevauchantes).
 */

const SHORT_DISTANCE_BITS = 7;
const LONG_DISTANCE_BITS = 11;
const LENGTH_ESCAPE = 3;
const NIBBLE_CONTINUES = 15;

export function decompressLzs(src: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let pos = 0;
  let bits = 0;
  let bitCount = 0;
  let o = 0;

  const read = (n: number): number => {
    while (bitCount < n) {
      if (pos >= src.length) throw new Error("GK1 : flux LZS tronqué");
      bits = (bits << 8) | src[pos++];
      bitCount += 8;
    }
    bitCount -= n;
    const value = (bits >>> bitCount) & ((1 << n) - 1);
    bits &= (1 << bitCount) - 1;
    return value;
  };

  const readLength = (): number => {
    let v = read(2);
    if (v < LENGTH_ESCAPE) return v + 2;
    v = read(2);
    if (v < LENGTH_ESCAPE) return v + 5;
    let length = 8;
    for (;;) {
      const nibble = read(4);
      length += nibble;
      if (nibble !== NIBBLE_CONTINUES) return length;
    }
  };

  for (;;) {
    if (read(1) === 0) {
      if (o >= size) throw new Error("GK1 : flux LZS plus long que la taille annoncée");
      out[o++] = read(8);
      continue;
    }
    let distance: number;
    if (read(1) === 1) {
      distance = read(SHORT_DISTANCE_BITS);
      if (distance === 0) break;
    } else {
      distance = read(LONG_DISTANCE_BITS);
    }
    const length = readLength();
    if (distance > o) throw new Error("GK1 : distance LZS hors de la sortie");
    if (o + length > size) throw new Error("GK1 : flux LZS plus long que la taille annoncée");
    for (let k = 0; k < length; k++, o++) out[o] = out[o - distance];
  }
  if (o !== size) throw new Error(`GK1 : flux LZS de ${o} octets pour ${size} annoncés`);
  return out;
}
