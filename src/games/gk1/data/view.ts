/**
 * Vues SCI2 (`docs/gk1/formats.md` § 4, § 13) : boucles de cels, palette embarquée.
 *
 * Référence : `engines/sci/graphics/celobj32.cpp` de ScummVM (`CelObjView`), GPL v3 ou ultérieure, lu puis réécrit.
 *
 * ```
 * En-tête : u16 taille d'en-tête (16, sans ce champ) | u8 nb boucles | u8 @3 | u8 @4 | u8 @5 résolution (0 = 320×200, 1 = 640×480, 2 = 640×400)
 *           u16 @6 nb cels au total | u32 @8 offset de la palette | u8 @12 taille d'un en-tête de boucle (16) | u8 @13 taille d'un en-tête de cel (36)
 *           u16 @14, u16 @16 : résolution explicite (0 ici)
 * Boucle  : i8 boucle source (−1 = aucune) | u8 miroir | u8 nb cels | … | u32 @12 offset des en-têtes de cels
 * ```
 * Une boucle dont la source n'est pas −1 n'a pas de cels propres : elle montre ceux de la boucle source, retournés
 * horizontalement si son octet « miroir » vaut 1. `readView` résout ce renvoi (`cels` est partagé, `mirrored` dit de retourner).
 *
 * Écart volontaire : ScummVM relit l'en-tête à chaque cel demandé ; ici la vue est décrite une fois, les pixels sont
 * décodés à la demande par `decodeViewCel`.
 */
import { BinaryReader } from "../../../data/reader";
import { CEL_HEADER_SIZE, type CelHeader, decodeCel, readCelHeader } from "./cel-rle";
import { LOOP_NOT_MIRRORED } from "./ids";
import { type Palette, readPalette } from "./palette";

const LOOP_CELS_OFFSET = 12;
const MIN_LOOP_HEADER_SIZE = 16;

export interface ViewLoop {
  /** Boucle dont viennent les cels, ou `undefined` si la boucle a les siens. */
  readonly source: number | undefined;
  /** Les cels se dessinent-ils retournés horizontalement ? */
  readonly mirrored: boolean;
  /** En-têtes des cels (ceux de la boucle source pour un renvoi). */
  readonly cels: readonly CelHeader[];
}

export interface View {
  /** Octet de résolution (`VIEW_RESOLUTION_*`). */
  readonly resolution: number;
  /** Nombre de cels annoncé par l'en-tête (boucles miroirs non comptées). */
  readonly celCount: number;
  readonly loops: readonly ViewLoop[];
  readonly palette: Palette | undefined;
  readonly paletteOffset: number;
  /** Tailles lues dans l'en-tête (contrôle des restes). */
  readonly headerSize: number;
  readonly loopHeaderSize: number;
  readonly celHeaderSize: number;
  readonly data: Uint8Array;
}

export function readView(data: Uint8Array): View {
  const r = new BinaryReader(data);
  if (data.length < 18) throw new Error("GK1 : vue tronquée");
  const headerSize = r.u16() + 2;
  const loopCount = r.u8();
  r.offset = 5;
  const resolution = r.u8();
  const celCount = r.u16();
  const paletteOffset = r.u32();
  const loopHeaderSize = r.u8();
  const celHeaderSize = r.u8();
  if (loopHeaderSize < MIN_LOOP_HEADER_SIZE || celHeaderSize < CEL_HEADER_SIZE) throw new Error("GK1 : tailles d'en-têtes de vue inattendues");
  if (headerSize + loopCount * loopHeaderSize > data.length) throw new Error("GK1 : boucles de vue hors de la ressource");

  const raw: { source: number; mirror: number; cels: CelHeader[] }[] = [];
  for (let l = 0; l < loopCount; l++) {
    r.offset = headerSize + l * loopHeaderSize;
    const source = r.u8();
    const mirror = r.u8();
    const count = r.u8();
    r.offset = headerSize + l * loopHeaderSize + LOOP_CELS_OFFSET;
    const celsOffset = r.u32();
    const cels: CelHeader[] = [];
    if (source === LOOP_NOT_MIRRORED) for (let c = 0; c < count; c++) cels.push(readCelHeader(data, celsOffset + c * celHeaderSize));
    raw.push({ source, mirror, cels });
  }
  const loops = raw.map(({ source, mirror, cels }): ViewLoop => {
    if (source === LOOP_NOT_MIRRORED) return { source: undefined, mirrored: false, cels };
    const target = raw[source];
    if (!target || target.source !== LOOP_NOT_MIRRORED) throw new Error(`GK1 : boucle de vue qui renvoie à une boucle invalide (${source})`);
    return { source, mirrored: mirror === 1, cels: target.cels };
  });
  const palette = paletteOffset ? readPalette(data, paletteOffset) : undefined;
  return { resolution, celCount, loops, palette, paletteOffset, headerSize, loopHeaderSize, celHeaderSize, data };
}

/** Pixels indexés d'un cel, tels que stockés (non retournés : voir `ViewLoop.mirrored`). */
export function decodeViewCel(view: View, loop: number, cel: number): Uint8Array {
  const header = view.loops[loop]?.cels[cel];
  if (!header) throw new Error(`GK1 : cel de vue absent (boucle ${loop}, cel ${cel})`);
  return decodeCel(view.data, header);
}
