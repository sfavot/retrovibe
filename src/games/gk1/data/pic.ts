/**
 * Pics SCI2 (`docs/gk1/formats.md` § 5) : une pile de cels bitmap (fond, puis avant-plans avec priorité et position) et une palette.
 *
 * Référence : `engines/sci/graphics/celobj32.cpp` (`CelObjPic`) et `plane32.cpp` (`Plane::addPicInternal`) de ScummVM,
 * GPL v3 ou ultérieure, lus puis réécrits.
 *
 * ```
 * En-tête (14 octets) : u16 taille d'en-tête (14) | u8 nb cels | u8 @3 | u16 @4 taille d'un en-tête de cel (42) | u32 @6 offset de la palette
 *                       u16 @10, u16 @12 : résolution (0, 0 = 320×200)
 * Cel (42 octets)     : en-tête de cel commun (36 octets, `cel-rle.ts`) | i16 @36 priorité | i16 @38 x | i16 @40 y
 * ```
 * Écart volontaire : seule la résolution 320×200 est acceptée (les 158 pics du CD).
 */
import { BinaryReader } from "../../../data/reader";
import { CEL_HEADER_SIZE, type CelHeader, decodeCel, readCelHeader } from "./cel-rle";
import { type Palette, readPalette } from "./palette";

const PIC_HEADER_MIN_SIZE = 14;
const PIC_CEL_HEADER_SIZE = 42;

export interface PicCel extends CelHeader {
  /** Priorité du cel dans le plan : −1000 pour le fond, 1000 pour un cel toujours devant. */
  readonly priority: number;
  /** Position du coin haut gauche dans le pic. */
  readonly x: number;
  readonly y: number;
}

export interface Pic {
  readonly cels: readonly PicCel[];
  readonly palette: Palette | undefined;
  readonly paletteOffset: number;
  readonly headerSize: number;
  readonly celHeaderSize: number;
  readonly data: Uint8Array;
}

export function readPic(data: Uint8Array): Pic {
  if (data.length < PIC_HEADER_MIN_SIZE) throw new Error("GK1 : pic tronqué");
  const r = new BinaryReader(data);
  const headerSize = r.u16();
  const celCount = r.u8();
  r.offset = 4;
  const celHeaderSize = r.u16();
  const paletteOffset = r.u32();
  const resolutionX = r.u16();
  const resolutionY = r.u16();
  if (headerSize < PIC_HEADER_MIN_SIZE || celHeaderSize < PIC_CEL_HEADER_SIZE) throw new Error("GK1 : tailles d'en-têtes de pic inattendues");
  if (resolutionX !== 0 || resolutionY !== 0) throw new Error("GK1 : pic dans une résolution non gérée");
  const cels: PicCel[] = [];
  for (let c = 0; c < celCount; c++) {
    const offset = headerSize + c * celHeaderSize;
    const header = readCelHeader(data, offset);
    r.offset = offset + CEL_HEADER_SIZE;
    cels.push({ ...header, priority: r.i16(), x: r.i16(), y: r.i16() });
  }
  const palette = paletteOffset ? readPalette(data, paletteOffset) : undefined;
  return { cels, palette, paletteOffset, headerSize, celHeaderSize, data };
}

/** Pixels indexés d'un cel du pic. */
export function decodePicCel(pic: Pic, cel: number): Uint8Array {
  const header = pic.cels[cel];
  if (!header) throw new Error(`GK1 : cel de pic absent (${cel})`);
  return decodeCel(pic.data, header);
}
