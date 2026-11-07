/**
 * RLE de type PCX et delta XOR des images 320 x 200, communs aux `.ALG`, `.BIN` SSN et `.BIN` « animate ».
 *
 * Format tiré de `decodeRLE` et `mixVideo` (engines/drascula/graphics.cpp, ScummVM). Réécrit : la sortie est
 * un tableau neuf (ScummVM écrit dans un tampon de l'écran, avec son pas), et une source trop courte lance
 * au lieu de lire au-delà du tampon.
 */

export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;
/** Pixels d'une image pleine (un octet par pixel, indices de palette). */
export const SCREEN_PIXELS = SCREEN_WIDTH * SCREEN_HEIGHT;

export interface RleImage {
  /** 64 000 indices de palette, ligne après ligne. */
  pixels: Uint8Array;
  /** Octets de `src` consommés, à partir de `start`. */
  consumed: number;
}

/**
 * Décode une image RLE : un octet dont les deux bits de poids fort valent `11` donne le nombre de répétitions
 * (`octet & 0x3F`) de l'octet suivant ; sinon l'octet est un pixel. Le décodage s'arrête au 64 000e pixel,
 * même au milieu d'une répétition (le reste de la répétition est perdu, comme chez ScummVM). Une répétition de
 * 0 ne produit rien mais consomme son octet de valeur.
 */
export function decodeRle(src: Uint8Array, start = 0): RleImage {
  const pixels = new Uint8Array(SCREEN_PIXELS);
  let read = start;
  let written = 0;
  while (written < SCREEN_PIXELS) {
    if (read >= src.length) throw new Error(`RLE tronqué : ${written} pixels sur ${SCREEN_PIXELS}`);
    let value = src[read++];
    let repeat = 1;
    if ((value & 0xc0) === 0xc0) {
      repeat = value & 0x3f;
      if (read >= src.length) throw new Error(`RLE tronqué : ${written} pixels sur ${SCREEN_PIXELS}`);
      value = src[read++];
    }
    const end = Math.min(SCREEN_PIXELS, written + repeat);
    pixels.fill(value, written, end);
    written = end;
  }
  return { pixels, consumed: read - start };
}

/** Combine `image` à `screen` par OU exclusif (`screen ^= image`) : image suivante d'un flux delta. */
export function xorInto(screen: Uint8Array, image: Uint8Array): void {
  for (let i = 0; i < SCREEN_PIXELS; i++) screen[i] ^= image[i];
}
