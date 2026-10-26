/**
 * Police du jeu (blocs 507 et 508 de `GLOBAL.BD`) et format des sprites RLE à 4 plans dont elle fait partie (voir docs/swiv3d/global-bd.md).
 *
 * Sprite RLE (blitters `gm_blit_rle_glyph_a` 0041508b et `FUN_00414c7e`, rendu logiciel en mode X) : un bloc commence par une table
 * d'offsets u32 (relatifs au début du bloc), un par sprite. Chaque sprite est une suite de 4 flux, un par plan VGA (le plan `k` porte
 * les pixels de colonnes `4·c + k`) ; les flux parcourent une mémoire de 80 octets par ligne et par plan (écran de 320 pixels) :
 *   - `0x80 | n` (n ≠ 0) : saute n octets ; `0x80` suivi d'un u16 : saute ce nombre d'octets ; `0xff` : fin du plan ;
 *   - `longueur << 4 | teinte` (octet < 0x80) : `longueur` pixels de teinte `teinte` ; longueur 0 : la banque devient `teinte << 4`.
 * Un pixel n'est pas une couleur : c'est le numéro de ligne `banque + teinte` de la table de mélange 256×256 (bloc 800), et la couleur
 * affichée est `table[ligne << 8 | pixel_déjà_présent]`. Les lignes 0xe0-0xef et 0x70-0x7f forment des dégradés de fondu.
 *
 * Police : bloc 507 = table de 384 offsets puis les glyphes ; bloc 508 = 384 largeurs u32 (avance en pixels). L'index d'un glyphe est
 * le caractère pour les codes 0-126, `0` pour 127 et `page·128 + code` pour 128-255 (`gm_set_language` 0046f1e8) ; `page` est le chiffre
 * de la langue (voir `StringTables.glyphPages`).
 */
import { BinaryReader } from "../../../data/reader";
import type { BdArchive } from "./bd";

export const FONT_GLYPHS_BLOCK = 507;
export const FONT_WIDTHS_BLOCK = 508;
export const GLYPH_COUNT = 384;

/** Octets par ligne de plan dans la mémoire d'écran du mode X : 320 pixels / 4 plans. */
const PLANE_STRIDE = 80;

/** Valeur de `RleSprite.rows` pour un pixel que le sprite ne touche pas. */
export const TRANSPARENT = -1;

export interface RleSprite {
  /** Position du coin haut-gauche du rectangle englobant, relative au point de dessin (le flux saute depuis ce point). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** `width × height` numéros de ligne de la table de mélange (banque + teinte, 0-255), ou `TRANSPARENT`. */
  rows: Int16Array;
}

/** Décode le sprite qui commence à `offset` dans `block`. */
export function decodeRleSprite(block: Uint8Array, offset: number): RleSprite {
  const r = new BinaryReader(block);
  r.offset = offset;
  const pixels: { x: number; y: number; row: number }[] = [];
  let bank = 0;
  for (let plane = 0; plane < 4; plane++) {
    let address = 0;
    for (;;) {
      const op = r.u8();
      if (op === 0xff) break;
      if (op === 0x80) address += r.u16();
      else if (op & 0x80) address += op & 0x7f;
      else {
        const length = op >> 4;
        const shade = op & 0xf;
        if (length === 0) bank = shade << 4;
        for (let i = 0; i < length; i++, address++) {
          pixels.push({ x: (address % PLANE_STRIDE) * 4 + plane, y: Math.floor(address / PLANE_STRIDE), row: bank + shade });
        }
      }
    }
  }
  if (pixels.length === 0) return { x: 0, y: 0, width: 0, height: 0, rows: new Int16Array(0) };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pixels) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const x = minX;
  const y = minY;
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const rows = new Int16Array(width * height).fill(TRANSPARENT);
  for (const p of pixels) rows[(p.y - y) * width + (p.x - x)] = p.row;
  return { x, y, width, height, rows };
}

/** Nombre de sprites d'un bloc : la table d'offsets s'arrête là où commence le premier sprite. */
export function rleSpriteCount(block: Uint8Array): number {
  return new BinaryReader(block).u32() / 4;
}

/** Décode tous les sprites d'un bloc à table d'offsets (blocs 501, 510, 511, 512 et la police 507). */
export function parseRleSprites(block: Uint8Array, count = rleSpriteCount(block)): RleSprite[] {
  const r = new BinaryReader(block);
  return Array.from({ length: count }, (_, i) => {
    r.offset = i * 4;
    return decodeRleSprite(block, r.u32());
  });
}

export interface Glyph extends RleSprite {
  /** Largeur d'avance en pixels (bloc 508). */
  advance: number;
}

export interface Font {
  /** Les 384 glyphes : 0-127 communs, 128-255 page 0, 256-383 page 1. */
  glyphs: Glyph[];
  /** Index du glyphe d'un octet de texte pour une page de glyphes donnée. */
  glyphIndex(code: number, page?: number): number;
  /** Largeur en pixels d'un texte (somme des avances), comme `gm_text_width`. */
  measure(text: Uint8Array, page?: number): number;
}

export function parseFont(bd: BdArchive): Font {
  const sprites = parseRleSprites(bd.get(FONT_GLYPHS_BLOCK), GLYPH_COUNT);
  const widths = new BinaryReader(bd.get(FONT_WIDTHS_BLOCK));
  const glyphs = sprites.map((sprite) => ({ ...sprite, advance: widths.u32() }));
  const glyphIndex = (code: number, page = 0): number => (code < 0x7f ? code : code < 0x80 ? 0 : page * 0x80 + code);
  return {
    glyphs,
    glyphIndex,
    measure: (text, page = 0) => text.reduce((sum, code) => sum + glyphs[glyphIndex(code, page)]!.advance, 0),
  };
}

/** Dessine un texte dans une image à numéros de ligne : retourne `width × height` valeurs (`TRANSPARENT` hors des glyphes). */
export function renderText(font: Font, text: Uint8Array, page = 0): { width: number; height: number; rows: Int16Array } {
  const placed = Array.from(text, (code) => font.glyphs[font.glyphIndex(code, page)]!);
  const total = placed.reduce((sum, g) => sum + g.advance, 0);
  const top = Math.min(0, ...placed.filter((g) => g.width > 0).map((g) => g.y));
  const bottom = Math.max(0, ...placed.filter((g) => g.width > 0).map((g) => g.y + g.height));
  const width = Math.max(total, ...placed.map((g, i) => placed.slice(0, i).reduce((s, p) => s + p.advance, 0) + g.x + g.width));
  const height = bottom - top;
  const rows = new Int16Array(width * height).fill(TRANSPARENT);
  let pen = 0;
  for (const g of placed) {
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        const row = g.rows[y * g.width + x]!;
        if (row !== TRANSPARENT) rows[(g.y + y - top) * width + pen + g.x + x] = row;
      }
    }
    pen += g.advance;
  }
  return { width, height, rows };
}
