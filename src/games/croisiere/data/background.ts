/**
 * Fonds `.PI1` : image 320×200 en indices de palette et palette 256×RGB 8 bits (docs/croisiere/formats.md § 3.1).
 *
 * Référence : `engines/cruise/background.cpp::loadBackground` (palette, `loadMEN`, `loadCVT`) et
 * `gfxModule.cpp::convertGfxFromMode5` de ScummVM (GPL v3+). Le deuxième octet du fichier donne le mode :
 * - 8 : `[0, 8]`, palette 256×3 octets (RGB 8 bits, posés tels quels dans la palette du moteur), 64 000 pixels chunky ;
 * - 5 : `[0, 5]`, 32 mots de palette (`0R`, `GB`, chaque nibble × 17, dupliqués 8 fois dans les 256 entrées), puis 5 plans de 8 000 octets
 *   consécutifs (poids fort = pixel de gauche) ;
 * - un fichier qui commence par `PAL\0` ne porte que 256×RGB (`S01PAL.PI1`), sans image.
 *
 * Écarts volontaires : les modes 0 et 4 (Atari ST, 16 couleurs sur 3 bits) sont codés dans ScummVM mais absents des données DOS : ils
 * lèvent une erreur ici. Les blocs facultatifs `MEN` (couleurs de menu) et `CVT` (table de conversion), lus après l'image par ScummVM,
 * n'existent dans aucun fichier du jeu ; une queue non vide lève une erreur plutôt que d'être ignorée.
 */

export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;
export const SCREEN_PIXELS = SCREEN_WIDTH * SCREEN_HEIGHT;
export const PALETTE_SIZE = 256 * 3;

const PLANE_BYTES = (SCREEN_WIDTH / 8) * SCREEN_HEIGHT;
const MODE5_COLORS = 32;
const MODE5_PLANES = 5;
const PAL_MAGIC = [0x50, 0x41, 0x4c, 0]; // "PAL\0"

export interface Background {
  /** Mode du fichier (5 ou 8). */
  readonly mode: 5 | 8;
  /** 320×200 indices de palette. */
  readonly pixels: Uint8Array;
  /** 256 couleurs × (R, G, B) sur 8 bits, tel que le moteur les envoie à l'écran. */
  readonly palette: Uint8Array;
}

/** Vrai pour un fichier palette seule (`PAL\0` + 768 octets). */
export function isPaletteOnly(bytes: Uint8Array): boolean {
  return PAL_MAGIC.every((b, i) => bytes[i] === b);
}

/** Palette d'un fichier `PAL\0` (copie des 768 octets qui suivent). */
export function parsePaletteOnly(bytes: Uint8Array): Uint8Array {
  if (!isPaletteOnly(bytes) || bytes.length !== 4 + PALETTE_SIZE) throw new Error("Fichier palette PAL invalide");
  return bytes.slice(4, 4 + PALETTE_SIZE);
}

/** Palette 32 couleurs du mode 5, étendue à 256 entrées par répétition. */
function mode5Palette(words: Uint8Array): Uint8Array {
  const palette = new Uint8Array(PALETTE_SIZE);
  for (let i = 0; i < MODE5_COLORS; i++) {
    palette[i * 3] = (words[i * 2]! & 0x0f) * 17;
    palette[i * 3 + 1] = (words[i * 2 + 1]! >> 4) * 17;
    palette[i * 3 + 2] = (words[i * 2 + 1]! & 0x0f) * 17;
  }
  for (let copy = 1; copy < 8; copy++) palette.copyWithin(copy * MODE5_COLORS * 3, 0, MODE5_COLORS * 3);
  return palette;
}

/** Cinq plans consécutifs de 40 octets par ligne vers 320×200 indices. */
function mode5Pixels(planes: Uint8Array): Uint8Array {
  const pixels = new Uint8Array(SCREEN_PIXELS);
  for (let line = 0; line < SCREEN_HEIGHT; line++) {
    for (let col = 0; col < SCREEN_WIDTH / 8; col++) {
      for (let bit = 0; bit < 8; bit++) {
        let value = 0;
        for (let plane = 0; plane < MODE5_PLANES; plane++) {
          value |= ((planes[line * 40 + col + PLANE_BYTES * plane]! >> bit) & 1) << plane;
        }
        pixels[line * SCREEN_WIDTH + col * 8 + (7 - bit)] = value;
      }
    }
  }
  return pixels;
}

export function parseBackground(bytes: Uint8Array): Background {
  if (isPaletteOnly(bytes)) throw new Error("Fichier palette seule : utiliser parsePaletteOnly");
  if (bytes.length < 2) throw new Error("PI1 trop court");
  const mode = bytes[1]!;
  if (mode === 8) {
    if (bytes.length !== 2 + PALETTE_SIZE + SCREEN_PIXELS) throw new Error(`PI1 mode 8 : taille ${bytes.length} inattendue`);
    return { mode, palette: bytes.slice(2, 2 + PALETTE_SIZE), pixels: bytes.slice(2 + PALETTE_SIZE) };
  }
  if (mode === 5) {
    const paletteEnd = 2 + MODE5_COLORS * 2;
    if (bytes.length !== paletteEnd + PLANE_BYTES * MODE5_PLANES) throw new Error(`PI1 mode 5 : taille ${bytes.length} inattendue`);
    return { mode, palette: mode5Palette(bytes.subarray(2, paletteEnd)), pixels: mode5Pixels(bytes.subarray(paletteEnd)) };
  }
  throw new Error(`PI1 : mode ${mode} absent des données du jeu`);
}
