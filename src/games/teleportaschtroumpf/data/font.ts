/**
 * Police `.PFN` : police bitmap monochrome à chasse variable, glyphes rangés côte à côte
 * dans une seule bande de pixels. Format établi par la RE de SMURF.EXE (voir
 * `docs/teleportaschtroumpf/pfn.md`) : `32f4:0123` (sélection), `32f4:0018` (dessin),
 * `32f4:0192` (mesure).
 */

/** Largeur d'un glyphe de largeur 0 (espace) et espacement entre glyphes (immédiats de `32f4:00d8` et `32f4:00c8`). */
export const SPACE_WIDTH = 2;
export const LETTER_SPACING = 1;

const HEADER_BYTES = 8;

export interface PfnGlyph {
  /** Largeur en pixels, 0 à 15. 0 = glyphe vide (le jeu avance alors de `SPACE_WIDTH`, sans rien dessiner). */
  width: number;
  /** `width * height` octets, ligne par ligne : 1 = encre, 0 = transparent. Vide si `width` vaut 0. */
  bitmap: Uint8Array;
}

export interface PfnFont {
  height: number;
  /** Code du premier glyphe de la table (0x20 pour les polices S52, 0x01 pour S40A001F). */
  firstChar: number;
  /** Clé = code CP437. Les codes hors de la table n'ont pas de glyphe. */
  glyphs: Map<number, PfnGlyph>;
}

/**
 * En-tête de 8 octets :
 * - 0 : u8 code du premier caractère (l'octet 1 est ignoré par le jeu, 0 partout) ;
 * - 2 : u8 hauteur ;
 * - 3 : u8 octets par ligne de la bande (`stride`) ; si 0, repris du u16 little-endian de l'offset 4 ;
 * - 6 : u16 big-endian, offset de la table des glyphes (= 8 + hauteur * stride).
 *
 * Bande : `height` lignes de `stride` octets, bits de poids fort en premier.
 * Table : une entrée de 2 octets par caractère jusqu'à la fin du fichier, u16 big-endian :
 * 4 bits de poids fort = largeur, 12 bits suivants = abscisse (en bits) du glyphe dans la bande.
 */
export function parsePfn(bytes: Uint8Array): PfnFont {
  if (bytes.length < HEADER_BYTES) throw new Error(`PFN invalide : ${bytes.length} octets, en-tête incomplet`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const firstChar = bytes[0];
  const height = bytes[2];
  const stride = bytes[3] !== 0 ? bytes[3] : view.getUint16(4, true);
  const tableOffset = view.getUint16(6, false);
  if (height === 0 || stride === 0) throw new Error("PFN invalide : hauteur ou ligne nulle");
  if (tableOffset !== HEADER_BYTES + height * stride) {
    throw new Error(`PFN invalide : table à ${tableOffset}, attendu ${HEADER_BYTES + height * stride}`);
  }
  const tableBytes = bytes.length - tableOffset;
  if (tableBytes < 0 || tableBytes % 2 !== 0) throw new Error("PFN invalide : table tronquée");
  const count = tableBytes / 2;
  if (firstChar + count > 256) throw new Error("PFN invalide : plus de 256 caractères");

  const glyphs = new Map<number, PfnGlyph>();
  for (let i = 0; i < count; i++) {
    const entry = view.getUint16(tableOffset + i * 2, false);
    const width = entry >> 12;
    const x0 = entry & 0xfff;
    const bitmap = new Uint8Array(width * height);
    if (x0 + width > stride * 8) {
      throw new Error(`PFN invalide : glyphe ${firstChar + i} hors de la bande`);
    }
    for (let y = 0; y < height && width > 0; y++) {
      const row = HEADER_BYTES + y * stride;
      for (let x = 0; x < width; x++) {
        const bit = x0 + x;
        bitmap[y * width + x] = (bytes[row + (bit >> 3)] >> (7 - (bit & 7))) & 1;
      }
    }
    glyphs.set(firstChar + i, { width, bitmap });
  }
  return { height, firstChar, glyphs };
}

/** Avance d'un caractère, comme `32f4:0018` : largeur + 1 (un glyphe vide ou absent vaut `SPACE_WIDTH` + 1). */
export function advance(font: PfnFont, code: number): number {
  const width = font.glyphs.get(code)?.width ?? 0;
  return (width === 0 ? SPACE_WIDTH : width) + LETTER_SPACING;
}

/** Largeur en pixels d'un texte CP437, comme `32f4:0192` (s'arrête au premier octet nul). */
export function measureText(font: PfnFont, bytes: Uint8Array): number {
  let total = 0;
  for (const code of bytes) {
    if (code === 0) break;
    total += advance(font, code);
  }
  return total;
}
