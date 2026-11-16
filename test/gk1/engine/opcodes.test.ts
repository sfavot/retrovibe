import { describe, expect, it } from "vitest";
import { Segment } from "../../../src/games/gk1/engine/ids";
import { makeReg, regOffset, regSegment, SciError } from "../../../src/games/gk1/engine/memory";
import {
  INVALID_OPCODES,
  Op,
  OPCODE_COUNT,
  OPERAND_FORMATS,
  VAR_INDEXED,
  VAR_OPERATION_MASK,
  VAR_OPERATION_SHIFT,
  VAR_STACK,
  VAR_TYPE_MASK,
  VariableOperation,
  VariableType,
} from "../../../src/games/gk1/engine/opcodes";
import { RunStatus } from "../../../src/games/gk1/engine/vm";
import { ins, makeWorld, runCode, runToEnd } from "./synthetic";

const ret = ins(Op.Ret);
const u16 = (value: number): number => value & 0xffff;

/** `gauche OP droite` : la gauche vient de la pile, la droite de l'accumulateur. */
function binary(op: number, left: number, right: number): number {
  return runCode([...ins(Op.Pushi, [left]), ...ins(Op.Ldi, [right]), ...ins(op), ...ret]).acc;
}

describe("opcodes arithmétiques et logiques", () => {
  it.each([
    ["add", Op.Add, 7, 5, 12],
    ["add (retour à zéro)", Op.Add, 0xffff, 2, 1],
    ["sub", Op.Sub, 7, 5, 2],
    ["sub (négatif)", Op.Sub, 5, 7, u16(-2)],
    ["mul", Op.Mul, 7, 5, 35],
    ["mul (signé)", Op.Mul, u16(-3), 4, u16(-12)],
    ["mul (16 bits)", Op.Mul, 300, 300, (300 * 300) & 0xffff],
    ["div", Op.Div, 17, 5, 3],
    ["div (tronquée vers zéro)", Op.Div, u16(-17), 5, u16(-3)],
    ["mod", Op.Mod, 17, 5, 2],
    ["mod (jamais négatif)", Op.Mod, u16(-17), 5, 3],
    ["mod (diviseur négatif)", Op.Mod, 17, u16(-5), 2],
    ["shr (non signé)", Op.Shr, 0x8000, 15, 1],
    ["shr (16 bits et plus)", Op.Shr, 0xffff, 16, 0],
    ["shl", Op.Shl, 3, 2, 12],
    ["shl (16 bits)", Op.Shl, 0x8001, 1, 2],
    ["xor", Op.Xor, 0b1100, 0b1010, 0b0110],
    ["and", Op.And, 0b1100, 0b1010, 0b1000],
    ["or", Op.Or, 0b1100, 0b1010, 0b1110],
  ])("%s", (_name, op, left, right, expected) => {
    expect(binary(op, left, right)).toBe(expected);
  });

  it("div et mod par zéro rendent 0 et le signalent", () => {
    const { vm, acc } = runCode([...ins(Op.Pushi, [17]), ...ins(Op.Ldi, [0]), ...ins(Op.Div), ...ins(Op.Push), ...ins(Op.Ldi, [0]), ...ins(Op.Mod), ...ret]);
    expect(acc).toBe(0);
    expect([...vm.warnings.keys()].map((m) => m.split(" (")[0])).toEqual(["division par zéro", "modulo par zéro"]);
  });

  it.each([
    ["bnot", Op.Bnot, 0x00ff, 0xff00],
    ["neg", Op.Neg, 5, u16(-5)],
    ["neg (négatif)", Op.Neg, u16(-5), 5],
    ["not (vrai)", Op.Not, 5, 0],
    ["not (faux)", Op.Not, 0, 1],
  ])("%s", (_name, op, value, expected) => {
    expect(runCode([...ins(Op.Ldi, [value]), ...ins(op), ...ret]).acc).toBe(expected);
  });

  it.each([
    ["eq?", Op.Eq, 5, 5, 1],
    ["eq? (faux)", Op.Eq, 5, 6, 0],
    ["ne?", Op.Ne, 5, 6, 1],
    ["ne? (faux)", Op.Ne, 5, 5, 0],
    ["gt? (signé)", Op.Gt, 1, u16(-1), 1],
    ["gt? (égal)", Op.Gt, 4, 4, 0],
    ["ge?", Op.Ge, 4, 4, 1],
    ["ge? (faux)", Op.Ge, u16(-2), 1, 0],
    ["lt? (signé)", Op.Lt, u16(-1), 1, 1],
    ["lt? (égal)", Op.Lt, 4, 4, 0],
    ["le?", Op.Le, 4, 4, 1],
    ["le? (faux)", Op.Le, 5, 4, 0],
    ["ugt? (non signé)", Op.Ugt, u16(-1), 1, 1],
    ["ugt? (faux)", Op.Ugt, 1, u16(-1), 0],
    ["uge?", Op.Uge, 4, 4, 1],
    ["uge? (faux)", Op.Uge, 1, u16(-1), 0],
    ["ult? (non signé)", Op.Ult, 1, u16(-1), 1],
    ["ult? (faux)", Op.Ult, u16(-1), 1, 0],
    ["ule?", Op.Ule, 4, 4, 1],
    ["ule? (faux)", Op.Ule, u16(-1), 1, 0],
  ])("%s", (_name, op, left, right, expected) => {
    const { vm, acc } = runCode([...ins(Op.Pushi, [left]), ...ins(Op.Ldi, [right]), ...ins(op), ...ret]);
    expect(acc).toBe(expected);
    // Une comparaison garde son opérande droit dans `prev`.
    expect(vm.prev).toBe(right);
  });

  it("pprev empile l'opérande droit de la dernière comparaison", () => {
    // (3 < 9) puis (prev=9 <= 9) : chaîne de comparaisons du compilateur.
    const code = [...ins(Op.Pushi, [3]), ...ins(Op.Ldi, [9]), ...ins(Op.Lt), ...ins(Op.Pprev), ...ins(Op.Ldi, [9]), ...ins(Op.Le), ...ret];
    expect(runCode(code).acc).toBe(1);
  });

  it("refuse l'arithmétique sur deux références", () => {
    expect(() => runCode((link) => [...ins(Op.Lofss, [link.string("texte")]), ...ins(Op.Lofsa, [link.string("texte")]), ...ins(Op.Add), ...ret], { strings: ["texte"] })).toThrow(/deux références/);
  });
});

describe("opcodes de pile et de saut", () => {
  it("ldi, push, pushi, push0, push1, push2, dup, toss", () => {
    const code = [
      ...ins(Op.Push2), // 2
      ...ins(Op.Push1), // 2 1
      ...ins(Op.Push0), // 2 1 0
      ...ins(Op.Toss), // 2 1
      ...ins(Op.Dup), // 2 1 1
      ...ins(Op.Ldi, [10]),
      ...ins(Op.Push), // 2 1 1 10
      ...ins(Op.Pushi, [u16(-4)]), // 2 1 1 10 -4
      ...ins(Op.Ldi, [0]),
      ...ins(Op.Add), // -4
      ...ins(Op.Add), // 6
      ...ins(Op.Add), // 7
      ...ins(Op.Add), // 8
      ...ins(Op.Add), // 10
      ...ret,
    ];
    expect(runCode(code).acc).toBe(10);
  });

  it("ldi et pushi signés, sur un ou deux octets", () => {
    expect(runCode([...ins(Op.Ldi, [0xfe], true), ...ret]).acc).toBe(u16(-2));
    expect(runCode([...ins(Op.Ldi, [0x1234]), ...ret]).acc).toBe(0x1234);
    expect(runCode([...ins(Op.Pushi, [0x80], true), ...ins(Op.Ldi, [0]), ...ins(Op.Add), ...ret]).acc).toBe(u16(-128));
  });

  it.each([
    ["bt saute si vrai", Op.Bt, 1, 1],
    ["bt continue si faux", Op.Bt, 0, 2],
    ["bnt saute si faux", Op.Bnt, 0, 1],
    ["bnt continue si vrai", Op.Bnt, 5, 2],
    ["jmp saute toujours", Op.Jmp, 0, 1],
  ])("%s", (_name, op, condition, expected) => {
    const skipped = [...ins(Op.Ldi, [2]), ...ret];
    for (const byteForm of [false, true]) {
      const code = [...ins(Op.Ldi, [condition]), ...ins(op, [skipped.length], byteForm), ...skipped, ...ins(Op.Ldi, [1]), ...ret];
      expect(runCode(code).acc).toBe(expected);
    }
  });

  it("jmp en arrière : une boucle", () => {
    // temp0 = 5 ; acc cumule 5+4+3+2+1 dans temp1.
    const body = [
      ...ins(Op.FirstVariable | VariableType.Temp | VAR_STACK, [0]), // lst 0
      ...ins(Op.FirstVariable | VariableType.Temp, [1]), // lat 1
      ...ins(Op.Add),
      ...ins(Op.FirstVariable | VariableType.Temp | (VariableOperation.Store << VAR_OPERATION_SHIFT), [1]), // sat 1
      ...ins(Op.FirstVariable | VariableType.Temp | (VariableOperation.Decrement << VAR_OPERATION_SHIFT), [0]), // -at 0
    ];
    const back = ins(Op.Bt, [0]).length;
    const code = [
      ...ins(Op.Link, [2]),
      ...ins(Op.Ldi, [5]),
      ...ins(Op.FirstVariable | VariableType.Temp | (VariableOperation.Store << VAR_OPERATION_SHIFT), [0]),
      ...ins(Op.Ldi, [0]),
      ...ins(Op.FirstVariable | VariableType.Temp | (VariableOperation.Store << VAR_OPERATION_SHIFT), [1]),
      ...body,
      ...ins(Op.Bt, [u16(-(body.length + back))]),
      ...ins(Op.FirstVariable | VariableType.Temp, [1]),
      ...ret,
    ];
    expect(runCode(code).acc).toBe(15);
  });

  it("link réserve des variables temporaires ; les lire avant de les écrire donne 0 et un avertissement", () => {
    const { vm, acc } = runCode([...ins(Op.Ldi, [9]), ...ins(Op.Link, [3]), ...ins(Op.FirstVariable | VariableType.Temp, [2]), ...ret]);
    expect(acc).toBe(0);
    expect(vm.warnings.size).toBe(1);
  });

  it("refuse les opcodes sans instruction et les opcodes de débogage", () => {
    for (const op of INVALID_OPCODES) expect(() => runCode([op << 1, 0, 0, ...ret])).toThrow(SciError);
    expect(() => runCode([0x7d, 0x41, 0, ...ret])).toThrow(/débogage/);
  });

  it("le plafond d'instructions rend la main puis l'exécution reprend", () => {
    const { vm, built } = makeWorld([{ number: 0, locals: [0], exports: [[...ins(Op.Ldi, [1]), ...ins(Op.Ldi, [2]), ...ins(Op.Ldi, [3]), ...ret]] }]);
    vm.useGlobals(vm.scripts.instantiate(0).localsSegment);
    vm.startProcedure(0, built.get(0)!.procedures.get(0)!, []);
    expect(vm.run(2)).toEqual({ status: RunStatus.Slice });
    expect(vm.acc).toBe(2);
    expect(vm.run(2)).toEqual({ status: RunStatus.Finished });
    expect(vm.acc).toBe(3);
    expect(vm.instructionCount).toBe(4);
  });
});

describe("opcodes de variables", () => {
  const GLOBALS = [100, 101, 102, 103];
  const LOCALS = [200, 201, 202, 203];
  const TEMPS = [400, 401, 402, 403];
  const ARGS = [300, 301, 302];
  const PARAMS = [ARGS.length, ...ARGS];
  const STORED = 55;
  const ACC = 7;
  /** Pile au départ : argc et arguments en 0..3, variables temporaires en 4..7, premier empilement en 8. */
  const TEMP_BASE = 4;
  const STACK_TOP = 8;

  const setTemp = (i: number) => [...ins(Op.Ldi, [TEMPS[i]]), ...ins(Op.FirstVariable | VariableType.Temp | (VariableOperation.Store << VAR_OPERATION_SHIFT), [i])];

  function runVariableOp(op: number, byteForm: boolean) {
    const indexed = (op & VAR_INDEXED) !== 0;
    const operation = (op >> VAR_OPERATION_SHIFT) & VAR_OPERATION_MASK;
    const code = [
      ...ins(Op.Link, [TEMPS.length]),
      ...TEMPS.flatMap((_, i) => setTemp(i)),
      ...(operation === VariableOperation.Store ? ins(Op.Pushi, [STORED]) : []),
      // Indexé : l'accumulateur vaut 1 et s'ajoute à l'opérande.
      ...ins(Op.Ldi, [indexed ? 1 : ACC]),
      ...ins(op, [1], byteForm),
      ...ret,
    ];
    const { vm, built } = makeWorld([
      { number: 0, locals: GLOBALS },
      { number: 5, locals: LOCALS, exports: [code] },
    ]);
    vm.useGlobals(vm.scripts.instantiate(0).localsSegment);
    const segment = vm.scripts.instantiate(5);
    vm.startProcedure(5, built.get(5)!.procedures.get(0)!, ARGS);
    runToEnd(vm);
    const stack = vm.memory.stack;
    const values = [
      [...vm.memory.localsSegment(vm.scripts.loaded(0)!.localsSegment)!.values],
      [...vm.memory.localsSegment(segment.localsSegment)!.values],
      [...stack.subarray(TEMP_BASE, TEMP_BASE + TEMPS.length)],
      [...stack.subarray(0, PARAMS.length)],
    ];
    return { acc: vm.acc, values, pushed: stack[STACK_TOP] };
  }

  const NAMES = ["global", "locale", "temporaire", "paramètre"];
  const OPERATIONS = ["charge", "range", "incrémente", "décrémente"];
  const cases: [string, number][] = [];
  for (let op = Op.FirstVariable; op < OPCODE_COUNT; op++) {
    const name = `${OPERATIONS[(op >> VAR_OPERATION_SHIFT) & VAR_OPERATION_MASK]} ${NAMES[op & VAR_TYPE_MASK]}${op & VAR_STACK ? ", pile" : ", accumulateur"}${op & VAR_INDEXED ? ", indexé" : ""}`;
    cases.push([`0x${op.toString(16)} ${name}`, op]);
  }

  it.each(cases)("%s", (_name, op) => {
    const type = op & VAR_TYPE_MASK;
    const onStack = (op & VAR_STACK) !== 0;
    const indexed = (op & VAR_INDEXED) !== 0;
    const operation = (op >> VAR_OPERATION_SHIFT) & VAR_OPERATION_MASK;
    const index = indexed ? 2 : 1;
    const expected = [GLOBALS.slice(), LOCALS.slice(), TEMPS.slice(), PARAMS.slice()];
    const before = expected[type][index];
    const accBefore = indexed ? 1 : ACC;
    let acc = accBefore;
    let pushed: number | undefined;
    if (operation === VariableOperation.Load) {
      if (onStack) pushed = before;
      else acc = before;
    } else if (operation === VariableOperation.Store) {
      // Depuis la pile, ou depuis l'accumulateur ; indexé, l'accumulateur sert d'indice et la valeur vient de la pile.
      const value = onStack || indexed ? STORED : ACC;
      expected[type][index] = value;
      if (!onStack && indexed) acc = STORED;
    } else {
      const value = before + (operation === VariableOperation.Increment ? 1 : -1);
      expected[type][index] = value;
      if (onStack) pushed = value;
      else acc = value;
    }
    for (const byteForm of [false, true]) {
      const result = runVariableOp(op, byteForm);
      expect(result.values).toEqual(expected);
      expect(result.acc).toBe(acc);
      if (pushed !== undefined) expect(result.pushed).toBe(pushed);
    }
  });

  it("tous les opcodes de variables ont un opérande", () => {
    for (let op = Op.FirstVariable; op < OPCODE_COUNT; op++) expect(OPERAND_FORMATS[op]).toHaveLength(1);
  });

  it("refuse une variable globale ou locale hors limites", () => {
    expect(() => runCode([...ins(Op.FirstVariable | VariableType.Global, [50]), ...ret])).toThrow(/hors limites/);
    expect(() => runCode([...ins(Op.FirstVariable | VariableType.Local, [50]), ...ret])).toThrow(/hors limites/);
  });

  it("lea donne l'adresse d'une variable, en octets, avec ou sans indice", () => {
    // lea local 2 ; puis lea temporaire indexée par l'accumulateur.
    const first = runCode([...ins(Op.Lea, [VariableType.Local << 1, 2]), ...ret], { locals: [5, 6, 7, 8] });
    const locals = first.vm.scripts.loaded(0)!.localsSegment;
    expect(first.acc).toBe(makeReg(locals, 4));
    expect(first.vm.memory.readCell(first.acc)).toBe(7);
    expect(first.vm.memory.readCell(first.acc, 1)).toBe(8);

    const second = runCode([...ins(Op.Link, [4]), ...ins(Op.Ldi, [2]), ...ins(Op.Lea, [(VariableType.Temp | 0x08) << 1, 1]), ...ret], { args: [9] });
    // Un argument : argc en 0, l'argument en 1, les variables temporaires à partir de 2 ; temp 1 + 2 = case 5.
    expect(regSegment(second.acc)).toBe(Segment.Stack);
    expect(regOffset(second.acc)).toBe(2 * 5);

    const third = runCode([...ins(Op.Lea, [VariableType.Param << 1, 1]), ...ret], { args: [9, 8] });
    expect(third.vm.memory.readCell(third.acc)).toBe(9);
    const fourth = runCode([...ins(Op.Lea, [VariableType.Global << 1, 0]), ...ret], { locals: [42] });
    expect(fourth.vm.memory.readCell(fourth.acc)).toBe(42);
  });
});

describe("opcodes d'appel", () => {
  const lap = (i: number) => ins(Op.FirstVariable | VariableType.Param, [i]);
  const lsp = (i: number) => ins(Op.FirstVariable | VariableType.Param | VAR_STACK, [i]);

  it("call appelle une procédure du même script et ret revient avec l'accumulateur", () => {
    // sous-programme : param1 - param2 ; appelant : 100 + f(9, 4).
    const callee = [...lsp(1), ...lap(2), ...ins(Op.Sub), ...ret];
    const tail = [...ins(Op.Push), ...ins(Op.Ldi, [100]), ...ins(Op.Add), ...ret];
    for (const byteForm of [false, true]) {
      const code = [
        ...ins(Op.Pushi, [2]),
        ...ins(Op.Pushi, [9]),
        ...ins(Op.Pushi, [4]),
        ...ins(Op.Call, [tail.length, 4], byteForm),
        ...tail,
        ...callee,
      ];
      expect(runCode(code).acc).toBe(105);
    }
  });

  it("call laisse la pile de l'appelant comme avant ses arguments", () => {
    const callee = [...ins(Op.Link, [3]), ...ins(Op.Ldi, [0]), ...ret];
    const tail = [...ins(Op.Toss), ...ins(Op.Ldi, [0]), ...ins(Op.Add), ...ret];
    // 33 reste sous les arguments : après l'appel, toss retire 44 et add retrouve 33.
    const code = [...ins(Op.Pushi, [33]), ...ins(Op.Pushi, [44]), ...ins(Op.Pushi, [1]), ...ins(Op.Pushi, [7]), ...ins(Op.Call, [tail.length, 2]), ...tail, ...callee];
    expect(runCode(code).acc).toBe(33);
  });

  it("le paramètre 0 est le nombre d'arguments", () => {
    const callee = [...lap(0), ...ret];
    const tail = [...ret];
    const code = [...ins(Op.Pushi, [3]), ...ins(Op.Push0), ...ins(Op.Push0), ...ins(Op.Push0), ...ins(Op.Call, [tail.length, 6]), ...tail, ...callee];
    expect(runCode(code).acc).toBe(3);
  });

  it("&rest recopie les arguments restants et allonge l'appel suivant", () => {
    // f(a b c d) appelle g(a &rest 2), soit g(a b c d) ; g rend argc * 1000 + dernier argument.
    const g = [...lsp(0), ...ins(Op.Ldi, [1000]), ...ins(Op.Mul), ...ins(Op.Push), ...lap(4), ...ins(Op.Add), ...ret];
    const tail = [...ret];
    const f = [...ins(Op.Pushi, [1]), ...lsp(1), ...ins(Op.Rest, [2]), ...ins(Op.Call, [tail.length, 2]), ...tail, ...g];
    const { vm, acc } = runCode(f, { args: [10, 20, 30, 40] });
    expect(acc).toBe(4040);
    expect(vm.rest).toBe(0);
  });

  it("&rest au-delà du dernier argument n'ajoute rien", () => {
    const g = [...lap(0), ...ret];
    const tail = [...ret];
    const f = [...ins(Op.Pushi, [0]), ...ins(Op.Rest, [3]), ...ins(Op.Call, [tail.length, 0]), ...tail, ...g];
    expect(runCode(f, { args: [10, 20] }).acc).toBe(0);
  });

  it("callb appelle un export du script 0 et calle celui d'un autre script, chargé au besoin", () => {
    const double = [...lsp(1), ...lap(1), ...ins(Op.Add), ...ret];
    const { vm, built } = makeWorld([
      { number: 0, locals: [0], exports: [[...ret], double] },
      {
        number: 7,
        locals: [1000],
        exports: [
          // export 0 : callb 1 (21) + variable locale 0 du script 7.
          [...ins(Op.Pushi, [1]), ...ins(Op.Pushi, [21]), ...ins(Op.Callb, [1, 2]), ...ins(Op.Push), ...ins(Op.FirstVariable | VariableType.Local, [0]), ...ins(Op.Add), ...ret],
        ],
      },
      { number: 9, exports: [[...ins(Op.Pushi, [0]), ...ins(Op.Calle, [7, 0, 0]), ...ret]] },
    ]);
    vm.useGlobals(vm.scripts.instantiate(0).localsSegment);
    vm.scripts.instantiate(9);
    expect(vm.scripts.loaded(7)).toBeUndefined();
    vm.startProcedure(9, built.get(9)!.procedures.get(0)!, []);
    expect(runToEnd(vm)).toBe(1042);
    expect(vm.scripts.loaded(7)).toBeDefined();
  });

  it("calle refuse un export qui n'est pas une procédure", () => {
    expect(() => runCode([...ins(Op.Pushi, [0]), ...ins(Op.Calle, [0, 5, 0]), ...ret])).toThrow(/export 5/);
  });

  it("callk appelle le noyau avec ses arguments, &rest compris", () => {
    const { vm } = makeWorld([{ number: 0, locals: [0] }]);
    const abs = vm.kernel.indexOf("Abs");
    const direct = runCode([...ins(Op.Pushi, [1]), ...ins(Op.Pushi, [u16(-12)]), ...ins(Op.Callk, [abs, 2]), ...ret]);
    expect(direct.acc).toBe(12);
    expect(direct.vm.kernel.journal.counts[abs]).toBe(1);
    for (const byteForm of [false, true]) {
      const rest = runCode([...ins(Op.Pushi, [0]), ...ins(Op.Rest, [1]), ...ins(Op.Callk, [abs, 0], byteForm), ...ret], { args: [u16(-30)] });
      expect(rest.acc).toBe(30);
    }
  });

  it("callk suspend l'exécution quand le noyau le demande, puis reprend", () => {
    const frameOut = makeWorld([{ number: 0, locals: [0] }]).vm.kernel.indexOf("FrameOut");
    const code = [...ins(Op.Ldi, [5]), ...ins(Op.Pushi, [0]), ...ins(Op.Callk, [frameOut, 0]), ...ins(Op.Push), ...ins(Op.Ldi, [1]), ...ins(Op.Add), ...ret];
    const { vm, built } = makeWorld([{ number: 0, locals: [0], exports: [code] }]);
    vm.useGlobals(vm.scripts.instantiate(0).localsSegment);
    vm.startProcedure(0, built.get(0)!.procedures.get(0)!, []);
    expect(vm.run()).toEqual({ status: RunStatus.Suspended, reason: "FrameOut" });
    expect(vm.run()).toEqual({ status: RunStatus.Finished });
    // FrameOut rend l'accumulateur tel quel : 5 + 1.
    expect(vm.acc).toBe(6);
    expect(vm.kernel.journal.countsByName().get("FrameOut")).toBe(1);
  });
});
