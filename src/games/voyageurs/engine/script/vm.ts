/**
 * Machine à scripts des *Voyageurs du temps* : interpréteur à état explicite (D5).
 *
 * Référence : ScummVM engines/cine/script_fw.cpp (`RawScript::getNextLabel`, `computeLabels`, `FWScript::execute`, `FWScript` ctor,
 * `FWScriptInfo::opcodeInfo` / `opcodeHandler`, `executeObjectScripts`, `executeGlobalScripts`) et script.h (`SCRIPT_STACK_SIZE`,
 * `LOCAL_VARS_SIZE`, `RawObjectScript::run`) (GPL v3 ou ultérieure). docs/voyageurs/engine.md § 2.
 *
 * - L'octet N exécute l'entrée N - 1 de la table (`opcodes.ts`) ; l'octet 0 et les trous sont des no-op d'un octet.
 * - Les labels sont pré-calculés jusqu'au premier `endScript` (`x`), puis redéfinis à l'exécution par `label`.
 * - Une instance (`ScriptInstance`) a sa position, ses 50 labels, ses 50 locales (16 bits signés) et son registre de comparaison :
 *   exactement ce que sauve `FWScript::save`. `run` exécute jusqu'à `break` (« pause » jusqu'au tick suivant), `endScript` (fin) ou un
 *   **effet bloquant** (fondu au noir) : la boucle principale le joue puis rappelle `run` sur la même instance, qui reprend à l'opcode
 *   suivant sans qu'aucun autre script ne tourne entretemps.
 * - Instance d'objet : la locale 0 reçoit le nombre d'exécutions précédentes de l'entrée REL (`RawObjectScript::run`).
 *
 * Écarts volontaires : un bytecode sans `endScript` ni label final ferait boucler `computeLabels` à l'infini dans ScummVM : ici le calcul
 * s'arrête à la fin du bytecode ; une lecture hors du bytecode (`assert` de ScummVM) lève `VmError` ; un saut vers un label non défini
 * (`assert`) aussi.
 */

import { toI16 } from "../state";

export const SCRIPT_STACK_SIZE = 50;
export const LOCAL_VARS_SIZE = 50;

export class VmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VmError";
  }
}

/** Effet bloquant rendu au milieu d'un script (D5). */
export type VmEffect = { kind: "fadeToBlack" };

/** Résultat d'un opcode : continuer, pause (`break`), fin (`endScript`) ou effet bloquant. */
export type OpResult = 0 | "break" | "end" | VmEffect;

/** Résultat de `run`. */
export type RunResult = "break" | "end" | VmEffect;

/** Description d'un opcode : nom, signature (`b` octet, `w` mot, `c` type + valeur, `s` chaîne, `l` label, `x` fin), exécution. */
export interface OpcodeInfo<C> {
  readonly name: string;
  readonly args: string;
  readonly run: (vm: ScriptInstance, ctx: C) => OpResult;
}

/** Table indexée par `octet - 1`. */
export type OpcodeTable<C> = readonly (OpcodeInfo<C> | null)[];

/** Signatures seules (calcul des labels). */
export type ArgTable = readonly ({ readonly args: string } | null)[];

/** Signature des arguments de l'octet `opcode` (`opcodeInfo`), ou `null` pour un no-op. */
function argsOf(table: ArgTable, opcode: number): string | null {
  if (opcode === 0 || opcode > table.length) return null;
  return table[opcode - 1]?.args ?? null;
}

/** Bytecode et labels pré-calculés (`RawScript`). */
export class RawScript {
  readonly size: number;
  /** Bytecode suivi d'un octet nul (`_data[_size] = 0`). */
  readonly data: Uint8Array;
  readonly labels: Int16Array;

  constructor(bytecode: Uint8Array, table: ArgTable) {
    this.size = bytecode.length;
    this.data = new Uint8Array(this.size + 1);
    this.data.set(bytecode);
    this.labels = new Int16Array(SCRIPT_STACK_SIZE).fill(-1);
    if (this.size === 0) return;
    let pos = 0;
    for (;;) {
      const next = this.nextLabel(table, pos);
      if (next < 0 || next >= this.size) break;
      const index = this.data[next]!;
      if (index < SCRIPT_STACK_SIZE) this.labels[index] = next + 1;
      pos = next + 1;
    }
  }

  /** `getNextLabel` : position de l'octet d'index du prochain label, `-pos - 1` sur `endScript`, `size` à la fin. */
  private nextLabel(table: ArgTable, offset: number): number {
    let pos = offset;
    while (pos < this.size) {
      const args = argsOf(table, this.data[pos++]!);
      if (!args) continue;
      for (const kind of args) {
        switch (kind) {
          case "b":
            pos++;
            break;
          case "w":
            pos += 2;
            break;
          case "c": {
            const type = this.data[pos++];
            pos += type ? 1 : 2;
            break;
          }
          case "l":
            return pos;
          case "s":
            while (pos < this.size && this.data[pos++] !== 0);
            break;
          case "x":
            return -pos - 1;
          default:
            break;
        }
      }
    }
    return this.size;
  }
}

/** Entrée REL (`RawObjectScript`) : verbe, objet 1, objet 2, et compteur d'exécutions. */
export class RawObjectScript extends RawScript {
  runCount = 0;

  constructor(
    bytecode: Uint8Array,
    table: ArgTable,
    readonly p1: number,
    readonly p2: number,
    readonly p3: number,
  ) {
    super(bytecode, table);
  }
}

/** Instance de script (`FWScript`). `index` < 0 : arrêtée par `endGlobalScript`, retirée à son prochain passage. */
export class ScriptInstance {
  pos = 0;
  /** Position de l'opcode en cours (`_line`). */
  line = 0;
  compare = 0;
  readonly labels: Int16Array;
  readonly locals = new Int16Array(LOCAL_VARS_SIZE);

  constructor(
    readonly raw: RawScript,
    public index: number,
  ) {
    this.labels = raw.labels.slice();
    if (raw instanceof RawObjectScript) this.locals[0] = raw.runCount++;
  }

  byte(): number {
    if (this.pos >= this.raw.size) throw new VmError(`lecture hors du script ${this.index} (position ${this.pos})`);
    return this.raw.data[this.pos++]!;
  }

  /** Mot grand-boutiste non signé (`getNextWord`). */
  word(): number {
    if (this.pos + 1 >= this.raw.size) throw new VmError(`lecture hors du script ${this.index} (position ${this.pos})`);
    const value = (this.raw.data[this.pos]! << 8) | this.raw.data[this.pos + 1]!;
    this.pos += 2;
    return value;
  }

  /** Mot signé. */
  sword(): number {
    return toI16(this.word());
  }

  /** Chaîne terminée par un zéro (ASCII des noms de fichiers). */
  string(): string {
    if (this.pos >= this.raw.size) throw new VmError(`lecture hors du script ${this.index} (position ${this.pos})`);
    let end = this.pos;
    while (end <= this.raw.size && this.raw.data[end] !== 0) end++;
    const text = String.fromCharCode(...this.raw.data.subarray(this.pos, end));
    this.pos = end + 1;
    return text;
  }

  /** Saut vers le label `index` (`assert(_labels[i] != -1)`). */
  jump(index: number): void {
    const target = this.labels[index];
    if (target === undefined || target === -1) throw new VmError(`script ${this.index} : label ${index} indéfini (position ${this.line})`);
    this.pos = target & 0xffff;
  }

  /** État sérialisable (`FWScript::save`). */
  snapshot(): { index: number; pos: number; compare: number; labels: number[]; locals: number[] } {
    return { index: this.index, pos: this.pos, compare: this.compare, labels: [...this.labels], locals: [...this.locals] };
  }
}

/** Observateur des opcodes exécutés (trace `OP` du banc). */
export type OpTracer = (script: ScriptInstance, opcode: number, args: string) => void;

/** Arguments d'un opcode formatés comme la trace du banc (`FWScript::traceOp`), lus sans avancer. */
export function formatOpArgs(script: ScriptInstance, args: string): string {
  const data = script.raw.data;
  let pos = script.pos;
  const parts: string[] = [];
  const word = (p: number) => toI16((data[p]! << 8) | data[p + 1]!);
  for (const kind of args) {
    switch (kind) {
      case "b":
        parts.push(String(data[pos++]));
        break;
      case "w":
        parts.push(String(word(pos)));
        pos += 2;
        break;
      case "c": {
        const type = data[pos++]!;
        if (type) parts.push(`${type}:${data[pos++]}`);
        else {
          parts.push(`0:${word(pos)}`);
          pos += 2;
        }
        break;
      }
      case "s": {
        let text = '"';
        while (pos < data.length && data[pos] !== 0) {
          const c = data[pos++]!;
          text += c >= 32 && c < 127 && c !== 0x22 ? String.fromCharCode(c) : `\\x${c.toString(16).padStart(2, "0")}`;
        }
        pos++;
        parts.push(`${text}"`);
        break;
      }
      default:
        break;
    }
  }
  return parts.length ? parts.join(",") : "-";
}

/**
 * `FWScript::execute` : exécute `script` jusqu'à `break`, `endScript` ou un effet bloquant. Un script vide (taille 0) rend `break` sans rien
 * faire : il reste dans sa liste, comme dans ScummVM.
 */
export function runScript<C>(script: ScriptInstance, table: OpcodeTable<C>, ctx: C, tracer?: OpTracer): RunResult {
  if (script.raw.size === 0) return "break";
  for (;;) {
    script.line = script.pos;
    const opcode = script.byte();
    const info = opcode === 0 || opcode > table.length ? null : table[opcode - 1];
    if (!info) continue;
    if (tracer) tracer(script, opcode - 1, formatOpArgs(script, info.args));
    const result = info.run(script, ctx);
    if (result !== 0) return result;
  }
}
