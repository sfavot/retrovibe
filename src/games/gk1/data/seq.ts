/**
 * Cinématiques Sierra SEQ (`docs/gk1/formats.md` § 12) : images 320×200 indexées, sans son.
 *
 * Référence : `engines/sci/video/seq_decoder.cpp` de ScummVM, GPL v3 ou ultérieure, lu puis réécrit.
 *
 * ```
 * u16 nombre d'images | u32 taille de la palette | palette (`palette.ts`)
 * Image, en-tête de 36 octets : u16 largeur | u16 hauteur | u16 gauche | u16 haut | u8 couleur transparente | u8 type | u16 @10
 *                               u32 @12 taille des données | u32 @16 taille du flux de contrôle | … | u32 @24 offset absolu des données
 * ```
 * - Type 0 : `largeur × hauteur` octets bruts, posés en (gauche, haut).
 * - Autre type (11 ici) : différence avec l'image précédente. Les données sont un flux de contrôle suivi des littéraux ; le
 *   curseur part de (gauche, haut). Octet de contrôle `c` :
 *   - `11xxxxxx` : `x` = 0 : ligne suivante ; sinon saute `x` pixels ;
 *   - `10xxxxxx` : `x` = 0 : copie le reste de la ligne en littéraux, puis ligne suivante ; sinon copie `x` littéraux ;
 *   - `00tttnnn` + un octet : compte sur 11 bits `n` ; `t` = 2 : saute `n` pixels ; 3 : copie `n` littéraux ; 6 : copie `n` lignes
 *     entières ; 7 : saute `n` lignes (pour 6 et 7, `n` = 0 : jusqu'au bas du rectangle).
 *
 * Écarts volontaires : ScummVM lit les deux tailles sur 16 bits et continue après un débordement des littéraux ; ici elles
 * sont lues sur 32 bits (les mots hauts sont nuls) et toute écriture ou lecture hors limites lève une erreur. La cadence
 * n'est pas dans le fichier : elle vient de l'appel `ShowMovie`.
 */
import { BinaryReader } from "../../../data/reader";
import { SEQ_HEIGHT, SEQ_WIDTH } from "./ids";
import { type Palette, readPalette } from "./palette";

const FILE_HEADER_SIZE = 6;
const FRAME_HEADER_SIZE = 36;
const FRAME_SIZES_OFFSET = 12;
const FRAME_DATA_OFFSET = 24;

export const SEQ_FRAME_FULL = 0;

const OP_SHORT_SKIP = 0xc0;
const OP_SHORT_COPY = 0x80;
const OP_SHORT_COUNT = 0x3f;
const OP_LONG_SKIP = 2;
const OP_LONG_COPY = 3;
const OP_COPY_ROWS = 6;
const OP_SKIP_ROWS = 7;

export interface SeqFrame {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly colorKey: number;
  /** `SEQ_FRAME_FULL` = image brute ; sinon différence. */
  readonly type: number;
  /** Différence : taille du flux de contrôle et des littéraux. Image brute : `width × height`. */
  readonly dataSize: number;
  readonly controlSize: number;
  /** Offset absolu des données dans le fichier. */
  readonly dataOffset: number;
}

export interface Seq {
  readonly palette: Palette;
  readonly frames: readonly SeqFrame[];
  readonly data: Uint8Array;
}

/** Lit l'en-tête, la palette et les en-têtes de toutes les images ; vérifie que la dernière finit à la fin du fichier. */
export function readSeq(data: Uint8Array): Seq {
  if (data.length < FILE_HEADER_SIZE) throw new Error("GK1 : SEQ tronqué");
  const r = new BinaryReader(data);
  const frameCount = r.u16();
  const paletteSize = r.u32();
  const palette = readPalette(data, FILE_HEADER_SIZE);
  if (palette.byteLength !== paletteSize) throw new Error("GK1 : palette de SEQ de taille incohérente");
  const frames: SeqFrame[] = [];
  let offset = FILE_HEADER_SIZE + paletteSize;
  for (let i = 0; i < frameCount; i++) {
    if (offset + FRAME_HEADER_SIZE > data.length) throw new Error(`GK1 : en-tête de l'image SEQ ${i} hors du fichier`);
    r.offset = offset;
    const width = r.u16();
    const height = r.u16();
    const left = r.u16();
    const top = r.u16();
    const colorKey = r.u8();
    const type = r.u8();
    r.offset = offset + FRAME_SIZES_OFFSET;
    const announced = r.u32();
    const controlSize = r.u32();
    r.offset = offset + FRAME_DATA_OFFSET;
    const dataOffset = r.u32();
    const dataSize = type === SEQ_FRAME_FULL ? width * height : announced;
    if (dataOffset !== offset + FRAME_HEADER_SIZE || dataOffset + dataSize > data.length) throw new Error(`GK1 : données de l'image SEQ ${i} mal placées`);
    if (left + width > SEQ_WIDTH || top + height > SEQ_HEIGHT) throw new Error(`GK1 : image SEQ ${i} hors de la toile`);
    if (type !== SEQ_FRAME_FULL && controlSize > dataSize) throw new Error(`GK1 : flux de contrôle de l'image SEQ ${i} trop long`);
    frames.push({ width, height, left, top, colorKey, type, dataSize, controlSize, dataOffset });
    offset = dataOffset + dataSize;
  }
  if (offset !== data.length) throw new Error("GK1 : octets inexpliqués à la fin du SEQ");
  return { palette, frames, data };
}

/** Toile vierge (320 × 200 indices nuls) pour `decodeSeqFrame`. */
export function createSeqCanvas(): Uint8Array {
  return new Uint8Array(SEQ_WIDTH * SEQ_HEIGHT);
}

/**
 * Pose l'image `index` sur `canvas` (qui doit contenir l'image précédente). Renvoie le nombre d'octets de contrôle et de
 * littéraux lus (contrôle des restes : ils valent `controlSize` et `dataSize − controlSize`).
 */
export function decodeSeqFrame(seq: Seq, index: number, canvas: Uint8Array): { controlUsed: number; literalUsed: number } {
  const frame = seq.frames[index];
  if (!frame) throw new Error(`GK1 : image SEQ absente (${index})`);
  if (canvas.length !== SEQ_WIDTH * SEQ_HEIGHT) throw new Error("GK1 : toile SEQ de taille inattendue");
  const { width, height, left, top, dataOffset } = frame;
  const data = seq.data;

  if (frame.type === SEQ_FRAME_FULL) {
    for (let y = 0; y < height; y++) {
      const row = dataOffset + y * width;
      canvas.set(data.subarray(row, row + width), (top + y) * SEQ_WIDTH + left);
    }
    return { controlUsed: 0, literalUsed: width * height };
  }

  const controlEnd = dataOffset + frame.controlSize;
  const literalEnd = dataOffset + frame.dataSize;
  let control = dataOffset;
  let literal = controlEnd;
  let row = 0;
  let col = 0;
  const copy = (count: number): void => {
    if (row >= height || col + count > width) throw new Error(`GK1 : image SEQ ${index} : écriture hors du rectangle`);
    if (literal + count > literalEnd) throw new Error(`GK1 : image SEQ ${index} : littéraux épuisés`);
    canvas.set(data.subarray(literal, literal + count), (top + row) * SEQ_WIDTH + left + col);
    literal += count;
  };
  const operand = (): number => {
    if (control >= controlEnd) throw new Error(`GK1 : image SEQ ${index} : flux de contrôle tronqué`);
    return data[control++];
  };

  while (control < controlEnd) {
    const op = data[control++];
    if ((op & OP_SHORT_SKIP) === OP_SHORT_SKIP) {
      const count = op & OP_SHORT_COUNT;
      if (count === 0) {
        row++;
        col = 0;
      } else {
        col += count;
      }
    } else if (op & OP_SHORT_COPY) {
      const count = op & OP_SHORT_COUNT;
      if (count === 0) {
        copy(width - col);
        row++;
        col = 0;
      } else {
        copy(count);
        col += count;
      }
    } else {
      let count = ((op & 7) << 8) | operand();
      switch (op >> 3) {
        case OP_LONG_SKIP:
          col += count;
          break;
        case OP_LONG_COPY:
          copy(count);
          col += count;
          break;
        case OP_COPY_ROWS:
          if (count === 0) count = height - row;
          for (let i = 0; i < count; i++) {
            copy(width);
            row++;
          }
          break;
        case OP_SKIP_ROWS:
          if (count === 0) count = height - row;
          row += count;
          break;
        default:
          throw new Error(`GK1 : image SEQ ${index} : opération ${op >> 3} inconnue`);
      }
    }
  }
  return { controlUsed: control - dataOffset, literalUsed: literal - controlEnd };
}

/** Décode toutes les images dans l'ordre ; la même toile est rendue à chaque étape (la copier pour la garder). */
export function* decodeSeqFrames(seq: Seq): Generator<Uint8Array> {
  const canvas = createSeqCanvas();
  for (let i = 0; i < seq.frames.length; i++) {
    decodeSeqFrame(seq, i, canvas);
    yield canvas;
  }
}
