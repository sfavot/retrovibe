import { describe, expect, it } from "vitest";
import { NO_SUPERCLASS, OBJECT_MAGIC, SPECIES_INSTANCE } from "../../../src/games/gk1/data/ids";
import { readScript } from "../../../src/games/gk1/data/script";
import {
  analyzeCalls,
  decodeInstruction,
  disassembleScript,
  formatRoutine,
  formatScript,
  KERNEL_SUBFUNCTIONS,
  loadProgram,
  NO_CONSTANT,
  operandKinds,
  Region,
  routineName,
  type SciNames,
  type ScriptDisassembly,
  surveyKernelCalls,
} from "../../../src/games/gk1/engine/disasm";
import { KERNEL_NAMES } from "../../../src/games/gk1/engine/kernel/names";
import { Op, OPCODE_COUNT, Operand, OPERAND_FORMATS } from "../../../src/games/gk1/engine/opcodes";
import { mainIndex, original } from "../data/real";

function words(...values: number[]): number[] {
  return values.flatMap((v) => [v & 0xff, v >> 8]);
}

const METHOD = 18;
const LOCAL_PROC = 41;
const EXPORT_PROC = 49;

/**
 * Paire synthétique : une instance « it » avec une méthode (sélecteur 42) qui envoie un message, appelle une procédure
 * locale et finit par un `ret` mort ; une procédure locale qui appelle le noyau 64 ; une procédure exportée.
 */
function buildPair(): { script: Uint8Array; heap: Uint8Array } {
  const heap = Uint8Array.from([
    ...words(30, 0),
    ...words(OBJECT_MAGIC, 9, 0, 12, 0, SPECIES_INSTANCE, NO_SUPERCLASS, 0, 24),
    ...words(0),
    0x69, 0x74, 0, 0x68, 0x69, 0, // « it » à 24, « hi » à 27
    ...words(1, 20),
  ]);
  const script = Uint8Array.from([
    ...words(52, 0, 0, 2, EXPORT_PROC, 4),
    ...words(1, 42, METHOD),
    0x39, 42, // 18 pushi 42 (sélecteur)
    0x78, // 20 push1 (un argument)
    0x38, 7, 0, // 21 pushi 7, opérande sur deux octets
    0x72, 27, 0, // 24 lofsa « hi »
    0x4a, 6, 0, // 27 send 6
    0x76, // 30 push0 (aucun argument)
    0x41, 6, 0, 0, // 31 call +6 → 41
    0x31, 2, // 35 bnt → 39
    0x33, 0, // 37 jmp → 39
    0x48, // 39 ret
    0x48, // 40 ret jamais atteint
    0x78, // 41 push1
    0x39, 5, // 42 pushi 5
    0x43, 64, 2, 0, // 44 callk 64, 2
    0x48, // 48 ret
    0x35, 3, // 49 ldi 3
    0x48, // 51 ret
    ...words(2, 10, 25),
  ]);
  return { script, heap };
}

const NAMES: SciNames = {
  selectors: Array.from({ length: 50 }, (_, i) => (i === 42 ? "doit" : `s${i}`)),
  opcodes: Array.from({ length: OPCODE_COUNT }, (_, i) => `op${i.toString(16)}`),
  classes: [],
  kernels: KERNEL_NAMES,
};

describe("désassembleur SCI2 : instructions", () => {
  it("lit les opérandes sur un ou deux octets selon le bit 0", () => {
    expect(decodeInstruction(Uint8Array.from([0x39, 0xff]), 0)).toMatchObject({ opcode: Op.Pushi, size: 2, operands: [-1], byteOperands: true });
    expect(decodeInstruction(Uint8Array.from([0x38, 0x34, 0x12]), 0)).toMatchObject({ opcode: Op.Pushi, size: 3, operands: [0x1234] });
    expect(decodeInstruction(Uint8Array.from([0x00, 0x8f, 0x02]), 1)).toMatchObject({ offset: 1, opcode: 0x47, kinds: ["param"], operands: [2] });
  });

  it("calcule la cible des sauts depuis l'instruction suivante", () => {
    expect(decodeInstruction(Uint8Array.from([0x33, 0xfe]), 0).target).toBe(0);
    expect(decodeInstruction(Uint8Array.from([0x30, 0x10, 0x00]), 0).target).toBe(0x13);
  });

  it("lit le nombre d'octets d'arguments sur deux octets, un seul dans l'ancien codage", () => {
    expect(decodeInstruction(Uint8Array.from([0x43, 64, 2, 0]), 0)).toMatchObject({ opcode: Op.Callk, size: 4, operands: [64, 2] });
    expect(decodeInstruction(Uint8Array.from([0x43, 64, 2, 0]), 0, 4, true)).toMatchObject({ size: 3, operands: [64, 2] });
    expect(decodeInstruction(Uint8Array.from([0x47, 9, 1, 4, 0]), 0)).toMatchObject({ opcode: Op.Calle, kinds: ["script", "export", "argBytes"], operands: [9, 1, 4] });
    expect(decodeInstruction(Uint8Array.from([0x57, 3, 4, 0]), 0)).toMatchObject({ opcode: Op.Super, operands: [3, 4] });
  });

  it("refuse un opcode invalide ou une instruction tronquée", () => {
    expect(() => decodeInstruction(Uint8Array.from([0x4c]), 0)).toThrow(/invalide/);
    expect(() => decodeInstruction(Uint8Array.from([0x38, 1]), 0)).toThrow(/tronquée/);
    expect(() => decodeInstruction(Uint8Array.from([0x48]), 1)).toThrow(/hors du code/);
  });

  it("donne à chaque opérande de la table de la machine virtuelle un sens de même taille", () => {
    for (let opcode = 0; opcode < OPCODE_COUNT; opcode++) {
      const kinds = operandKinds(opcode);
      const formats = OPERAND_FORMATS[opcode];
      expect(kinds.length, `opcode ${opcode}`).toBe(formats.length);
      kinds.forEach((kind, i) => {
        expect(kind === "argBytes" || kind === "heapOffset", `opcode ${opcode}`).toBe(formats[i] === Operand.Word);
        if (kind === "relative" || kind === "s") expect(formats[i], `opcode ${opcode}`).toBe(Operand.SignedVariable);
      });
    }
    expect(operandKinds(0x7f)).toEqual(["param"]);
    expect(operandKinds(Op.Lofsa)).toEqual(["heapOffset"]);
  });

  it("ne nomme des sous-fonctions que pour des fonctions du noyau qui existent", () => {
    for (const name of Object.keys(KERNEL_SUBFUNCTIONS)) expect(KERNEL_NAMES, name).toContain(name);
  });
});

describe("désassembleur SCI2 : script synthétique", () => {
  const { script, heap } = buildPair();
  const pair = readScript(script, heap);
  const result = disassembleScript(pair);

  it("attribue chaque octet", () => {
    expect(result.problems).toEqual([]);
    expect(result.unattributed).toEqual([]);
    expect(result.legacyEncoding).toBe(false);
    expect(result.strayExports).toEqual([]);
    expect([...result.regions.subarray(0, 18)]).toEqual([...Array(8).fill(Region.Header), ...Array(4).fill(Region.Exports), ...Array(6).fill(Region.MethodDict)]);
    expect(result.regions[39]).toBe(Region.Code);
    expect(result.regions[40]).toBe(Region.DeadCode);
    expect(result.deadCode.map((i) => i.offset)).toEqual([40]);
    expect([...result.regions.subarray(52)]).toEqual(Array(6).fill(Region.Relocations));
  });

  it("découpe le code en routines : méthode, procédure locale, export", () => {
    expect(result.routines.map((r) => [r.offset, r.end, routineName(r, NAMES)])).toEqual([
      [METHOD, LOCAL_PROC, "it::doit"],
      [LOCAL_PROC, EXPORT_PROC, "proc_0029"],
      [EXPORT_PROC, 52, "export 0"],
    ]);
  });

  it("retrouve les sélecteurs des envois et les arguments des appels", () => {
    const [method, local] = result.routines;
    const sites = analyzeCalls(method);
    expect(sites.get(27)?.sends).toEqual([{ selector: 42, argc: 1, args: [7] }]);
    expect(sites.get(31)).toMatchObject({ argc: 0, args: [] });
    expect(analyzeCalls(local).get(44)).toMatchObject({ argc: 1, args: [5] });
  });

  it("écrit le code avec les noms", () => {
    const text = formatRoutine(result.routines[0], result, NAMES);
    expect(text.split("\n")[0]).toBe("it::doit :");
    expect(text).toMatch(/0018 {2}op39 +0x001b +; "hi"/);
    expect(text).toMatch(/001b {2}op25 +6 +; doit\(1\)/);
    expect(formatRoutine(result.routines[1], result, NAMES)).toMatch(/op21 +DoSound, 2 +; Suspend ; args : 5/);
    expect(formatScript(result, NAMES).split("\n\n")).toHaveLength(3);
  });

  it("signale une relocation qui ne vise pas un lofsa", () => {
    const broken = script.slice();
    broken[56] = 22; // la seconde relocation vise l'opérande d'un pushi
    const problems = disassembleScript(readScript(broken, heap)).problems;
    expect(problems.some((p) => /relocation à 0x0016/.test(p))).toBe(true);
    expect(problems.some((p) => /0x0019 absent de la table/.test(p))).toBe(true);
  });

  it("laisse sans attribution un trou qui ne se décode pas", () => {
    const broken = script.slice();
    broken[40] = 0x4c; // opcode invalide à la place du ret mort
    expect(disassembleScript(readScript(broken, heap)).unattributed).toEqual([{ start: 40, end: 41 }]);
  });
});

describe.skipIf(!original.has)("désassembleur SCI2 : les 213 scripts de Gabriel Knight", () => {
  const program = original.has ? loadProgram(mainIndex()) : undefined!;
  const all = new Map<number, ScriptDisassembly>();
  if (original.has) for (const [number, script] of program.scripts) all.set(number, disassembleScript(script));

  it("désassemble les 3 346 méthodes et toutes les procédures sans octet inexpliqué", () => {
    const counts = { method: 0, export: 0, local: 0, instructions: 0, deadBytes: 0 };
    const opcodes = new Set<number>();
    for (const [number, result] of all) {
      expect(result.problems, `script ${number}`).toEqual([]);
      expect(result.unattributed, `script ${number}`).toEqual([]);
      expect(result.regions.includes(Region.Unattributed), `script ${number}`).toBe(false);
      for (const routine of result.routines) {
        // Tout code appartient à une routine nommée : le code mort suit toujours celui d'une méthode ou d'une procédure.
        expect(routine.labels.length, `script ${number}, ${routine.offset}`).toBeGreaterThan(0);
        for (const label of routine.labels) counts[label.kind]++;
        counts.instructions += routine.instructions.length;
        for (const instruction of routine.instructions) opcodes.add(instruction.opcode);
      }
      for (const instruction of result.deadCode) counts.deadBytes += instruction.size;
    }
    expect(all.size).toBe(213);
    expect(counts).toEqual({ method: 3346, export: 42, local: 35, instructions: 306877, deadBytes: 1491 });
    expect(opcodes.size).toBe(78);
  });

  it("ne trouve que deux anomalies : un script d'avant SCI2 et un export perdu", () => {
    expect([...all].filter(([, r]) => r.legacyEncoding).map(([n]) => n)).toEqual([952]);
    expect([...all].filter(([, r]) => r.strayExports.length > 0).map(([n, r]) => [n, ...r.strayExports])).toEqual([[241, 25]]);
  });

  it("nomme les sélecteurs de presque tous les envois", () => {
    let sends = 0;
    let resolved = 0;
    for (const result of all.values()) {
      for (const routine of result.routines) {
        const sites = analyzeCalls(routine);
        for (const instruction of routine.instructions) {
          if (instruction.opcode !== Op.Send && instruction.opcode !== Op.Self && instruction.opcode !== Op.Super) continue;
          sends++;
          const parts = sites.get(instruction.offset)?.sends;
          if (!parts) continue;
          resolved++;
          for (const part of parts) expect(part.selector).toBeLessThan(program.names.selectors.length);
        }
      }
    }
    expect([sends, resolved]).toEqual([26187, 26180]);
  });

  it("relève les appels du noyau : aucune fonction « Dummy », sous-fonctions constantes", () => {
    const usage = surveyKernelCalls(program, all);
    const calls = [...usage.values()].reduce((sum, u) => sum + u.calls, 0);
    expect(usage.size).toBe(104);
    expect(calls).toBe(3838);
    expect([...usage.values()].filter((u) => u.name.startsWith("Dummy"))).toEqual([]);
    const byName = new Map([...usage.values()].map((u) => [u.name, u]));
    // Fonctions de l'interpréteur de développement que le jeu appelle quand même.
    expect([byName.get("SetDebug")?.calls, byName.get("MemoryInfo")?.calls]).toEqual([1, 6]);
    expect(byName.get("Abs")?.calls).toBe(27);
    expect(byName.get("FileIO")?.calls).toBe(43);
    expect(byName.get("RemapColors")?.calls).toBe(24);
    for (const name of ["DoSound", "DoAudio", "DoSync", "Message", "FileIO", "Palette", "PalVary", "PalCycle", "RemapColors"]) {
      expect(byName.get(name)?.subfunctions.has(NO_CONSTANT), name).toBe(false);
    }
    expect([...byName.get("DoSound")!.subfunctions.keys()].sort((a, b) => a - b)).toEqual([0, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18]);
    expect([...byName.get("Message")!.subfunctions].sort((a, b) => a[0] - b[0])).toEqual([[0, 63], [1, 1], [2, 8], [4, 1], [9, 3]]);
  });

  it("écrit une méthode connue avec ses noms", () => {
    const result = all.get(241)!;
    const init = result.routines.find((r) => routineName(r, program.names) === "leftPlant::init")!;
    const text = formatRoutine(init, result, program.names);
    expect(text).toMatch(/class {4}Polygon/);
    expect(text).toMatch(/super {4}Feature, 4 +; init\(0\)/);
    expect(text).toMatch(/self {5}6 +; setPolygon\(1\)/);
  });
});
