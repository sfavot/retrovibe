/**
 * Police `.FNT` (`SYSTEM.FNT`, `MED.FNT`) : en-tête, 120 descripteurs de glyphe et glyphes à deux plans (docs/croisiere/formats.md § 3.4).
 *
 * Référence : `engines/cruise/font.cpp` (`loadFNT`, `renderWord`, `getLineHeight`) et `dataLoader.cpp::loadFNTSub` de ScummVM (GPL v3+).
 * Le fichier commence par `"FNT\0"` ; la structure lue par le moteur démarre à l'octet 4, et tous les décalages internes s'y rapportent.
 *
 * Écarts volontaires : les champs sont lus en grand-boutiste sans réécrire le tampon ; un fichier dont les descripteurs ou les glyphes
 * sortent du fichier lève une erreur au lieu de lire hors tampon. Le placement du texte (césure, centrage, interligne) est du rendu,
 * il appartient à `render/` ; ce module ne donne que les glyphes et leurs métriques.
 */

const MAGIC = [0x46, 0x4e, 0x54, 0]; // "FNT\0"
const STRUCT_BASE = 4;
const INFO_SIZE = 14;
const ENTRY_SIZE = 12;
const MAX_GLYPH_WIDTH = 16;

export interface FontGlyph {
  /** Nombre de lignes (mots de 16 bits de masque, puis autant de mots de couleur). */
  readonly charHeight: number;
  /** Hauteur de référence de la ligne de base : le glyphe est posé à `y = height2 - charHeight + lineHeight`. */
  readonly height2: number;
  /** Largeur en pixels (≤ 16). */
  readonly charWidth: number;
  /** Champ `v1` du descripteur, inutilisé par le moteur. */
  readonly v1: number;
  /** Masque par ligne : bit 15 = pixel de gauche, 1 = pixel dessiné. */
  readonly masks: Uint16Array;
  /** Couleur par ligne : bit à 1 = index 2, à 0 = index 1 (le moteur remplace ensuite l'index par la couleur du texte). */
  readonly colors: Uint16Array;
}

export interface FontFile {
  /** Écart en pixels ajouté à l'avance de chaque caractère (−1 pour `SYSTEM.FNT`). */
  readonly hSpacing: number;
  /** Écart ajouté à l'interligne (−1 pour `SYSTEM.FNT`). */
  readonly vSpacing: number;
  /** Plus grande `charHeight` de la police (`getLineHeight`). */
  readonly lineHeight: number;
  readonly glyphs: readonly FontGlyph[];
}

export function parseFont(bytes: Uint8Array): FontFile {
  if (bytes.length < STRUCT_BASE + INFO_SIZE || MAGIC.some((b, i) => bytes[i] !== b)) throw new Error("Police : en-tête FNT absent");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const glyphsOffset = view.getUint32(STRUCT_BASE + 4);
  const numChars = view.getInt16(STRUCT_BASE + 8);
  const hSpacing = view.getInt16(STRUCT_BASE + 10);
  const vSpacing = view.getInt16(STRUCT_BASE + 12);
  if (numChars < 0 || STRUCT_BASE + INFO_SIZE + numChars * ENTRY_SIZE > bytes.length) throw new Error("Police : descripteurs hors du fichier");

  const glyphs: FontGlyph[] = [];
  let lineHeight = 0;
  for (let i = 0; i < numChars; i++) {
    const at = STRUCT_BASE + INFO_SIZE + i * ENTRY_SIZE;
    const offset = view.getUint32(at);
    const v1 = view.getInt16(at + 4);
    const charHeight = view.getInt16(at + 6);
    const height2 = view.getInt16(at + 8);
    const charWidth = view.getInt16(at + 10);
    const start = STRUCT_BASE + glyphsOffset + offset;
    if (charHeight < 0 || charWidth < 0 || charWidth > MAX_GLYPH_WIDTH || start + charHeight * 4 > bytes.length) {
      throw new Error(`Police : glyphe ${i} invalide`);
    }
    const masks = new Uint16Array(charHeight);
    const colors = new Uint16Array(charHeight);
    for (let row = 0; row < charHeight; row++) {
      masks[row] = view.getUint16(start + row * 2);
      colors[row] = view.getUint16(start + (charHeight + row) * 2);
    }
    glyphs.push({ charHeight, height2, charWidth, v1, masks, colors });
    lineHeight = Math.max(lineHeight, charHeight);
  }
  return { hSpacing, vSpacing, lineHeight, glyphs };
}

/**
 * Pixels d'un glyphe (`charWidth × charHeight`) tels que `renderWord` les écrit : 0 = non dessiné, 1 ou 2 = index de couleur
 * (`((couleur >> 15) & 1) + 1`).
 */
export function glyphPixels(glyph: FontGlyph): Uint8Array {
  const out = new Uint8Array(glyph.charWidth * glyph.charHeight);
  for (let y = 0; y < glyph.charHeight; y++) {
    for (let x = 0; x < glyph.charWidth; x++) {
      const bit = 15 - x;
      if ((glyph.masks[y]! >> bit) & 1) out[y * glyph.charWidth + x] = ((glyph.colors[y]! >> bit) & 1) + 1;
    }
  }
  return out;
}
