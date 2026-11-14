/**
 * Types communs des mcodes (`bool Logic::fnXxx(uint32 a, uint32 b, uint32 c)`, ScummVM engines/sky/logic.cpp, GPL v3 ou ultérieure).
 * Faux = le script se suspend (sa position est rangée dans `xxxSub_off`, il reprend au tour suivant).
 */

import type { Logic } from "../logic";

export type McodeFn = (L: Logic, a: number, b: number, c: number) => boolean;

/**
 * État du portage d'un mcode :
 * - `done` : complet ;
 * - `service` : logique complète, sortie (image, son) confiée à un service fourni par l'hôte (`BassScreen`, `BassSound`) ; sans lui
 *   (`NullScreen`, `SilentSound`), elle est sans effet visible ;
 * - `stub` : journalise son nom et ses arguments, rend la valeur de ScummVM.
 */
export type McodeStatus = "done" | "service" | "stub";

export interface McodeEntry {
  /** Nom du débogueur de ScummVM (`mcodes[]`, debug.cpp), repris dans les traces. */
  readonly name: string;
  readonly fn: McodeFn;
  readonly status: McodeStatus;
}

/** Arguments `u32` lus comme ScummVM les passe à `debug` (`%d`). */
export function argsText(a: number, b: number, c: number): string {
  return `${a | 0}, ${b | 0}, ${c | 0}`;
}
