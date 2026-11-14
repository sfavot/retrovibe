import { describe, expect, it } from "vitest";
import { Interpreter, Op, ScriptError, type ScriptHost } from "../../../src/games/bass/engine/script";
import { IDO_GLASS, IDO_SHADES, NUM_SCRIPT_VARS, Script, Var } from "../../../src/games/bass/engine/ids";

/** Opcodes avec leurs opérandes (mots). */
const PUSH = (n: number) => [Op.PUSH_NUMBER, n];
const PUSHV = (v: number) => [Op.PUSH_VARIABLE, v * 4];
const POPV = (v: number) => [Op.POP_VAR, v * 4];
const MCODE = (argc: number, num: number) => [Op.CALL_MCODE, argc, num * 4];
const EXIT = [Op.SCRIPT_EXIT];

interface Machine {
  host: ScriptHost;
  interp: Interpreter;
  vars: Uint32Array;
  cpt: Uint16Array;
  calls: number[][];
  /** Valeur rendue par les mcodes (faux = suspendre). */
  answers: boolean[];
}

/** Module 0 : table des scripts puis code ; `scripts[i]` est le script de rang i. */
function machine(...scripts: number[][]): Machine {
  const table = scripts.length;
  const words: number[] = [];
  let pos = table;
  for (const s of scripts) {
    words.push(pos);
    pos += s.length;
  }
  for (const s of scripts) words.push(...s);
  const module = new Uint16Array(words);
  const vars = new Uint32Array(NUM_SCRIPT_VARS);
  const cpt = new Uint16Array(64);
  const calls: number[][] = [];
  const answers: boolean[] = [];
  const host: ScriptHost = {
    vars,
    compacts: { getElem: (c, off) => c[off]!, setElem: (c, off, v) => void (c[off] = v) },
    compact: cpt,
    module: (n) => {
      if (n !== 0) throw new Error(`module ${n}`);
      return module;
    },
    mcode: (num, a, b, c) => {
      calls.push([num, a, b, c]);
      return answers.shift() ?? true;
    },
  };
  return { host, interp: new Interpreter(host), vars, cpt, calls, answers };
}

/** Lance le script 0 et rend la variable 0 (`RESULT`) ; le script range son résultat par `pop_var 0`. */
function result(code: number[]): number {
  const m = machine([...code, ...POPV(0), ...EXIT]);
  expect(m.interp.run(0, 0)).toBe(0);
  return m.vars[0]!;
}

describe("interpréteur (Logic::script)", () => {
  it("push_variable / pop_var adressent les variables en octets", () => {
    const m = machine([...PUSHV(5), ...POPV(7), ...EXIT]);
    m.vars[5] = 0xdeadbeef;
    m.interp.run(0, 0);
    expect(m.vars[7]).toBe(0xdeadbeef);
  });

  it("less_than empile sommet > suivant (x < y pour push x, push y), more_than l'inverse, comme ScummVM", () => {
    expect(result([...PUSH(3), ...PUSH(5), Op.LESS_THAN])).toBe(1);
    expect(result([...PUSH(5), ...PUSH(3), Op.LESS_THAN])).toBe(0);
    expect(result([...PUSH(5), ...PUSH(5), Op.LESS_THAN])).toBe(0);
    expect(result([...PUSH(5), ...PUSH(3), Op.MORE_THAN])).toBe(1);
    expect(result([...PUSH(3), ...PUSH(5), Op.MORE_THAN])).toBe(0);
    expect(result([...PUSH(5), ...PUSH(5), Op.MORE_THAN])).toBe(0);
  });

  it("not_equal, is_equal, if_and, if_or rendent 0 ou 1", () => {
    expect(result([...PUSH(2), ...PUSH(3), Op.NOT_EQUAL])).toBe(1);
    expect(result([...PUSH(3), ...PUSH(3), Op.NOT_EQUAL])).toBe(0);
    expect(result([...PUSH(3), ...PUSH(3), Op.IS_EQUAL])).toBe(1);
    expect(result([...PUSH(7), ...PUSH(9), Op.IF_AND])).toBe(1);
    expect(result([...PUSH(0), ...PUSH(9), Op.IF_AND])).toBe(0);
    expect(result([...PUSH(0), ...PUSH(9), Op.IF_OR])).toBe(1);
    expect(result([...PUSH(0), ...PUSH(0), Op.IF_OR])).toBe(0);
  });

  it("minus (suivant - sommet) et plus calculent sur 32 bits non signés", () => {
    expect(result([...PUSH(10), ...PUSH(3), Op.MINUS])).toBe(7);
    expect(result([...PUSH(0), ...PUSH(1), Op.MINUS])).toBe(0xffffffff);
    expect(result([...PUSHV(9), ...PUSH(2), Op.PLUS])).toBe(2);
    const m = machine([...PUSHV(9), ...PUSH(2), Op.PLUS, ...POPV(0), ...EXIT]);
    m.vars[9] = 0xffffffff;
    m.interp.run(0, 0);
    expect(m.vars[0]).toBe(1);
  });

  it("skip_zero saute si zéro, skip_always toujours, skip_nz en arrière (décalage signé, en octets)", () => {
    // skip_zero de 4 octets (2 mots) : saute `push 1`.
    expect(result([...PUSH(0), Op.SKIP_ZERO, 4, ...PUSH(1), ...PUSH(2)])).toBe(2);
    expect(result([...PUSH(5), Op.SKIP_ZERO, 4, ...PUSH(1), ...POPV(0), ...EXIT])).toBe(1);
    expect(result([Op.SKIP_ALWAYS, 4, ...PUSH(1), ...PUSH(2)])).toBe(2);
    // Boucle : var1 = 3 ; tant que var1 : var1 -= 1, var0 += 1.
    const loop = [
      ...PUSH(3), ...POPV(1),
      // début (position 4 dans le script)
      ...PUSHV(0), ...PUSH(1), Op.PLUS, ...POPV(0),
      ...PUSHV(1), ...PUSH(1), Op.MINUS, ...POPV(1),
      ...PUSHV(1), Op.SKIP_NZ, 0, ...EXIT,
    ];
    const back = 4 - (loop.length - 1); // position du début - position après l'opérande
    loop[loop.length - 2] = (back * 2) & 0xffff;
    const m = machine(loop);
    m.interp.run(0, 0);
    expect(m.vars[0]).toBe(3);
    expect(m.vars[1]).toBe(0);
  });

  it("switch : cas trouvé (décalage depuis la valeur) ou défaut", () => {
    // switch, 2 cas : valeur aux positions 4 et 6, cible = position de la valeur + décalage / 2 + 1 ; défaut depuis la position 8.
    const sw = (value: number) => {
      const code = [...PUSH(value), Op.SWITCH, 2, 10, 8, 20, 14, 22];
      code.push(...PUSH(100), ...POPV(0), ...EXIT, ...PUSH(200), ...POPV(0), ...EXIT, ...PUSH(999), ...POPV(0), ...EXIT);
      const m = machine(code);
      m.interp.run(0, 0);
      return m.vars[0];
    };
    expect(sw(10)).toBe(100);
    expect(sw(20)).toBe(200);
    expect(sw(30)).toBe(999);
  });

  it("push_offset / pop_offset lisent et écrivent le compact courant sur 16 bits", () => {
    const m = machine([Op.PUSH_OFFSET, 3, ...PUSH(1), Op.PLUS, Op.POP_OFFSET, 4, ...EXIT]);
    m.cpt[3] = 0xffff;
    m.interp.run(0, 0);
    expect(m.cpt[4]).toBe(0); // 0x10000 tronqué
  });

  it("call_mcode dépile ses arguments ; ceux qui manquent gardent les valeurs locales précédentes", () => {
    const m = machine([
      ...PUSH(1), ...PUSH(2), ...PUSH(3), ...MCODE(3, 40),
      ...PUSH(7), ...MCODE(1, 41), // b et c gardent 2 et 3
      ...MCODE(0, 42), // a = 0 (nombre d'arguments)
      ...PUSH(4), ...PUSH(5), Op.IS_EQUAL, Op.SKIP_ZERO, 0, // a = 5, b = 4 (is_equal)
      ...MCODE(0, 43),
      ...EXIT,
    ]);
    m.interp.run(0, 0);
    expect(m.calls).toEqual([
      [40, 1, 2, 3],
      [41, 7, 2, 3],
      [42, 0, 2, 3],
      [43, 0, 4, 3],
    ]);
  });

  it("un mcode qui rend faux suspend le script ; la reprise continue à l'instruction suivante", () => {
    const m = machine([...MCODE(0, 1), ...PUSH(9), ...POPV(0), ...EXIT]);
    m.answers.push(false);
    const resume = m.interp.run(0, 0);
    expect(resume).toBe(1 + 3); // table (1 mot) + call_mcode (3 mots)
    expect(m.vars[0]).toBe(0);
    expect(m.interp.run(0, resume)).toBe(0);
    expect(m.vars[0]).toBe(9);
  });

  it("le compact courant est rétabli après un mcode qui le change", () => {
    const m = machine([...MCODE(0, 1), Op.PUSH_OFFSET, 0, ...POPV(0), ...EXIT]);
    const other = new Uint16Array(4).fill(77);
    m.cpt[0] = 5;
    m.host.mcode = () => {
      m.host.compact = other;
      return true;
    };
    m.interp.run(0, 0);
    expect(m.vars[0]).toBe(5);
  });

  it("script_exit (13 et 19) rend 0 ; restart_script reprend au début avec a, b, c remis à 0", () => {
    expect(machine([Op.SCRIPT_EXIT_13]).interp.run(0, 0)).toBe(0);
    const m = machine([...PUSHV(1), Op.SKIP_ZERO, 2, Op.SCRIPT_EXIT, ...PUSH(1), ...POPV(1), ...MCODE(0, 5), Op.RESTART_SCRIPT]);
    // Premier passage : var1 = 0 → saute la sortie, var1 = 1, mcode (a = 0, b = 1 du pop_var), redémarre ; second passage : sortie.
    m.interp.run(0, 0);
    expect(m.calls).toEqual([[5, 0, 1, 0]]);
  });

  it("opcode inconnu, pile pleine, pile vide : erreurs", () => {
    expect(() => machine([99]).interp.run(0, 0)).toThrow(ScriptError);
    const push = Array.from({ length: 20 }, () => PUSH(1)).flat();
    expect(() => machine([...push, ...EXIT]).interp.run(0, 0)).toThrow(/Stack overflow/);
    expect(() => machine([Op.PLUS, ...EXIT]).interp.run(0, 0)).toThrow(/No items/);
  });

  it("la pile est partagée par les appels imbriqués", () => {
    const m = machine([...PUSH(11), ...MCODE(0, 1), ...POPV(0), ...EXIT], [...PUSH(22), ...EXIT]);
    m.host.mcode = () => {
      m.interp.run(1, 0); // laisse 22 sur la pile
      return true;
    };
    m.interp.run(0, 0);
    expect(m.vars[0]).toBe(22);
    expect(m.interp.sp).toBe(1);
  });

  it("rustine 5567 : les lunettes noires données à Trevor deviennent le verre", () => {
    const m = machine([...EXIT]);
    m.vars[Var.OBJECT_HELD] = IDO_SHADES;
    // Le module 3 est demandé pour TREVOR_SPEECH : on rend le même code.
    m.host.module = () => new Uint16Array(0x200).fill(0x13e).fill(Op.SCRIPT_EXIT, 0x13e);
    m.interp.run(Script.TREVOR_SPEECH, 0);
    expect(m.vars[Var.OBJECT_HELD]).toBe(IDO_GLASS);
  });
});
