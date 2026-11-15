/**
 * Traces tick par tick au format du banc ScummVM (`CINE_TRACE`, patch `engines/cine/trace.cpp` du banc, voir docs/voyageurs/plan.md,
 * vague P) : une ligne `TK` par tick et, au niveau 2, une ligne `OP` par opcode. Elles servent à comparer le portage au banc.
 *
 * `TK n h=<FNV-1a 32 bits des globales 0 à 254, mot de 16 bits octet faible d'abord> g=<index:position des scripts globaux> o=<idem objets>
 * ov=<calques> bg=<fond> mus=<piste,statut,emplacement> w=<attente de clic> ai=<entrées autorisées>`.
 *
 * Écart : `mus` dépend du pilote CD (vague A) ; sans lui, le moteur écrit `-`.
 */

import type { ScriptInstance } from "./script/vm";
import type { EngineState } from "./state";

/** FNV-1a des 255 premières globales (`hashVars` du banc). */
export function hashGlobals(globals: Int16Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < 255; i++) {
    const v = globals[i]! & 0xffff;
    h = Math.imul(h ^ (v & 0xff), 16777619) >>> 0;
    h = Math.imul(h ^ (v >> 8), 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function scriptList(list: readonly ScriptInstance[]): string {
  return list.length ? list.map((s) => `${s.index}:${s.pos}`).join(",") : "-";
}

/** Ligne `TK` de fin de tick. `music` : `cur,statut,emplacement` du pilote CD s'il est suivi. */
export function tickLine(tick: number, state: EngineState, music = "-"): string {
  const g = scriptList(state.globalScripts);
  const o = scriptList(state.objectScripts);
  return `TK ${tick} h=${hashGlobals(state.globals)} g=${g} o=${o} ov=${state.overlays.length} bg=${state.names.bg || "-"} mus=${music} w=${state.waitForPlayerClick} ai=${state.allowPlayerInput}`;
}

/** Ligne `OP` (`Trace::op`) : `opcode` = octet - 1. */
export function opLine(tick: number, kind: "g" | "o", script: ScriptInstance, opcode: number, args: string): string {
  return `OP ${tick} ${kind}${script.index} ${script.line} ${opcode.toString(16).padStart(2, "0")} ${args}`;
}
