/**
 * Police du jeu `TEXTE.DAT` (78 glyphes) et table des largeurs.
 *
 * Référence : ScummVM engines/cine/texte.cpp (`loadTextData`, `fontParamTable_standard`) et texte.h (`FONT_WIDTH`, `FONT_HEIGHT`,
 * `NUM_FONT_CHARS`) (GPL v3 ou ultérieure). Format : taille d'entrée (u16, 8), nombre d'entrées (u16, 624), puis 78 glyphes de 64 octets :
 * 8 lignes de 16 pixels planaires. Un glyphe est dessiné sur 16 pixels de large avec une largeur utile propre à chaque code. docs/voyageurs/formats.md § 4.2.
 *
 * Écarts volontaires : seule la table « standard » (police française, 78 glyphes) est portée, pas `fontParamTable_alt` (allemand, 85 glyphes) ;
 * `loadRelatedPalette(TEXTE.DAT)` n'est pas reproduit (palette jamais lue) ; la taille du fichier est vérifiée au lieu d'un simple avertissement.
 * Le code d'un message est son octet CP437 brut (`Message.raw`) : 0x82 é, 0x85 à, 0x87 ç, 0x88 et 0x97 ê, 0x8A è.
 */
import { BinaryReader } from "../../../data/reader";
import { planarToIndexed } from "./planar";

export const FONT_WIDTH = 16;
export const FONT_HEIGHT = 8;
export const NUM_FONT_CHARS = 256;

/** `fontParamTable_standard` : par code d'octet, couple (numéro de glyphe, largeur utile). Largeur 0 = rien à dessiner. */
const FONT_PARAMS_STANDARD: readonly number[] = [
  0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0,
  0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0,
  0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0,
  0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0,
  0,0, 63,1, 69,5, 0,0, 0,0, 0,0, 0,0, 68,3,
  64,3, 65,3, 0,0, 0,0, 62,2, 74,6, 66,1, 67,6,
  52,6, 53,6, 54,6, 55,6, 56,6, 57,6, 58,6, 59,6,
  60,6, 61,6, 76,3, 0,0, 0,0, 0,0, 0,0, 75,6,
  0,0, 0,6, 1,6, 2,6, 3,6, 4,6, 5,6, 6,6,
  7,6, 8,3, 9,6, 10,6, 11,6, 12,7, 13,6, 14,6,
  15,6, 16,6, 17,6, 18,6, 19,6, 20,6, 21,6, 22,7,
  23,6, 24,6, 25,6, 0,0, 0,0, 0,0, 0,0, 0,0,
  0,0, 26,6, 27,6, 28,5, 29,6, 30,6, 31,5, 32,6,
  33,6, 34,4, 35,4, 36,5, 37,3, 38,7, 39,6, 40,6,
  41,6, 42,6, 43,6, 44,6, 45,6, 46,6, 47,6, 48,7,
  49,6, 50,6, 51,6, 0,0, 0,0, 0,0, 0,0, 0,0,
  0,0, 0,0, 70,6, 0,0, 0,0, 72,6, 0,0, 73,5,
  77,6, 0,0, 71,6, 0,0, 0,0, 0,0, 0,0, 0,0,
  0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 77,6,
  0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0,
  0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0,
  0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0,
  0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0,
  0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0,
  0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0,
  0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0,
  0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0,
  0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0,
  0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0,
  0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0,
  0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0,
  0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0,
];

export interface CharacterEntry {
  readonly glyph: number;
  readonly width: number;
}

export interface FontGlyph {
  /** `FONT_WIDTH x FONT_HEIGHT` indices de couleur (0 = fond). */
  readonly pixels: Uint8Array;
  /** 1 là où le pixel vaut 0 (`generateMask(…, 0)`). */
  readonly mask: Uint8Array;
}

export interface Font {
  readonly glyphs: readonly FontGlyph[];
}

/** `fontParamTable_standard[code]`. */
export function fontCharacterEntry(code: number): CharacterEntry {
  if (!Number.isInteger(code) || code < 0 || code >= NUM_FONT_CHARS) return { glyph: 0, width: 0 };
  return { glyph: FONT_PARAMS_STANDARD[code * 2]!, width: FONT_PARAMS_STANDARD[code * 2 + 1]! };
}

export function readFont(data: Uint8Array): Font {
  const reader = new BinaryReader(data);
  const entrySize = reader.u16be();
  const entryCount = reader.u16be();
  if (entrySize === 0) throw new RangeError("TEXTE.DAT : taille d'entrée nulle");
  const fontDataSize = entryCount * entrySize;
  const numChars = Math.floor(entryCount / entrySize);
  const bytesPerChar = numChars === 0 ? 0 : fontDataSize / numChars;
  if (numChars === 0 || numChars > NUM_FONT_CHARS || bytesPerChar !== (FONT_WIDTH / 2) * FONT_HEIGHT) {
    throw new RangeError(`TEXTE.DAT : ${numChars} glyphes de ${bytesPerChar} octets non gérés`);
  }
  if (4 + fontDataSize !== data.length) throw new RangeError(`TEXTE.DAT : taille ${data.length} incorrecte (${4 + fontDataSize} attendus)`);
  const glyphs: FontGlyph[] = [];
  for (let i = 0; i < numChars; i++) {
    const pixels = planarToIndexed(data, 4 + i * bytesPerChar, FONT_WIDTH / 2, FONT_HEIGHT);
    const mask = new Uint8Array(pixels.length);
    for (let p = 0; p < pixels.length; p++) mask[p] = pixels[p] === 0 ? 1 : 0;
    glyphs.push({ pixels, mask });
  }
  return { glyphs };
}
