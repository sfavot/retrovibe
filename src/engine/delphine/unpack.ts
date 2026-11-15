/**
 * Dépaqueteur Delphine, commun à Croisière pour un cadavre (`cruise`) et Les Voyageurs du temps / Future Wars (`cine`).
 *
 * Référence : `engines/cruise/delphine-unpack.cpp` (`delphineUnpack`) et `engines/cine/unpack.cpp` (`CineUnpacker`) de
 * ScummVM (GPL v3+), le même algorithme à l'octet près : même CRC, mêmes six codes, lecture à rebours.
 * Format : docs/croisiere/formats.md § 2.
 *
 * Écarts volontaires : les accès hors bornes (flux épuisé, copie hors de la sortie) lèvent `DelphineUnpackError`
 * au lieu d'écrire en mémoire, comme le fait `cine` ; la copie brute `size == extSize` reste à la charge de l'appelant
 * (c'est le test des deux moteurs) ; le résultat est complété par des zéros à `unpackedSize`, comme le tampon de
 * ScummVM (alloué à `extSize + 2` et rempli de zéros) : 18 fichiers de Croisière se dépaquettent en `extSize - 1` octets.
 */

export class DelphineUnpackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DelphineUnpackError";
  }
}

/**
 * Dépaquette `packed` (flux Delphine : `[... flux ...][chunk0][crc][taille]`, trois mots 32 bits grand-boutistes en fin).
 * Rend exactement `unpackedSize` octets ; la taille annoncée dans le trailer doit valoir `unpackedSize` ou `unpackedSize - 1`
 * (dans ce cas le dernier octet est 0). Lève `DelphineUnpackError` si le CRC ou la structure est invalide.
 */
export function delphineUnpack(packed: Uint8Array, unpackedSize: number): Uint8Array {
  if (packed.length < 12) throw new DelphineUnpackError("flux Delphine trop court");
  const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
  let sp = packed.length - 4;
  const dstSize = view.getUint32(sp);
  if (dstSize !== unpackedSize && dstSize !== unpackedSize - 1) {
    throw new DelphineUnpackError(`taille annoncée ${dstSize} incompatible avec ${unpackedSize}`);
  }
  sp -= 4;
  let crc = view.getUint32(sp);
  sp -= 4;
  let chk = view.getUint32(sp);
  sp -= 4;
  crc = (crc ^ chk) >>> 0;

  const dst = new Uint8Array(unpackedSize);
  let d = dstSize - 1; // on écrit de la fin vers le début

  /** Un bit du flux (`nextChunk`) : poids faible de `chk`, rechargé d'un mot lu à rebours quand il s'épuise. */
  const nextBit = (): number => {
    let carry = chk & 1;
    chk >>>= 1;
    if (chk === 0) {
      if (sp < 0) throw new DelphineUnpackError("flux Delphine épuisé");
      chk = view.getUint32(sp);
      sp -= 4;
      crc = (crc ^ chk) >>> 0;
      carry = chk & 1;
      chk = ((chk >>> 1) | 0x80000000) >>> 0;
    }
    return carry;
  };
  const getBits = (n: number): number => {
    let c = 0;
    while (n-- > 0) c = (c << 1) | nextBit();
    return c;
  };
  const literal = (count: number): void => {
    if (count > d + 1) throw new DelphineUnpackError("suite brute hors de la sortie");
    while (count-- > 0) dst[d--] = getBits(8);
  };
  const copy = (count: number, offset: number): void => {
    if (count > d + 1 || d + offset >= dstSize) throw new DelphineUnpackError("copie hors de la sortie");
    while (count-- > 0) {
      dst[d] = dst[d + offset]!;
      d--;
    }
  };

  while (d >= 0) {
    if (!nextBit()) {
      if (!nextBit()) literal(getBits(3) + 1);
      else copy(2, getBits(8));
    } else {
      const code = getBits(2);
      if (code === 3) literal(getBits(8) + 9);
      else if (code < 2) copy(code + 3, getBits(code + 9));
      else {
        const count = getBits(8) + 1;
        copy(count, getBits(12));
      }
    }
  }
  if (crc !== 0) throw new DelphineUnpackError("CRC invalide");
  return dst;
}
