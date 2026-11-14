/**
 * Désassembleur des scripts (débogage, visionneuse) : une ligne par instruction, mcodes nommés.
 *
 * Référence : ScummVM engines/sky/logic.cpp (`Logic::script`, encodage des opérandes) et debug.cpp (noms des opcodes et des mcodes)
 * (GPL v3 ou ultérieure).
 *
 * Un module commence par la table des positions de ses scripts (en mots) ; la fin de la table est la plus petite position non nulle. Un
 * script est lu linéairement de son début jusqu'au début du script suivant (ou la fin du module) : les sauts sont montrés avec leur cible.
 */

import { OPCODE_NAMES } from "./ids";
import { MCODES } from "./mcodes/index";
import { Op } from "./script";

export interface DisasmLine {
  /** Position (mots depuis le début du module). */
  readonly pos: number;
  readonly text: string;
}

/** Nombre de scripts du module (taille de la table des positions). */
export function scriptCount(module: Uint16Array): number {
  let end = module.length;
  for (let i = 0; i < end; i++) if (module[i]! > 0 && module[i]! < end) end = module[i]!;
  return end;
}

/** Positions de début des scripts, par rang (0 : script absent). */
export function scriptStarts(module: Uint16Array): number[] {
  return Array.from(module.subarray(0, scriptCount(module)));
}

/** Désassemble le script de rang `index` (12 bits bas d'un numéro de script). */
export function disassembleScript(module: Uint16Array, index: number): DisasmLine[] {
  const starts = scriptStarts(module);
  const start = starts[index];
  if (!start) throw new RangeError(`script ${index} absent du module`);
  const next = Math.min(module.length, ...starts.filter((s) => s > start));
  return disassembleRange(module, start, next);
}

/** Désassemble les instructions de `start` (inclus) à `end` (exclu). */
export function disassembleRange(module: Uint16Array, start: number, end: number): DisasmLine[] {
  const out: DisasmLine[] = [];
  let pc = start;
  while (pc < end) {
    const pos = pc;
    const command = module[pc++]!;
    const name = OPCODE_NAMES[command] ?? `?${command}`;
    const operand = (): number => module[pc++] ?? 0;
    let text: string;
    switch (command) {
      case Op.PUSH_VARIABLE:
      case Op.POP_VAR:
        text = `${name} var[${operand() >> 2}]`;
        break;
      case Op.PUSH_NUMBER:
        text = `${name} ${operand()}`;
        break;
      case Op.PUSH_OFFSET:
      case Op.POP_OFFSET:
        text = `${name} cpt+${operand()}`;
        break;
      case Op.SKIP_ZERO:
      case Op.SKIP_ALWAYS: {
        const s = operand();
        text = `${name} -> ${pc + (s >> 1)}`;
        break;
      }
      case Op.SKIP_NZ: {
        const t = (operand() << 16) >> 16;
        text = `${name} -> ${pc + Math.trunc(t / 2)}`;
        break;
      }
      case Op.CALL_MCODE: {
        const argc = operand();
        const num = operand() >> 2;
        text = `${name} ${MCODES[num]?.name ?? `mcode_${num}`}/${argc}`;
        break;
      }
      case Op.SWITCH: {
        const count = operand();
        const cases: string[] = [];
        for (let i = 0; i < count && pc + 1 < module.length; i++) {
          const value = module[pc]!;
          const target = pc + (module[pc + 1]! >> 1) + 1;
          cases.push(`${value} -> ${target}`);
          pc += 2;
        }
        const def = pc + (module[pc]! >> 1);
        pc++;
        text = `${name} ${cases.join(", ")}${cases.length ? ", " : ""}default -> ${def}`;
        break;
      }
      default:
        text = command < OPCODE_NAMES.length ? name : `?${command}`;
    }
    out.push({ pos, text });
  }
  return out;
}

/** Texte complet d'un script (une ligne `pos: instruction` par instruction). */
export function formatScript(module: Uint16Array, index: number): string {
  return disassembleScript(module, index)
    .map((l) => `${String(l.pos).padStart(5)}: ${l.text}`)
    .join("\n");
}
