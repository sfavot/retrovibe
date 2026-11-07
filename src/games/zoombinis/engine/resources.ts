import type { Archive } from "../../../engine/mohawk/resources";
import { TAG_CURS, TAG_NODE, TAG_PATH, TAG_REGS, TAG_SCRB, TAG_SCRS } from "../data/archives";
import { parseCurs, type Cursor } from "../data/curs";
import { parseNode, parsePath, type NodePoint } from "../data/node-path";
import { parseRegs } from "../data/regs";
import { parseScrb, parseScrs, type Script } from "../data/script";

/**
 * Ressources propres à Zoombinis, décodées une seule fois (mémoïsées par l'archive). Les `tBMP` (`tbmp`, `tbmpImages`), `SHPL`,
 * `STRL` (Mac Roman, voir `engine.ts`) et `\0SND` passent par les accesseurs communs de `Archive`.
 */
type Memo = Pick<Archive, "memo">;

/** `SCRB` : script de bitmaps (objets de décor, d'interface, personnages). */
export function scrb(archive: Memo, id: number): Script {
  return archive.memo(TAG_SCRB, id, parseScrb);
}

/** `SCRS` : script de sprites (51 communs 100 à 150 dans `ZOOMBINI.MHK`, plus ceux des écrans). */
export function scrs(archive: Memo, id: number): Script {
  return archive.memo(TAG_SCRS, id, parseScrs);
}

/** `NODE` : points de chemin. */
export function node(archive: Memo, id: number): NodePoint[] {
  return archive.memo(TAG_NODE, id, parseNode);
}

/** `PATH` : chemins de marche. */
export function path(archive: Memo, id: number): number[][] {
  return archive.memo(TAG_PATH, id, parsePath);
}

/** `REGS` : mots signés (points d'ancrage X ou Y d'une planche `tBMP`, régions). */
export function regs(archive: Memo, id: number): Int16Array {
  return archive.memo(TAG_REGS, id, parseRegs);
}

/** `CURS` : curseur monochrome 16 × 16 (ids 1 à 5 de `ZOOMBINI.MHK`). */
export function curs(archive: Memo, id: number): Cursor {
  return archive.memo(TAG_CURS, id, parseCurs);
}
