/**
 * Séquences (segment `0x3F0C`) : machine à pile de 16 bits. Un octet d'opcode (bit 0 : un paramètre de 16 bits suit, bits 1-7 : opcode),
 * une pile de valeurs, une pile de retours pour `SUBROUTINE` ; `EXEC` appelle une méthode native (`methods/`) avec jusqu'à trois valeurs
 * dépilées ; la valeur rendue est le champ `SEQUENCE_RESULT`.
 *
 * Source (ScummVM, GPL v3+) : `Script::execute`, `Script::executeMethod` (engines/lure/scripts.cpp), opcodes `S_OPCODE_*` de
 * `scripts.h`.
 *
 * Écarts volontaires :
 * - l'exécution reste **synchrone** (ScummVM l'appelle de partout et attend la valeur rendue) ; ce qui bloquait ScummVM au milieu d'une
 *   méthode (boîte de texte, séquence plein écran) est demandé par `ctx.block` et joué après coup (`engine.md`, § 9) ;
 * - une pile vide dépilée rend 0 au lieu d'un comportement indéfini, et une division par zéro lève une erreur (aucune n'arrive dans
 *   les données : `disassemble` et les tests le vérifient).
 */

import type { Segment } from "../data/lure-dat";
import type { LureContext } from "./context";
import { Field, HotspotId } from "./ids";

export const Op = {
  ABORT: 0,
  ADD: 1,
  SUBTRACT: 2,
  MULTIPLY: 3,
  DIVIDE: 4,
  EQUALS: 5,
  NOT_EQUALS: 6,
  LT: 7,
  GT: 8,
  LTE: 9,
  GTE: 10,
  AND: 11,
  OR: 12,
  LOGICAL_AND: 13,
  LOGICAL_OR: 14,
  GET_FIELD: 15,
  SET_FIELD: 16,
  PUSH: 17,
  SUBROUTINE: 18,
  EXEC: 19,
  END: 20,
  COND_JUMP: 21,
  JUMP: 22,
  ABORT2: 23,
  ABORT3: 24,
  RANDOM: 25,
} as const;

export const OP_NAMES = [
  "ABORT", "ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "EQUALS", "NOT_EQUALS", "LT", "GT", "LTE", "GTE", "AND", "OR", "LOGICAL_AND",
  "LOGICAL_OR", "GET_FIELD", "SET_FIELD", "PUSH", "SUBROUTINE", "EXEC", "END", "COND_JUMP", "JUMP", "ABORT2", "ABORT3", "RANDOM",
] as const;

/** Séquence que ScummVM retarde quand Goewin bloque encore la porte du Weregate (`WORKAROUND`, offset 3941). */
const WEREGATE_CLOSE_SCRIPT = 3941;
const WEREGATE_DOOR_ID = 10025;

/** Pile de 16 bits (`Common::Stack<uint16>`). */
class WordStack {
  private readonly values: number[] = [];

  push(v: number): void {
    this.values.push(v & 0xffff);
  }

  pop(): number {
    return this.values.pop() ?? 0;
  }

  get empty(): boolean {
    return this.values.length === 0;
  }

  clear(): void {
    this.values.length = 0;
  }
}

export class Script {
  /** Profondeur d'appels imbriqués (une méthode native peut exécuter une séquence) : garde-fou contre une récursion sans fin. */
  private depth = 0;
  /** Séquences exécutées, dans l'ordre (tests, journal) ; bornée. */
  readonly trace: number[] = [];

  constructor(private readonly ctx: LureContext) {}

  /** `Script::execute(startOffset)` : rend le champ `SEQUENCE_RESULT`. */
  execute(startOffset: number): number {
    const ctx = this.ctx;
    const fields = ctx.world.fields;
    const segment = ctx.data.scripts;

    if (startOffset === WEREGATE_CLOSE_SCRIPT) {
      // WORKAROUND de ScummVM : la porte du Weregate ne se ferme pas tant que Goewin est dans l'embrasure.
      const goewin = ctx.world.getActiveHotspot(HotspotId.GOEWIN);
      if (goewin && !goewin.doorCloseCheck(WEREGATE_DOOR_ID)) {
        ctx.delays.add(1, startOffset, false);
        return 0;
      }
    }

    if (++this.depth > 32) {
      this.depth = 0;
      throw new Error(`séquence ${startOffset.toString(16)} : appels imbriqués trop profonds`);
    }
    this.trace.push(startOffset);
    if (this.trace.length > 1000) this.trace.shift();

    try {
      const stack = new WordStack();
      const methodStack: number[] = [];
      let offset = startOffset;
      let param = 0;
      fields.set(Field.SEQUENCE_RESULT, 0);

      for (;;) {
        if (offset >= segment.length) throw new Error(`séquence ${startOffset.toString(16)} : décalage ${offset} invalide`);
        let opcode = segment.u8(offset++);
        const hasParam = (opcode & 1) !== 0;
        opcode >>= 1;
        if (hasParam) {
          if (offset >= segment.length - 2) throw new Error(`séquence ${startOffset.toString(16)} : décalage ${offset} invalide`);
          param = segment.u16(offset);
          offset += 2;
        }

        let v1: number;
        let v2: number;
        switch (opcode) {
          case Op.ABORT:
          case Op.ABORT2:
          case Op.ABORT3:
            methodStack.length = 0;
            break;
          case Op.ADD:
            stack.push(stack.pop() + stack.pop());
            break;
          case Op.SUBTRACT:
            v1 = stack.pop();
            v2 = stack.pop();
            stack.push(v2 - v1);
            break;
          case Op.MULTIPLY: {
            const product = stack.pop() * stack.pop();
            stack.push(product & 0xffff);
            param = (product >>> 16) & 0xffff;
            break;
          }
          case Op.DIVIDE:
            v1 = stack.pop();
            v2 = stack.pop();
            if (v1 === 0) throw new Error(`séquence ${startOffset.toString(16)} : division par zéro`);
            stack.push(Math.trunc(v2 / v1));
            param = v2 % v1;
            break;
          case Op.EQUALS:
            stack.push(stack.pop() === stack.pop() ? 1 : 0);
            break;
          case Op.NOT_EQUALS:
            stack.push(stack.pop() !== stack.pop() ? 1 : 0);
            break;
          case Op.LT:
            v1 = stack.pop();
            v2 = stack.pop();
            stack.push(v2 < v1 ? 1 : 0);
            break;
          case Op.GT:
            v1 = stack.pop();
            v2 = stack.pop();
            stack.push(v2 > v1 ? 1 : 0);
            break;
          case Op.LTE:
            v1 = stack.pop();
            v2 = stack.pop();
            stack.push(v2 <= v1 ? 1 : 0);
            break;
          case Op.GTE:
            v1 = stack.pop();
            v2 = stack.pop();
            stack.push(v2 >= v1 ? 1 : 0);
            break;
          case Op.AND:
            stack.push(stack.pop() & stack.pop());
            break;
          case Op.OR:
            stack.push(stack.pop() | stack.pop());
            break;
          case Op.LOGICAL_AND:
            v1 = stack.pop();
            v2 = stack.pop();
            stack.push(v1 !== 0 && v2 !== 0 ? 1 : 0);
            break;
          case Op.LOGICAL_OR:
            v1 = stack.pop();
            v2 = stack.pop();
            stack.push(v1 !== 0 || v2 !== 0 ? 1 : 0);
            break;
          case Op.GET_FIELD:
            stack.push(fields.get(param >> 1));
            break;
          case Op.SET_FIELD:
            fields.set(param >> 1, stack.pop());
            break;
          case Op.PUSH:
            stack.push(param);
            break;
          case Op.SUBROUTINE:
            methodStack.push(offset);
            offset = param;
            break;
          case Op.EXEC: {
            const p1 = stack.empty ? 0 : stack.pop();
            const p2 = stack.empty ? 0 : stack.pop();
            const p3 = stack.empty ? 0 : stack.pop();
            ctx.methods.call(param, p1, p2, p3);
            break;
          }
          case Op.COND_JUMP:
            v1 = stack.pop();
            if (v1 === 0) offset = (offset + ((param << 16) >> 16)) & 0xffff;
            break;
          case Op.JUMP:
            offset = (offset + ((param << 16) >> 16)) & 0xffff;
            break;
          case Op.RANDOM:
            param = ctx.rng.number(0xffff) >> 8;
            break;
          case Op.END:
            if (methodStack.length > 0) offset = methodStack.pop()!;
            else return fields.get(Field.SEQUENCE_RESULT);
            break;
          default:
            throw new Error(`séquence ${startOffset.toString(16)} : opcode ${opcode} inconnu`);
        }
      }
    } finally {
      this.depth--;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Désassembleur
// ---------------------------------------------------------------------------------------------------------------------------------

export interface ScriptOp {
  offset: number;
  opcode: number;
  /** Paramètre de 16 bits, `undefined` si l'opcode n'en a pas. */
  param?: number;
  /** Taille en octets (1 ou 3). */
  size: number;
}

/** Décode l'instruction à `offset` (lève si l'opcode est inconnu ou si elle déborde du segment). */
export function decodeOp(segment: Segment, offset: number): ScriptOp {
  const byte = segment.u8(offset);
  const opcode = byte >> 1;
  if (opcode > Op.RANDOM) throw new Error(`opcode ${opcode} inconnu à ${offset.toString(16)}`);
  if ((byte & 1) === 0) return { offset, opcode, size: 1 };
  if (offset + 1 >= segment.length - 2) throw new Error(`paramètre hors du segment à ${offset.toString(16)}`);
  return { offset, opcode, param: segment.u16(offset + 1), size: 3 };
}

/** Cible d'un saut relatif (`offset` de l'instruction suivante + paramètre signé). */
export function jumpTarget(op: ScriptOp): number {
  return (op.offset + op.size + (((op.param ?? 0) << 16) >> 16)) & 0xffff;
}

export interface DecodedSequence {
  start: number;
  /** Instructions atteignables, triées par décalage. */
  ops: ScriptOp[];
  /** Sous-séquences appelées (`SUBROUTINE`). */
  subroutines: number[];
  /** Méthodes natives appelées (`EXEC`), avec le décalage de l'appel. */
  methods: Array<{ method: number; offset: number }>;
}

/**
 * Désassemble la séquence qui commence à `start` en suivant le flot (suite, `JUMP`, `COND_JUMP`), jusqu'aux `END` ; les sous-séquences
 * ne sont pas suivies mais listées. Lève si une instruction atteignable est invalide, sort du segment ou si deux instructions se
 * chevauchent.
 */
export function disassemble(segment: Segment, start: number): DecodedSequence {
  const ops = new Map<number, ScriptOp>();
  const covered = new Map<number, number>();
  const pending = [start];
  const subroutines = new Set<number>();
  const methods: Array<{ method: number; offset: number }> = [];
  while (pending.length > 0) {
    let offset = pending.pop()!;
    for (;;) {
      if (ops.has(offset)) break;
      if (offset < 0 || offset >= segment.length) throw new Error(`séquence ${start.toString(16)} : saut hors du segment (${offset})`);
      const op = decodeOp(segment, offset);
      for (let i = 0; i < op.size; i++) {
        const owner = covered.get(offset + i);
        if (owner !== undefined) throw new Error(`séquence ${start.toString(16)} : instructions qui se chevauchent à ${(offset + i).toString(16)}`);
        covered.set(offset + i, offset);
      }
      ops.set(offset, op);
      if (op.opcode === Op.EXEC) methods.push({ method: op.param ?? 0, offset });
      if (op.opcode === Op.SUBROUTINE) subroutines.add(op.param ?? 0);
      if (op.opcode === Op.END) break;
      if (op.opcode === Op.JUMP) {
        offset = jumpTarget(op);
        continue;
      }
      if (op.opcode === Op.COND_JUMP) pending.push(jumpTarget(op));
      offset += op.size;
    }
  }
  return {
    start,
    ops: [...ops.values()].sort((a, b) => a.offset - b.offset),
    subroutines: [...subroutines].sort((a, b) => a - b),
    methods: methods.sort((a, b) => a.offset - b.offset),
  };
}

/** Texte d'une instruction (`GET_FIELD` / `SET_FIELD` montrent le numéro de champ, comme le débogueur de ScummVM). */
export function formatOp(op: ScriptOp, methodName?: (index: number) => string): string {
  const name = OP_NAMES[op.opcode] ?? `?${op.opcode}`;
  if (op.param === undefined) return `${op.offset.toString(16).padStart(4, "0")}  ${name}`;
  let arg = String(op.param);
  if (op.opcode === Op.GET_FIELD || op.opcode === Op.SET_FIELD) arg = `champ ${op.param >> 1}`;
  else if (op.opcode === Op.JUMP || op.opcode === Op.COND_JUMP) arg = `-> ${jumpTarget(op).toString(16)}`;
  else if (op.opcode === Op.SUBROUTINE) arg = op.param.toString(16);
  else if (op.opcode === Op.EXEC && methodName) arg = `${op.param} ${methodName(op.param)}`;
  return `${op.offset.toString(16).padStart(4, "0")}  ${name} ${arg}`;
}
