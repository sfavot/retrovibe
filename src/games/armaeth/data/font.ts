import { BinaryReader } from "../../../data/reader";

/** Nombre d'entrées de la table des glyphes (un mot par code de caractère CP437). */
export const GPH_GLYPH_SLOTS = 256;

/** Glyphe d'un caractère. */
export interface GphGlyph {
  /** Code du caractère demandé. */
  code: number;
  /** Largeur en pixels, quartet haut du mot (aussi l'avance, avant l'espacement entre lettres). */
  width: number;
  /** Première et dernière lignes de la cellule portant de l'encre (octet d'en-tête : quartet haut, quartet bas). */
  firstRow: number;
  lastRow: number;
  /** Une valeur par ligne de `firstRow` à `lastRow`, bit 0 = pixel le plus à gauche. */
  rows: Uint8Array;
}

export interface GphFont {
  /** Largeur et hauteur de la cellule (5 × 7). */
  cellWidth: number;
  cellHeight: number;
  /** Mots de la table : quartet haut = largeur, 12 bits bas = offset dans les données ; 0 = pas de glyphe. */
  offsets: Uint16Array;
  /** Données des glyphes (718 octets). */
  data: Uint8Array;
  /** Glyphe d'un code ; un code sans glyphe prend celui du code 0 (blanc de largeur 2), comme le dessin du jeu. */
  glyph(code: number): GphGlyph;
  /** Largeur du texte : somme `largeur + spacing` des glyphes, moins un `spacing` final (`FUN_325a_01ac`) ; 0 si le texte est vide. */
  measure(text: Uint8Array, spacing?: number): number;
  /** Bitmap `width × cellHeight` du glyphe (1 = encre). */
  bitmap(code: number): Uint8Array;
}

/**
 * `A1FGPH.SYS` (`gm_load_gph` `325a:0002`, dessin `327a:0044` / `32e1:00a2`) : `u16` largeur de cellule,
 * `u16` hauteur, `u16` taille des données, 256 mots d'offsets puis les glyphes. Un glyphe : un octet
 * `(première ligne << 4) | dernière ligne` puis une valeur par ligne, bit 0 = pixel de gauche.
 */
export function parseGph(bytes: Uint8Array): GphFont {
  const r = new BinaryReader(bytes);
  const cellWidth = r.u16();
  const cellHeight = r.u16();
  const dataSize = r.u16();
  if (6 + 2 * GPH_GLYPH_SLOTS + dataSize !== bytes.length) {
    throw new Error(`GPH invalide : ${dataSize} octets de données pour ${bytes.length} octets`);
  }
  const offsets = new Uint16Array(GPH_GLYPH_SLOTS);
  for (let i = 0; i < GPH_GLYPH_SLOTS; i++) offsets[i] = r.u16();
  const data = r.bytesView(dataSize);
  if (offsets[0] === 0) throw new Error("GPH invalide : pas de glyphe de repli (code 0)");

  const glyph = (code: number): GphGlyph => {
    const word = offsets[code] || offsets[0];
    const at = word & 0xfff;
    const header = data[at];
    const firstRow = header >> 4;
    const lastRow = header & 15;
    if (lastRow < firstRow || lastRow >= cellHeight || at + 1 + (lastRow - firstRow + 1) > data.length) {
      throw new Error(`GPH invalide : glyphe ${code} hors limites`);
    }
    return { code, width: word >> 12, firstRow, lastRow, rows: data.subarray(at + 1, at + 1 + lastRow - firstRow + 1) };
  };
  // Validation de tous les glyphes à la lecture.
  for (let code = 0; code < GPH_GLYPH_SLOTS; code++) glyph(code);

  return {
    cellWidth,
    cellHeight,
    offsets,
    data,
    glyph,
    measure(text, spacing = 0) {
      let total = 0;
      for (const code of text) total += glyph(code).width + spacing;
      return total === 0 ? 0 : total - spacing;
    },
    bitmap(code) {
      const g = glyph(code);
      const out = new Uint8Array(g.width * cellHeight);
      g.rows.forEach((bits, i) => {
        for (let x = 0; x < g.width; x++) out[(g.firstRow + i) * g.width + x] = (bits >> x) & 1;
      });
      return out;
    },
  };
}
