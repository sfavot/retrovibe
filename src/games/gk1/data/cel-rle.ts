/**
 * Cels SCI2 : en-tête commun aux vues et aux pics, et décodage des pixels (`docs/gk1/formats.md` § 4, § 5).
 *
 * Référence : `engines/sci/graphics/celobj32.cpp` de ScummVM (`CelObjView`, `CelObjPic`, `READER_Compressed`,
 * `READER_Uncompressed`), GPL v3 ou ultérieure, lu puis réécrit.
 *
 * En-tête (36 octets ; un cel de pic en a 6 de plus, lus par `pic.ts`) :
 * `u16 largeur | u16 hauteur | i16 origine x | i16 origine y | u8 couleur transparente | u8 compression (0 ou 0x8A)`
 * `u16 drapeaux @10 | u32 @12 taille des données | u32 @16 taille du flux de contrôle | u32 @20 palette (0)`
 * `u32 @24 offset des données (flux de contrôle, ou pixels bruts) | u32 @28 offset des littéraux | u32 @32 offset de la table des lignes`
 *
 * RLE 0x8A, deux flux : octet de contrôle `c` ; bit 7 nul : copie `c` littéraux ; bits 7-6 = `10` : répète un littéral
 * `c & 0x3F` fois ; `11` : `c & 0x3F` pixels de la couleur transparente (aucun littéral lu). Chaque ligne finit exactement à la
 * largeur. La table des lignes donne `hauteur` offsets u32 dans le flux de contrôle puis `hauteur` dans les littéraux.
 *
 * **Blocs marqués** : dans une vue ou un pic, les en-têtes sont suivis de blocs précédés chacun d'un marqueur de 6 octets
 * `u8 0 | u8 étiquette | u32 taille` : 3 = palette, 4 = données des cels (flux de contrôle, littéraux ou pixels bruts),
 * 5 = tables des lignes (taille 0 ; absent si tous les cels sont bruts). L'interpréteur ne lit pas ces marqueurs (tout est
 * atteint par offset) ; `readBlockMarker` les expose pour vérifier qu'aucun octet ne reste inexpliqué.
 *
 * Drapeaux @10 (d'après ScummVM ; toujours 0 dans ce CD) : `0x80` = les deux bits suivants sont renseignés ; `0x01` = le cel contient des pixels
 * transparents ; `0x02` = il contient des couleurs de remplacement (`RemapColors`).
 *
 * Écarts volontaires : ScummVM décode ligne par ligne à la demande, par la table des lignes ; ici le cel entier est décodé
 * d'un trait, la table sert de contrôle (`CelUsage`) et reste disponible pour un dessin rogné. Un flux qui déborde lève une erreur.
 */
import { BinaryReader } from "../../../data/reader";
import { CEL_RAW, CEL_RLE } from "./ids";

export const CEL_HEADER_SIZE = 36;

/** Marqueur de bloc d'une vue ou d'un pic. */
export const BLOCK_MARKER_SIZE = 6;
export const BLOCK_PALETTE = 3;
export const BLOCK_CEL_DATA = 4;
export const BLOCK_ROW_TABLES = 5;

export interface BlockMarker {
  readonly tag: number;
  /** Taille du bloc qui suit (0 pour les tables des lignes ; modulo 65 536 pour les cels bruts de `RESOURCE.ALT`). */
  readonly size: number;
}

/** Marqueur de bloc à `offset`, ou `undefined` si les octets n'en ont pas la forme. */
export function readBlockMarker(resource: Uint8Array, offset: number): BlockMarker | undefined {
  if (offset + BLOCK_MARKER_SIZE > resource.length || resource[offset] !== 0) return undefined;
  const r = new BinaryReader(resource);
  r.offset = offset + 1;
  const tag = r.u8();
  return tag >= BLOCK_PALETTE && tag <= BLOCK_ROW_TABLES ? { tag, size: r.u32() } : undefined;
}

export const CEL_FLAGS_VALID = 0x80;
export const CEL_FLAG_HAS_SKIP = 0x01;
export const CEL_FLAG_HAS_REMAP = 0x02;

const CONTROL_RUN = 0x80;
const CONTROL_SKIP = 0x40;
const CONTROL_COUNT = 0x3f;
const ROW_TABLE_ENTRY_SIZE = 4;

export interface CelHeader {
  readonly width: number;
  readonly height: number;
  /**
   * Champs @4 et @6, tels que lus. Cel de vue : un **décalage**, l'ancrage dans le cel vaut `(largeur / 2 − originX,
   * hauteur − originY − 1)` (`render/cel.ts`, `formats.md` § 4). Cel de pic : l'ancrage lui-même, toujours (0, 0).
   */
  readonly originX: number;
  readonly originY: number;
  readonly skipColor: number;
  readonly compression: number;
  readonly flags: number;
  /** RLE : taille des deux flux (contrôle + littéraux). Brut : `largeur × hauteur`. */
  readonly dataSize: number;
  /** RLE : taille du flux de contrôle. */
  readonly controlSize: number;
  readonly paletteOffset: number;
  /** Offsets absolus dans la ressource. */
  readonly dataOffset: number;
  readonly literalOffset: number;
  readonly rowTableOffset: number;
}

export function readCelHeader(resource: Uint8Array, offset: number): CelHeader {
  if (offset + CEL_HEADER_SIZE > resource.length) throw new Error("GK1 : en-tête de cel hors de la ressource");
  const r = new BinaryReader(resource);
  r.offset = offset;
  const header: CelHeader = {
    width: r.u16(),
    height: r.u16(),
    originX: r.i16(),
    originY: r.i16(),
    skipColor: r.u8(),
    compression: r.u8(),
    flags: r.u16(),
    dataSize: r.u32(),
    controlSize: r.u32(),
    paletteOffset: r.u32(),
    dataOffset: r.u32(),
    literalOffset: r.u32(),
    rowTableOffset: r.u32(),
  };
  if (header.compression !== CEL_RAW && header.compression !== CEL_RLE) throw new Error(`GK1 : compression de cel ${header.compression} inconnue`);
  return header;
}

/** Octets de la ressource réellement lus pour un cel (contrôle des restes). */
export interface CelUsage {
  /** Octets de contrôle lus (RLE) ou de pixels (brut), à partir de `dataOffset`. */
  readonly dataUsed: number;
  /** Littéraux lus à partir de `literalOffset` (RLE). */
  readonly literalUsed: number;
  /** Taille de la table des lignes (RLE), 0 pour un cel brut. */
  readonly rowTableSize: number;
}

/** Pixels indexés du cel, `largeur × hauteur`, ligne par ligne ; les pixels transparents valent `skipColor`. */
export function decodeCel(resource: Uint8Array, header: CelHeader): Uint8Array {
  return decodeCelWithUsage(resource, header).pixels;
}

/** Comme `decodeCel`, avec le compte des octets lus ; vérifie la table des lignes d'un cel RLE. */
export function decodeCelWithUsage(resource: Uint8Array, header: CelHeader): { pixels: Uint8Array; usage: CelUsage } {
  const { width, height, dataOffset } = header;
  const size = width * height;
  if (header.compression === CEL_RAW) {
    if (dataOffset + size > resource.length) throw new Error("GK1 : cel brut hors de la ressource");
    return { pixels: resource.slice(dataOffset, dataOffset + size), usage: { dataUsed: size, literalUsed: 0, rowTableSize: 0 } };
  }

  const pixels = new Uint8Array(size);
  const rowTableSize = 2 * height * ROW_TABLE_ENTRY_SIZE;
  if (header.rowTableOffset + rowTableSize > resource.length) throw new Error("GK1 : table des lignes de cel hors de la ressource");
  const table = new BinaryReader(resource);
  let control = dataOffset;
  let literal = header.literalOffset;
  let o = 0;
  for (let y = 0; y < height; y++) {
    table.offset = header.rowTableOffset + y * ROW_TABLE_ENTRY_SIZE;
    const controlRow = table.u32();
    table.offset = header.rowTableOffset + (height + y) * ROW_TABLE_ENTRY_SIZE;
    const literalRow = table.u32();
    if (controlRow !== control - dataOffset || literalRow !== literal - header.literalOffset) throw new Error(`GK1 : table des lignes de cel incohérente (ligne ${y})`);
    const end = o + width;
    while (o < end) {
      if (control >= resource.length) throw new Error("GK1 : flux de contrôle de cel tronqué");
      const c = resource[control++];
      if ((c & CONTROL_RUN) === 0) {
        if (o + c > end || literal + c > resource.length) throw new Error("GK1 : copie de cel hors limites");
        pixels.set(resource.subarray(literal, literal + c), o);
        literal += c;
        o += c;
        continue;
      }
      const count = c & CONTROL_COUNT;
      if (o + count > end) throw new Error("GK1 : répétition de cel hors de la ligne");
      if (c & CONTROL_SKIP) {
        pixels.fill(header.skipColor, o, o + count);
      } else {
        if (literal >= resource.length) throw new Error("GK1 : littéraux de cel tronqués");
        pixels.fill(resource[literal++], o, o + count);
      }
      o += count;
    }
  }
  return { pixels, usage: { dataUsed: control - dataOffset, literalUsed: literal - header.literalOffset, rowTableSize } };
}
