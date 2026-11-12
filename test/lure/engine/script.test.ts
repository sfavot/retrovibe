import { describe, expect, it } from "vitest";
import { ScummvmRandom } from "../../../src/engine/rng";
import { Segment } from "../../../src/games/lure/data/lure-dat";
import type { LureContext } from "../../../src/games/lure/engine/context";
import { Field } from "../../../src/games/lure/engine/ids";
import { METHOD_CATALOG } from "../../../src/games/lure/engine/methods/catalog";
import { Op, Script, decodeOp, disassemble, formatOp } from "../../../src/games/lure/engine/script";
import { ValueTable } from "../../../src/games/lure/engine/state";
import { lureData } from "../data/catalog-helper";
import { allSequences } from "./sequences";
import { hasOriginalFiles } from "./test-host";

/** Encode une instruction : octet `opcode << 1 | 1` suivi du paramètre petit-boutiste, ou `opcode << 1` seul. */
function op(code: number, param?: number): number[] {
  if (param === undefined) return [code << 1];
  return [(code << 1) | 1, param & 0xff, (param >> 8) & 0xff];
}

function machine(code: number[][]) {
  const bytes = Uint8Array.from([...code.flat(), 0, 0, 0]);
  const fields = new ValueTable();
  const calls: number[][] = [];
  const ctx = {
    world: { fields, getActiveHotspot: () => null },
    data: { scripts: new Segment(bytes) },
    methods: { call: (index: number, p1: number, p2: number, p3: number) => calls.push([index, p1, p2, p3]) },
    rng: new ScummvmRandom(1),
    delays: { add: () => {} },
  } as unknown as LureContext;
  return { script: new Script(ctx), fields, calls, segment: new Segment(bytes) };
}

describe("machine à pile (Script::execute)", () => {
  it("calcule sur 16 bits et rend SEQUENCE_RESULT", () => {
    const { script, fields } = machine([
      op(Op.PUSH, 7),
      op(Op.PUSH, 3),
      op(Op.SUBTRACT),
      op(Op.PUSH, 0xffff),
      op(Op.ADD),
      op(Op.SET_FIELD, Field.GENERAL << 1),
      op(Op.PUSH, 300),
      op(Op.PUSH, 300),
      op(Op.MULTIPLY),
      op(Op.SET_FIELD, 20 << 1),
      op(Op.PUSH, 17),
      op(Op.PUSH, 5),
      op(Op.DIVIDE),
      op(Op.SET_FIELD, Field.SEQUENCE_RESULT << 1),
      op(Op.END),
    ]);
    expect(script.execute(0)).toBe(3);
    expect(fields.get(Field.GENERAL)).toBe(3);
    expect(fields.get(20)).toBe((300 * 300) & 0xffff);
  });

  it("compare dans l'ordre de ScummVM (second dépilé contre premier)", () => {
    const results: number[] = [];
    for (const [opcode, a, b] of [
      [Op.LT, 2, 5],
      [Op.GT, 2, 5],
      [Op.LTE, 5, 5],
      [Op.GTE, 4, 5],
      [Op.EQUALS, 5, 5],
      [Op.NOT_EQUALS, 5, 5],
      [Op.LOGICAL_AND, 1, 0],
      [Op.LOGICAL_OR, 1, 0],
      [Op.AND, 6, 3],
      [Op.OR, 6, 3],
    ] as const) {
      const { script } = machine([op(Op.PUSH, a), op(Op.PUSH, b), op(opcode), op(Op.SET_FIELD, Field.SEQUENCE_RESULT << 1), op(Op.END)]);
      results.push(script.execute(0));
    }
    expect(results).toEqual([1, 0, 1, 0, 1, 0, 0, 1, 2, 7]);
  });

  it("saute (relatif, signé), appelle une sous-séquence et revient", () => {
    // 0: PUSH 0 ; 3: COND_JUMP +3 -> 9 ; 6: PUSH 99 (sauté) ; ... ; 9: SUBROUTINE 16 ; 12: END ; 16: PUSH 42 ; SET_FIELD ; END
    const code = [op(Op.PUSH, 0), op(Op.COND_JUMP, 3), op(Op.JUMP, 0), op(Op.SUBROUTINE, 16), op(Op.END), [0, 0, 0]];
    code.push(op(Op.PUSH, 42), op(Op.SET_FIELD, Field.SEQUENCE_RESULT << 1), op(Op.END));
    const { script } = machine(code);
    expect(script.execute(0)).toBe(42);
  });

  it("appelle une méthode native avec trois valeurs dépilées (0 si la pile est vide)", () => {
    const { script, calls } = machine([op(Op.PUSH, 9), op(Op.PUSH, 8), op(Op.EXEC, 12), op(Op.EXEC, 3), op(Op.END)]);
    script.execute(0);
    expect(calls).toEqual([
      [12, 8, 9, 0],
      [3, 0, 0, 0],
    ]);
  });

  it("ABORT vide la pile des retours : END termine alors la séquence", () => {
    const code = [op(Op.SUBROUTINE, 6), op(Op.PUSH, 1), op(Op.END)];
    code.push(op(Op.ABORT), op(Op.END));
    const { script, fields } = machine(code);
    fields.set(Field.GENERAL, 5);
    expect(script.execute(0)).toBe(0);
  });

  it("refuse un opcode inconnu", () => {
    const { script } = machine([[26 << 1]]);
    expect(() => script.execute(0)).toThrow(/opcode 26/);
  });
});

describe("désassembleur", () => {
  it("suit les sauts et liste méthodes et sous-séquences", () => {
    const code = [op(Op.PUSH, 0), op(Op.COND_JUMP, 4), op(Op.EXEC, 16), op(Op.END), op(Op.SUBROUTINE, 0), op(Op.END)];
    const { segment } = machine(code);
    const decoded = disassemble(segment, 0);
    expect(decoded.ops.map((o) => o.opcode)).toEqual([Op.PUSH, Op.COND_JUMP, Op.EXEC, Op.END, Op.SUBROUTINE, Op.END]);
    expect(decoded.methods).toEqual([{ method: 16, offset: 6 }]);
    expect(decoded.subroutines).toEqual([0]);
    expect(formatOp(decoded.ops[1]!)).toBe("0003  COND_JUMP -> a");
    expect(formatOp(decoded.ops[2]!, (i) => METHOD_CATALOG[i]!.name)).toBe("0006  EXEC 16 displayDialog");
  });
});

describe.skipIf(!hasOriginalFiles)("séquences de 0x3F0C (vrais fichiers)", () => {
  it("chaque instruction du segment se décode d'un bout à l'autre", () => {
    const segment = lureData().scripts;
    let offset = 0;
    let count = 0;
    while (offset < segment.length - 3) {
      offset += decodeOp(segment, offset).size;
      count++;
    }
    expect(count).toBeGreaterThan(4000);
  });

  it("chaque séquence citée par les données et le code se décode, et n'appelle que des méthodes du catalogue", () => {
    const data = lureData();
    const sequences = allSequences(data);
    expect(sequences.size).toBeGreaterThan(280);
    const covered = new Set<number>();
    const methods = new Set<number>();
    for (const offset of sequences.keys()) {
      const decoded = disassemble(data.scripts, offset);
      for (const o of decoded.ops) for (let i = 0; i < o.size; i++) covered.add(o.offset + i);
      for (const m of decoded.methods) methods.add(m.method);
    }
    for (const m of methods) expect(METHOD_CATALOG[m], `méthode ${m}`).toBeDefined();
    // 90 % du segment est atteint ; le reste n'est cité nulle part dans les données (séquences mortes ou citées par des valeurs calculées).
    expect(covered.size / data.scripts.length).toBeGreaterThan(0.9);
    // Toutes les méthodes servent, sauf `npcWait` (45), `checkWakeBrenda` (46, appelée par une séquence calculée) et `setNewSupportData` (48).
    expect([...Array(67).keys()].filter((i) => !methods.has(i))).toEqual([45, 46, 48]);
  });
});
