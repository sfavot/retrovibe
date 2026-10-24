/**
 * Polices bitmap Windows 3.x (`NCSCLB10.FON` … `NCSCLB24.FON`) : exécutable NE (16 bits) dont les ressources `RT_FONT` (type 8)
 * contiennent des polices « FNT » raster, version 2 (0x200) ou 3 (0x300). Détail dans `docs/mathemagique/graphics.md`.
 *
 * - En-tête NE : adresse à `e_lfanew` (octet 0x3c de l'en-tête MZ) ; table de ressources à l'offset `[NE + 0x24]` (relatif à l'en-tête NE) :
 *   u16 décalage d'alignement, puis des blocs `type u16 (| 0x8000 si entier), nombre u16, réservé u32`, suivis de `nombre` entrées
 *   `offset u16, longueur u16, drapeaux u16, id u16, réservé u32` (offset et longueur en unités de `1 << décalage`). Fin : type 0.
 * - FNT (little-endian) : version u16 @0, taille u32 @2, hauteur de points u16 @68, ascendant u16 @74, interligne interne @76 et externe @78,
 *   graisse u16 @83, jeu de caractères u8 @85, largeur de pixel u16 @86 (0 = proportionnelle), hauteur u16 @88, largeur moyenne u16 @91,
 *   largeur max u16 @93, premier / dernier / défaut / séparateur u8 @95–98, offset du nom de police u32 @105. Les offsets des glyphes sont absolus dans la ressource (le champ @113 n'est pas utilisé).
 *   Table des caractères dès l'octet 118 (v2 : `largeur u16, offset u16`) ou 148 (v3 : `largeur u16, offset u32`), `dernier - premier + 2`
 *   entrées (la dernière est la case « par défaut »). Un glyphe est stocké par **colonnes d'octets** : `⌈largeur / 8⌉` colonnes de `hauteur`
 *   octets, bit de poids fort à gauche.
 */

export interface FonGlyph {
  /** Avance horizontale (pixels). */
  width: number;
  /** `width × font.height` valeurs 0 / 1, ligne par ligne. */
  pixels: Uint8Array;
}

export interface FonFont {
  face: string;
  version: number;
  /** Taille en points de la ressource (10, 12, 14, 18, 24 pour les fichiers du jeu). */
  points: number;
  /** Hauteur de cellule (pixels). */
  height: number;
  ascent: number;
  internalLeading: number;
  externalLeading: number;
  weight: number;
  avgWidth: number;
  maxWidth: number;
  firstChar: number;
  lastChar: number;
  defaultChar: number;
  breakChar: number;
  /** Glyphe du code `code` (0–255), ou celui du caractère par défaut s'il est hors de la plage de la police. */
  glyph(code: number): FonGlyph;
  /** Le code fait-il partie de la plage `firstChar … lastChar` ? */
  has(code: number): boolean;
}

const RT_FONT = 8;
const NE_RESOURCE_TABLE = 0x24;

function readCString(bytes: Uint8Array, offset: number): string {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) end++;
  return String.fromCharCode(...bytes.subarray(offset, end));
}

/** Analyse une ressource FNT (v2 ou v3) déjà découpée. */
export function parseFnt(bytes: Uint8Array): FonFont {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(0, true);
  if (version !== 0x200 && version !== 0x300) throw new Error(`FON : version FNT inconnue (${version.toString(16)})`);
  const type = view.getUint16(66, true);
  if (type & 1) throw new Error("FON : police vectorielle non gérée");
  const height = view.getUint16(88, true);
  const firstChar = bytes[95]!;
  const lastChar = bytes[96]!;
  const defaultChar = bytes[97]!;
  const breakChar = bytes[98]!;
  const faceOffset = view.getUint32(105, true);
  const tableStart = version === 0x300 ? 148 : 118;
  const entrySize = version === 0x300 ? 6 : 4;
  const count = lastChar - firstChar + 1;

  const glyphs: FonGlyph[] = [];
  for (let i = 0; i < count + 1; i++) {
    const at = tableStart + i * entrySize;
    const width = view.getUint16(at, true);
    const offset = version === 0x300 ? view.getUint32(at + 2, true) : view.getUint16(at + 2, true);
    const pixels = new Uint8Array(width * height);
    const columns = (width + 7) >> 3;
    for (let column = 0; column < columns; column++) {
      for (let y = 0; y < height; y++) {
        const byte = bytes[offset + column * height + y] ?? 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = column * 8 + bit;
          if (x < width) pixels[y * width + x] = (byte >> (7 - bit)) & 1;
        }
      }
    }
    glyphs.push({ width, pixels });
  }
  const fallback = glyphs[defaultChar - firstChar] ?? glyphs[count]!;

  return {
    face: faceOffset > 0 && faceOffset < bytes.length ? readCString(bytes, faceOffset) : "",
    version,
    points: view.getUint16(68, true),
    height,
    ascent: view.getUint16(74, true),
    internalLeading: view.getUint16(76, true),
    externalLeading: view.getUint16(78, true),
    weight: view.getUint16(83, true),
    avgWidth: view.getUint16(91, true),
    maxWidth: view.getUint16(93, true),
    firstChar,
    lastChar,
    defaultChar,
    breakChar,
    glyph: (code) => (code >= firstChar && code <= lastChar ? glyphs[code - firstChar]! : fallback),
    has: (code) => code >= firstChar && code <= lastChar,
  };
}

/** Extrait les polices `RT_FONT` d'un fichier `.FON` (NE). Les fichiers du jeu en contiennent une seule. */
export function parseFon(bytes: Uint8Array): FonFont[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] !== 0x4d || bytes[1] !== 0x5a) throw new Error("FON : signature MZ absente");
  const ne = view.getUint32(0x3c, true);
  if (bytes[ne] !== 0x4e || bytes[ne + 1] !== 0x45) throw new Error("FON : signature NE absente");
  const tableStart = ne + view.getUint16(ne + NE_RESOURCE_TABLE, true);
  const shift = view.getUint16(tableStart, true);
  const fonts: FonFont[] = [];
  let at = tableStart + 2;
  for (;;) {
    const typeId = view.getUint16(at, true);
    if (typeId === 0) break;
    const count = view.getUint16(at + 2, true);
    at += 8;
    for (let i = 0; i < count; i++, at += 12) {
      if (typeId !== (0x8000 | RT_FONT)) continue;
      const offset = view.getUint16(at, true) << shift;
      const length = view.getUint16(at + 2, true) << shift;
      fonts.push(parseFnt(bytes.subarray(offset, offset + length)));
    }
  }
  if (fonts.length === 0) throw new Error("FON : aucune ressource RT_FONT");
  return fonts;
}
