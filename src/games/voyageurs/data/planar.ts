/**
 * Pixels planaires Atari ST / Amiga : décodage en indices de couleur (0 à 15).
 *
 * Référence : ScummVM engines/cine/gfx.cpp (`gfxConvertSpriteToRaw`) (GPL v3 ou ultérieure). Chaque groupe de 16 pixels tient en
 * 8 octets : quatre mots 16 bits grand-boutistes, un par plan de bits (mot 0 = bit 0 des 16 pixels…) ; le pixel le plus à gauche
 * est le bit 15 de chaque mot. Utilisé par les fonds PI1, les pages de collision NEO, les sprites ANI/ANM et la police.
 *
 * Écart volontaire : `width` hors multiple de 8 est tronqué comme dans ScummVM (`w / 8` groupes par ligne, sans saut de fin de ligne) ;
 * une source trop courte lève une erreur au lieu de lire hors du tampon.
 */

/** Largeur en pixels produite pour `widthBytes` octets de source par ligne (`gfxConvertSpriteToRaw` : `2 * 8 * (w / 8)`). */
export function planarPixelWidth(widthBytes: number): number {
  return (widthBytes >> 3) * 16;
}

/**
 * `gfxConvertSpriteToRaw(dst, src + offset, widthBytes, height)` : `height` lignes de `planarPixelWidth(widthBytes)` indices de couleur.
 */
export function planarToIndexed(src: Uint8Array, offset: number, widthBytes: number, height: number): Uint8Array {
  const groups = widthBytes >> 3;
  const needed = height * groups * 8;
  if (offset < 0 || offset + needed > src.length) {
    throw new RangeError(`données planaires trop courtes : ${needed} octets attendus à partir de ${offset}, ${src.length - offset} disponibles`);
  }
  const out = new Uint8Array(height * groups * 16);
  let s = offset;
  let d = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < groups; x++) {
      const p0 = (src[s]! << 8) | src[s + 1]!;
      const p1 = (src[s + 2]! << 8) | src[s + 3]!;
      const p2 = (src[s + 4]! << 8) | src[s + 5]!;
      const p3 = (src[s + 6]! << 8) | src[s + 7]!;
      for (let bit = 15; bit >= 0; bit--) {
        out[d++] = ((p0 >> bit) & 1) | (((p1 >> bit) & 1) << 1) | (((p2 >> bit) & 1) << 2) | (((p3 >> bit) & 1) << 3);
      }
      s += 8;
    }
  }
  return out;
}
