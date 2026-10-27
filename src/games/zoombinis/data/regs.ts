/**
 * Ressource `REGS` : tableau de mots 16 bits big-endian **signés**, sans structure imposée par le moteur (`1168:01f4`,
 * `docs/zoombinis/engine.md` §4.3). La signification dépend de l'appelant. Deux emplois :
 *
 * 1. points d'ancrage d'une planche `tBMP` d'id `id` : `REGS id` = X et `REGS id + 1` = Y, un mot par sous-image, indexés par `w`
 *    (1-based, le mot 0 vaut 0), soit `(n + 1) × 2` octets pour `n` sous-images. Le moteur pose une partie `(w, x, y)` à
 *    `(x - X[w], y - Y[w])` (`11a0:1013`, `11a0:033a`) ;
 * 2. tables de données d'épreuve (niveaux, points d'impact…) : lues telles quelles par chaque épreuve.
 */
import { BinaryReader } from "../../../data/reader";
import type { ScriptCell } from "./script";

export function parseRegs(bytes: Uint8Array): Int16Array {
  if (bytes.length % 2 !== 0) throw new Error("REGS : taille impaire");
  const r = new BinaryReader(bytes);
  const words = new Int16Array(bytes.length >> 1);
  for (let i = 0; i < words.length; i++) words[i] = r.i16be();
  return words;
}

/** Points d'ancrage d'une planche : `REGS id` (X) et `REGS id + 1` (Y). */
export interface Anchors {
  x: Int16Array;
  y: Int16Array;
}

export function parseAnchors(regsX: Uint8Array, regsY: Uint8Array): Anchors {
  const x = parseRegs(regsX);
  const y = parseRegs(regsY);
  if (x.length !== y.length) throw new Error(`REGS : ${x.length} ancrages X pour ${y.length} ancrages Y`);
  return { x, y };
}

/** Position écran d'une partie : `(x - X[w], y - Y[w])`. Hors tableau (ou `w == 0`), l'ancrage est nul. */
export function anchorPosition(anchors: Anchors | undefined, cell: ScriptCell): { x: number; y: number } {
  return { x: cell.x - (anchors?.x[cell.w] ?? 0), y: cell.y - (anchors?.y[cell.w] ?? 0) };
}
