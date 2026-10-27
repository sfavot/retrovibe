/**
 * Ressource `SHPL` : liste de formes et palette associée. Big-endian (lu par `FUN_10a8_0640`, `10a8:0640` dans MATH).
 *
 * | Octets | Contenu |
 * |---|---|
 * | 0 | u16 identifiant `SHAP` de la première forme (l'identifiant du SHPL lui-même) |
 * | 2 | u16 nombre de formes `SHAP` consécutives (id, id + 1, …) |
 * | 4 | u16 premier index de palette écrasé |
 * | 6 | u16 nombre `n` d'entrées de palette |
 * | 8 | `n` entrées de 4 octets `PALETTEENTRY` Windows : R, G, B, drapeaux (0) |
 *
 * Les valeurs R, G, B sont stockées « sombres » : le jeu les éclaircit à la lecture (voir `palette.ts`).
 */
import { BinaryReader } from "../reader";

export interface ShapeList {
  /** Identifiant du premier `SHAP` de la liste (= identifiant du SHPL). */
  firstShapeId: number;
  /** Nombre de `SHAP` consécutifs. */
  shapeCount: number;
  /** Premier index de palette redéfini. */
  paletteFirst: number;
  /** Entrées brutes (RGB, 3 octets par entrée, sans l'éclaircissement du jeu). */
  rgb: Uint8Array;
}

export function parseShpl(bytes: Uint8Array): ShapeList {
  const r = new BinaryReader(bytes);
  const firstShapeId = r.u16be();
  const shapeCount = r.u16be();
  const paletteFirst = r.u16be();
  const count = r.u16be();
  if (paletteFirst + count > 256) throw new Error("SHPL : palette hors des 256 entrées");
  if (8 + count * 4 > bytes.length) throw new Error("SHPL : palette tronquée");
  const rgb = new Uint8Array(count * 3);
  for (let i = 0; i < count; i++) {
    rgb[i * 3] = bytes[8 + i * 4]!;
    rgb[i * 3 + 1] = bytes[9 + i * 4]!;
    rgb[i * 3 + 2] = bytes[10 + i * 4]!;
  }
  return { firstShapeId, shapeCount, paletteFirst, rgb };
}
