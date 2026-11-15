/**
 * Trace du moteur au format du banc ScummVM (`cruise-bench/src/engines/cruise/bench.cpp`, voir `cruise-bench/README.md`), pour
 * comparer le portage à ScummVM tour par tour.
 *
 * - niveau 1 : `FR n x y b ue uw at menu dlg rel spd ud` après `processInput` (souris lue **avant** `processInput`) ;
 * - niveau 2 : en plus `NF 0xNN Nom (args) -> r` (arguments dans l'ordre de dépilement, `P` = pointeur, `S"..."` = chaîne lue avant
 *   l'appel pour les fonctions qui en prennent), `RN borne résultat` après `Random`, `SS P|R OVL idx script type ip0 ip1 ret=r rc=c`
 *   après chaque tranche, `PL` / `RL` / `CL` après les scripts, `AC` après `processAnimation` ;
 * - niveau 3 : en plus `OP ovl script ip 0xOP` avant chaque opcode ;
 * - `VH n h` (FNV-1a 32 bits des 2000 `globalVars`, octet de poids faible d'abord) en fin de tour si `varHash`.
 * Les lignes `SC` (CRC de l'écran) dépendent du rendu : non émises (vague R).
 */
import type { Cell } from "./cells";
import { NATIVE_NAMES } from "../data/disasm";
import type { EngineState, ScriptInstance } from "./state";

type StackEntry = EngineState["vm"]["stack"][number];

/** Points d'accroche appelés par le moteur (tous facultatifs). */
export interface EngineTrace {
  frameBegin?(n: number): void;
  frameInputs?(n: number, mx: number, my: number, mb: number, e: EngineState): void;
  modal?(n: number, where: string, e: EngineState): void;
  nativeBegin?(opcode: number, stack: readonly StackEntry[], position: number): (string | null)[] | null;
  nativeEnd?(opcode: number, stack: readonly StackEntry[], before: number, after: number, result: number, strings: (string | null)[] | null): void;
  scriptSlice?(list: "P" | "R", ptr: ScriptInstance, ovl: number, scr: number, ip0: number, lastRet: number, rc: number, e: EngineState): void;
  opcode?(ptr: ScriptInstance, byte: number): void;
  afterScripts?(n: number, e: EngineState): void;
  afterAnimation?(n: number, e: EngineState): void;
  frameEnd?(n: number, e: EngineState): void;
  protection?(code: number): void;
}

/** Fonctions dont les arguments pointeurs sont des chaînes (`kFuncStr` du banc). */
const STRING_FUNCS = new Set([0x03, 0x04, 0x0c, 0x10, 0x11, 0x17, 0x2a, 0x2b, 0x3d, 0x43, 0x5a, 0x5c, 0x67, 0x6b, 0x6d, 0x6e, 0x6f, 0x70, 0x71, 0x72, 0x76]);

/** `renderString` du banc : 40 octets au plus, non imprimables en `\xNN`. */
function renderString(block: Uint8Array, offset: number): string {
  let out = 'S"';
  for (let i = 0; i < 40; i++) {
    const c = offset + i < block.length && offset + i >= 0 ? block[offset + i]! : 0;
    if (!c) break;
    if (c >= 32 && c < 127 && c !== 0x22 && c !== 0x5c) out += String.fromCharCode(c);
    else out += `\\x${c.toString(16).padStart(2, "0")}`;
  }
  return `${out}"`;
}

/** FNV-1a 32 bits des `globalVars` (2 octets chacun, poids faible d'abord), comme `VH` du banc. */
export function globalVarsHash(vars: Int16Array): number {
  let h = 2166136261;
  for (let i = 0; i < vars.length; i++) {
    const v = vars[i]! & 0xffff;
    h = Math.imul(h ^ (v & 0xff), 16777619) >>> 0;
    h = Math.imul(h ^ (v >> 8), 16777619) >>> 0;
  }
  return h >>> 0;
}

function cellText(c: Cell): string {
  return `${c.overlay}:${c.idx}:${c.type}:${c.freeze}:${c.backgroundPlane}:${c.x}:${c.fieldC}:${c.spriteIdx}`;
}

function scriptList(tag: string, n: number, list: readonly ScriptInstance[]): string {
  let line = `${tag} ${n}`;
  for (const s of list) line += ` ${s.overlayNumber}:${s.scriptNumber}:${s.type}:${s.scriptOffset}:${s.freeze}:${s.sysKey}`;
  return line;
}

/** Enregistre les lignes de trace (ou les passe à `sink`). */
export class TraceRecorder implements EngineTrace {
  readonly lines: string[] = [];
  private n = 0;

  constructor(
    readonly level: 1 | 2 | 3 = 2,
    readonly varHash = true,
    private readonly sink?: (line: string) => void,
  ) {}

  private emit(line: string): void {
    if (this.sink) this.sink(line);
    else this.lines.push(line);
  }

  frameBegin(n: number): void {
    this.n = n;
  }

  frameInputs(n: number, mx: number, my: number, mb: number, e: EngineState): void {
    this.emit(
      `FR ${n} ${mx} ${my} ${mb} ${e.userEnabled} ${e.userWait ? 1 : 0} ${e.autoTrack ? 1 : 0} ${e.currentActiveMenu} ${e.dialogueEnabled ? 1 : 0} ${e.linkedRelation ? 1 : 0} ${e.gameSpeed} ${e.userDelay}`,
    );
  }

  modal(n: number, where: string, e: EngineState): void {
    this.emit(`MF ${n} ${where} ${e.currentMouseX} ${e.currentMouseY} ${e.currentMouseButton}`);
  }

  nativeBegin(opcode: number, stack: readonly StackEntry[], position: number): (string | null)[] | null {
    if (this.level < 2) return null;
    const out: (string | null)[] = [];
    const strFn = STRING_FUNCS.has(opcode);
    for (let i = 0; i < 8; i++) {
      out.push(null);
      const idx = position - 1 - i;
      if (idx < 0 || !strFn) continue;
      const entry = stack[idx]!;
      if (entry.kind !== "ptr" || !entry.value) continue;
      if ((opcode === 0x6d || opcode === 0x6e) && i === 1) continue;
      if (opcode === 0x6f) continue;
      out[i] = renderString(entry.value.block, entry.value.offset);
    }
    return out;
  }

  nativeEnd(opcode: number, stack: readonly StackEntry[], before: number, after: number, result: number, strings: (string | null)[] | null): void {
    if (this.level < 2) return;
    const n = before - after;
    const name = NATIVE_NAMES[opcode] ?? "?";
    let args: string;
    if (n < 0 || n > 16) args = `n=${n}`;
    else {
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const entry = stack[before - 1 - i]!;
        if (entry.kind === "short") parts.push(String(entry.value));
        else parts.push((i < 8 && strings?.[i]) || "P");
      }
      args = parts.join(",");
    }
    this.emit(`NF 0x${opcode.toString(16).padStart(2, "0")} ${name} (${args}) -> ${result}`);
    if (opcode === 0x3c && n >= 1) {
      const bound = stack[before - 1]!;
      this.emit(`RN ${bound.kind === "short" ? bound.value : 0} ${result}`);
    }
  }

  scriptSlice(list: "P" | "R", ptr: ScriptInstance, ovl: number, scr: number, ip0: number, lastRet: number, rc: number, e: EngineState): void {
    if (this.level < 2) return;
    this.emit(`SS ${list} ${e.overlays.entries[ovl]?.name ?? ""} ${ovl} ${scr} ${ptr.type} ${ip0} ${ptr.scriptOffset} ret=${lastRet} rc=${rc}`);
  }

  opcode(ptr: ScriptInstance, byte: number): void {
    if (this.level < 3) return;
    this.emit(`OP ${ptr.overlayNumber} ${ptr.scriptNumber} ${ptr.scriptOffset} 0x${byte.toString(16).padStart(2, "0")}`);
  }

  afterScripts(n: number, e: EngineState): void {
    if (this.level < 2) return;
    this.emit(scriptList("PL", n, e.procs));
    this.emit(scriptList("RL", n, e.rels));
    let line = `CL ${n}`;
    for (const c of e.cells) line += ` ${cellText(c)}`;
    this.emit(line);
  }

  afterAnimation(n: number, e: EngineState): void {
    if (this.level < 2) return;
    let line = `AC ${n}`;
    for (const a of e.actors) {
      line += ` ${[a.overlayNumber, a.idx, a.type, a.x, a.y, a.x_dest, a.y_dest, a.phase, a.counter, a.pathId, a.startDirection, a.nextDirection, a.endDirection, a.stepX, a.stepY, a.poly, a.flag, a.start, a.freeze].join(":")}`;
    }
    this.emit(line);
  }

  frameEnd(n: number, e: EngineState): void {
    if (this.varHash) this.emit(`VH ${n} ${globalVarsHash(e.globalVars)}`);
  }

  protection(code: number): void {
    this.emit(`PROT skip protectionCode=${code} tick=${this.n}`);
  }
}
