/**
 * Ressource `tPAL` de `MPC/PVG.MHK` : palette de la présentation (module hors de MATH, jamais analysé : le format est déduit
 * des données). Big-endian : u16 premier index, u16 nombre `n`, puis `n` entrées de 4 octets R, G, B, 0 (mêmes entrées que
 * dans un `SHPL`, sans les deux premiers mots). Le reste de la ressource (8 × 256 octets) est du bourrage.
 */
import { BinaryReader } from "../../../data/reader";
import type { ShapeList } from "./shpl";

export function parseTpal(bytes: Uint8Array): ShapeList {
  const r = new BinaryReader(bytes);
  const paletteFirst = r.u16be();
  const count = r.u16be();
  if (paletteFirst + count > 256) throw new Error("tPAL : palette hors des 256 entrées");
  if (4 + count * 4 > bytes.length) throw new Error("tPAL : palette tronquée");
  const rgb = new Uint8Array(count * 3);
  for (let i = 0; i < count; i++) {
    rgb[i * 3] = bytes[4 + i * 4]!;
    rgb[i * 3 + 1] = bytes[5 + i * 4]!;
    rgb[i * 3 + 2] = bytes[6 + i * 4]!;
  }
  return { firstShapeId: 0, shapeCount: 0, paletteFirst, rgb };
}
