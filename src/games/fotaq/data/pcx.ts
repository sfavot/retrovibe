/**
 * Images PCX (`*.PCX` : décors, panneau, écrans fixes).
 *
 * Source : `Display::decodePCX` (engines/queen/display.cpp, ScummVM), qui passe par le décodeur PCX générique
 * de ScummVM ; ici le décodeur est écrit pour ce jeu seul : PCX version 5, un plan de 8 bits, RLE, palette de
 * 256 couleurs en 8 bits (valeurs 0 à 255) dans les 768 derniers octets après un octet `0x0C`.
 * Écarts volontaires :
 * - la palette est rendue en entier ; le choix des couleurs gardées (0 à 143 du décor, 144 à 255 du panneau :
 *   `setupNewRoom`, `getNumColorsForRoom`) revient au rendu ;
 * - `Display::setupPanel` réécrit un champ de l'en-tête de `PANEL.PCX` (décalage 14, résolution verticale)
 *   avant le décodage : c'est sans effet sur les pixels et n'est pas reproduit ;
 * - une image dont les données ne finissent pas juste avant la palette est refusée.
 */

import { BinaryReader } from "../../../data/reader";

export interface PcxImage {
  width: number;
  height: number;
  /** Indices de palette, ligne par ligne, `width * height` octets (le remplissage de fin de ligne est retiré). */
  pixels: Uint8Array;
  /** 768 octets : 256 couleurs RVB, valeurs 0 à 255. */
  palette: Uint8Array;
}

const HEADER_SIZE = 128;
const PALETTE_SIZE = 768;
const PALETTE_MARKER = 0x0c;
const MANUFACTURER = 0x0a;

export function decodePcx(bytes: Uint8Array): PcxImage {
  if (bytes.length < HEADER_SIZE + PALETTE_SIZE + 1) throw new Error("PCX invalide : fichier trop court");
  const header = new BinaryReader(bytes);
  if (header.u8() !== MANUFACTURER) throw new Error("PCX invalide : signature absente");
  const version = header.u8();
  const encoding = header.u8();
  const bitsPerPixel = header.u8();
  const xMin = header.u16();
  const yMin = header.u16();
  const xMax = header.u16();
  const yMax = header.u16();
  header.offset = 65;
  const planes = header.u8();
  const bytesPerLine = header.u16();
  if (version !== 5 || encoding !== 1 || bitsPerPixel !== 8 || planes !== 1) {
    throw new Error(`PCX invalide : version ${version}, codage ${encoding}, ${bitsPerPixel} bits, ${planes} plans`);
  }
  const width = xMax - xMin + 1;
  const height = yMax - yMin + 1;
  if (width <= 0 || height <= 0 || bytesPerLine < width) throw new Error("PCX invalide : dimensions incohérentes");

  const paletteMarker = bytes.length - PALETTE_SIZE - 1;
  if (bytes[paletteMarker] !== PALETTE_MARKER) throw new Error("PCX invalide : palette absente");

  const pixels = new Uint8Array(width * height);
  const line = new Uint8Array(bytesPerLine);
  let src = HEADER_SIZE;
  const next = (): number => {
    if (src >= paletteMarker) throw new Error("PCX invalide : données tronquées");
    return bytes[src++];
  };
  // Une répétition ne franchit pas une fin de ligne dans ces fichiers, mais le décodage reste séquentiel.
  let pending = 0;
  let pendingValue = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < bytesPerLine; x++) {
      if (pending === 0) {
        const b = next();
        if (b >= 0xc0) {
          pending = b & 0x3f;
          pendingValue = next();
        } else {
          pending = 1;
          pendingValue = b;
        }
      }
      line[x] = pendingValue;
      pending--;
    }
    pixels.set(line.subarray(0, width), y * width);
  }
  if (pending !== 0 || src !== paletteMarker) throw new Error("PCX invalide : les données ne finissent pas avant la palette");

  return { width, height, pixels, palette: bytes.slice(paletteMarker + 1) };
}
