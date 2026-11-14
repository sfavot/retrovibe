/**
 * Trace du moteur au format du banc ScummVM (`patch/sky-trace.patch` : `Debug::cycle`, `logic`, `script`, `mcode` d'engines/sky/debug.cpp,
 * GPL v3 ou ultérieure), pour comparer le portage à ScummVM tour par tour.
 *
 * - niveau 1 : `CY n scr=S fo=logic,status,x,y,frame,screen jo=…` au début de chaque tour (avant `Logic::engine`), et
 *   `MC n id=CUR_ID nom a b c` à chaque appel de mcode ;
 * - niveau 2 : en plus `SC n id=CUR_ID opcode opérandes` ;
 * - niveau 3 : en plus `LG n id=CUR_ID nom_de_logique` pour chaque compact traité.
 *
 * Écart : `push_variable` et `pop_var` montrent `var_N` (le banc montre le nom de la variable, table de debug.cpp non reprise).
 */

import { CompactField as F } from "../data/compact-fields";
import type { Compacts } from "./compacts";
import { Cpt, LOGIC_NAMES, OPCODE_NAMES, OPCODE_PARAMS, Var } from "./ids";
import type { LogicTrace } from "./logic";
import { MCODES } from "./mcodes/index";
import type { ScriptVars } from "./vars";

/** Ce que le moteur appelle en plus des points de `LogicTrace`. */
export interface EngineTrace extends LogicTrace {
  cycle?(n: number, vars: ScriptVars, compacts: Compacts): void;
}

/** Enregistre les lignes de trace (ou les passe à `sink`). */
export class TraceRecorder implements EngineTrace {
  readonly lines: string[] = [];
  private n = 0;

  constructor(
    readonly level: 1 | 2 | 3 = 1,
    private readonly sink?: (line: string) => void,
  ) {}

  private emit(line: string): void {
    if (this.sink) this.sink(line);
    else this.lines.push(line);
  }

  cycle(n: number, vars: ScriptVars, compacts: Compacts): void {
    this.n = n;
    const show = (id: number): string => {
      const c = compacts.require(id);
      return `${c[F.logic]},${c[F.status]},${c[F.xcood]},${c[F.ycood]},${c[F.frame]},${c[F.screen]}`;
    };
    this.emit(`CY ${n} scr=${vars[Var.SCREEN]} fo=${show(Cpt.FOSTER)} jo=${show(Cpt.JOEY)}`);
  }

  logic(curId: number, logic: number): void {
    if (this.level >= 3) this.emit(`LG ${this.n} id=${curId} ${LOGIC_NAMES[logic] ?? logic}`);
  }

  opcode(curId: number, command: number, module: Uint16Array, pos: number): void {
    if (this.level < 2) return;
    let line = `SC ${this.n} id=${curId} ${OPCODE_NAMES[command] ?? command}`;
    if (command === 0 || command === 6) line += ` var_${module[pos]! >> 2}`;
    else for (let i = 0; i < (OPCODE_PARAMS[command] ?? 0); i++) line += ` ${module[pos + i]}`;
    this.emit(line);
  }

  mcode(curId: number, num: number, a: number, b: number, c: number): void {
    this.emit(`MC ${this.n} id=${curId} ${MCODES[num]?.name ?? num} ${a | 0} ${b | 0} ${c | 0}`);
  }
}
