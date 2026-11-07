import { decodeRle } from "./rle";

/**
 * Images `.ALG` : 320 x 200 pixels indexés (PCX réduit).
 *
 * Disposition tirée de `loadPic` (engines/drascula/graphics.cpp, ScummVM) : 128 octets d'en-tête ignorés,
 * données RLE, palette de 768 octets en fin de fichier. L'en-tête est nul dans la plupart des fichiers et
 * contient un vrai en-tête PCX dans quelques-uns ; il n'est jamais lu. Écart : ScummVM lit la palette en
 * 8 bits puis la divise par 4 avant l'affichage ; ce lecteur rend les valeurs du fichier (0 à 255) et laisse
 * la conversion à l'affichage.
 */

const HEADER_BYTES = 128;
const PALETTE_BYTES = 256 * 3;

export interface AlgImage {
  /** 64 000 indices de palette (320 x 200). */
  pixels: Uint8Array;
  /** 256 couleurs RVB, une valeur 0 à 255 par composante, telle que stockée. */
  palette: Uint8Array;
  /** Vrai si l'en-tête de 128 octets est un en-tête PCX (`0A 01 08`) et non du remplissage. */
  hasPcxHeader: boolean;
  /** Octets de données entre la fin de l'image RLE et la palette (1 : l'octet `0x0C` de la palette PCX standard). */
  slack: number;
}

export function parseAlg(bytes: Uint8Array): AlgImage {
  if (bytes.length < HEADER_BYTES + PALETTE_BYTES + 1) throw new Error("ALG invalide : fichier trop court");
  const paletteStart = bytes.length - PALETTE_BYTES;
  const { pixels, consumed } = decodeRle(bytes.subarray(0, paletteStart), HEADER_BYTES);
  return {
    pixels,
    palette: bytes.slice(paletteStart),
    hasPcxHeader: bytes[0] === 0x0a && bytes[2] === 0x01 && bytes[3] === 0x08,
    slack: paletteStart - HEADER_BYTES - consumed,
  };
}
