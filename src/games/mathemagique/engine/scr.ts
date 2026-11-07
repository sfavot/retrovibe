import { TAG_SCR } from "../../../data/mohawk/mohawk";
import type { Archive } from "../../../engine/mohawk/resources";
import { parseScr, type ScrScript } from "../data/scr";

/** Script d'animation (`\0SCR`) d'une archive, décodé une seule fois (mémoïsé par l'archive). */
export function scr(archive: Pick<Archive, "memo">, id: number): ScrScript {
  return archive.memo(TAG_SCR, id, parseScr);
}
