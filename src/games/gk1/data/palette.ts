/**
 * Palettes SCI2 (`docs/gk1/formats.md` § 6) : ressources palette, bloc de fin des vues et des pics, tête des SEQ.
 *
 * Référence : `engines/sci/graphics/palette32.cpp` de ScummVM (`HunkPalette`), GPL v3 ou ultérieure, lu puis réécrit.
 *
 * ```
 * En-tête (13 octets) : u8 0x0E | … | u8 @10 nombre de palettes (1) | u16 0, puis un u16 par palette (taille de son entrée)
 * Entrée (22 octets)  : 10 octets non lus | u8 @10 première couleur | u16 @14 nombre de couleurs | u8 @16 « utilisée » commune
 *                       u8 @17 format (0 = 4 octets par couleur : utilisée, R, V, B ; 1 = 3 octets : R, V, B) | u32 @18 version
 * ```
 * Les octets 2 à 9 de l'en-tête et 0 à 9 de l'entrée changent d'une ressource à l'autre (mémoire non initialisée de l'outil
 * d'origine) : l'interpréteur ne les lit pas, et ce lecteur non plus. Composantes sur 8 bits (SCI32).
 *
 * Écart volontaire : une seule palette par bloc est acceptée (c'est le cas de tout le CD) ; ScummVM en lit aussi une seule.
 */
import { BinaryReader } from "../../../data/reader";

export const PALETTE_COLORS = 256;

const SIGNATURE = 0x0e;
const HEADER_SIZE = 13;
const COUNT_OFFSET = 10;
const ENTRY_HEADER_SIZE = 22;
const ENTRY_START_OFFSET = 10;
const ENTRY_COUNT_OFFSET = 14;

export interface Palette {
  /** Première couleur définie et nombre de couleurs définies. */
  readonly start: number;
  readonly count: number;
  /** Les drapeaux « utilisée » sont-ils communs (format à 3 octets) ? */
  readonly sharedUsed: boolean;
  readonly version: number;
  /** Par couleur : 0 = non définie par cette palette (à ne pas fusionner), sinon le drapeau du fichier. */
  readonly used: Uint8Array;
  /** 256 × `R, V, B`, 8 bits par composante ; zéro hors de `start … start + count − 1`. */
  readonly rgb: Uint8Array;
  /** Nombre d'octets du bloc (en-têtes et couleurs). */
  readonly byteLength: number;
}

/** Lit un bloc palette qui commence à `offset`. */
export function readPalette(bytes: Uint8Array, offset = 0): Palette {
  if (offset + HEADER_SIZE + 2 + ENTRY_HEADER_SIZE > bytes.length) throw new Error("GK1 : palette tronquée");
  if (bytes[offset] !== SIGNATURE) throw new Error("GK1 : palette sans signature 0x0E");
  const paletteCount = bytes[offset + COUNT_OFFSET];
  if (paletteCount !== 1) throw new Error(`GK1 : bloc de ${paletteCount} palettes non géré`);
  const entry = offset + HEADER_SIZE + 2 * paletteCount;
  const r = new BinaryReader(bytes);
  r.offset = entry + ENTRY_START_OFFSET;
  const start = r.u8();
  r.offset = entry + ENTRY_COUNT_OFFSET;
  const count = r.u16();
  const defaultUsed = r.u8();
  const sharedUsed = r.u8() !== 0;
  const version = r.u32();
  const bytesPerColor = sharedUsed ? 3 : 4;
  if (start + count > PALETTE_COLORS || r.offset + count * bytesPerColor > bytes.length) throw new Error("GK1 : couleurs de palette hors limites");

  const used = new Uint8Array(PALETTE_COLORS);
  const rgb = new Uint8Array(PALETTE_COLORS * 3);
  for (let i = start; i < start + count; i++) {
    used[i] = sharedUsed ? defaultUsed : r.u8();
    rgb[3 * i] = r.u8();
    rgb[3 * i + 1] = r.u8();
    rgb[3 * i + 2] = r.u8();
  }
  return { start, count, sharedUsed, version, used, rgb, byteLength: r.offset - offset };
}

/** 256 couleurs RGBA opaques (1 024 octets) pour un affichage direct, sans fusion ni variation. */
export function paletteToRgba(palette: Palette): Uint8Array {
  const out = new Uint8Array(PALETTE_COLORS * 4);
  for (let i = 0; i < PALETTE_COLORS; i++) {
    out[4 * i] = palette.rgb[3 * i];
    out[4 * i + 1] = palette.rgb[3 * i + 1];
    out[4 * i + 2] = palette.rgb[3 * i + 2];
    out[4 * i + 3] = 255;
  }
  return out;
}
