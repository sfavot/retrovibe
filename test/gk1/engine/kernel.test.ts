import { describe, expect, it } from "vitest";
import { ArrayType, TRIM_CENTER, TRIM_LEFT, TRIM_RIGHT } from "../../../src/games/gk1/engine/ids";
import { collectGarbage } from "../../../src/games/gk1/engine/gc";
import { ArrayOp, formatString, StringOp, trimString } from "../../../src/games/gk1/engine/kernel/arrays";
import { kernelLabel } from "../../../src/games/gk1/engine/kernel/kernel";
import { angleBetween } from "../../../src/games/gk1/engine/kernel/math";
import { KERNEL_NAMES } from "../../../src/games/gk1/engine/kernel/names";
import { fromInt, makeReg, NULL_REG, type Reg, SIGNAL_REG } from "../../../src/games/gk1/engine/memory";
import { readSelector, writeSelector } from "../../../src/games/gk1/engine/object";
import { Op, VariableType } from "../../../src/games/gk1/engine/opcodes";
import { RunStatus, type Vm } from "../../../src/games/gk1/engine/vm";
import { ins, makeWorld, type ScriptSpec, sel } from "./synthetic";

const ret = ins(Op.Ret);
const X = 2 * 9;
const Y = 2 * 10;

/** Appelle une fonction du noyau comme `callk`, laisse s'exécuter les méthodes qu'elle lance, et rend l'accumulateur. */
function call(vm: Vm, name: string, ...args: Reg[]): Reg {
  vm.acc = vm.kernel.call(vm, vm.kernel.indexOf(name), Uint32Array.from(args));
  const result = vm.run();
  if (result.status !== RunStatus.Finished) throw new Error(`exécution non terminée : ${result.status}`);
  return vm.acc;
}

function emptyWorld(): Vm {
  const { vm } = makeWorld([{ number: 0, locals: [0, 0], strings: ["%d pommes"] }]);
  vm.useGlobals(vm.scripts.instantiate(0).localsSegment);
  return vm;
}

describe("table du noyau", () => {
  it("a 139 fonctions, Abs à l'indice 94", () => {
    expect(KERNEL_NAMES).toHaveLength(139);
    expect(KERNEL_NAMES.indexOf("Abs")).toBe(94);
    expect(KERNEL_NAMES.indexOf("FileIO")).toBe(124);
    expect(KERNEL_NAMES.indexOf("RemapColors")).toBe(132);
    expect(KERNEL_NAMES[138]).toBe("PointSize");
    expect(kernelLabel(41)).toBe("Dummy[41]");
  });

  it("journalise les souches avec leurs arguments et rend leur valeur par défaut", () => {
    const vm = emptyWorld();
    expect(call(vm, "HaveMouse")).toBe(SIGNAL_REG);
    expect(call(vm, "VibrateMouse", 951, 1, 0)).toBe(0);
    expect(vm.kernel.call(vm, 41, Uint32Array.of(3))).toBe(0);
    expect(vm.kernel.journal.stubs.get("VibrateMouse")).toEqual({ count: 1, samples: ["VibrateMouse(951, 1, 0) = 0"] });
    expect(vm.kernel.journal.stubs.get("Dummy[41]")?.count).toBe(1);
    expect(vm.kernel.isImplemented("VibrateMouse")).toBe(false);
    expect(vm.kernel.isImplemented("NewList")).toBe(true);
    expect(vm.kernel.unimplemented()).toContain("AddMagnify");
    expect(vm.kernel.isImplemented("FrameOut")).toBe(true);
    expect(() => vm.kernel.indexOf("Inconnue")).toThrow();
    // Une implémentation remplace la souche.
    vm.kernel.register("VibrateMouse", () => 12);
    expect(call(vm, "VibrateMouse", 951, 1, 0)).toBe(12);
    expect(vm.kernel.journal.stubs.get("VibrateMouse")?.count).toBe(1);
    expect(vm.kernel.journal.countsByName().get("VibrateMouse")).toBe(2);
  });

  it("capture la trace complète et sa somme de contrôle", () => {
    const vm = emptyWorld();
    const before = vm.kernel.journal.hash;
    call(vm, "Abs", fromInt(-3));
    expect(vm.kernel.journal.entries).toEqual([]);
    vm.kernel.journal.capture = true;
    call(vm, "Abs", fromInt(-3));
    call(vm, "NewList");
    expect(vm.kernel.journal.entries).toEqual(["Abs(-3) = 3", "NewList() = 0003:0000"]);
    expect(vm.kernel.journal.hash).not.toBe(before);
  });
});

describe("noyau : calcul, temps, plateforme", () => {
  it("Abs, Sqrt, SinMult, CosMult, SinDiv, CosDiv, GetDistance", () => {
    const vm = emptyWorld();
    expect(call(vm, "Abs", fromInt(-7))).toBe(7);
    expect(call(vm, "Sqrt", 17)).toBe(4);
    expect(call(vm, "Sqrt", fromInt(-16))).toBe(4);
    expect(call(vm, "SinMult", 90, 100)).toBe(100);
    expect(call(vm, "SinMult", 30, 100)).toBe(49);
    expect(call(vm, "CosMult", 180, 100)).toBe(fromInt(-100));
    expect(call(vm, "SinDiv", 30, 50)).toBe(100);
    expect(call(vm, "CosDiv", 60, 50)).toBe(99);
    expect(call(vm, "SinDiv", 0, 50)).toBe(SIGNAL_REG);
    expect(call(vm, "GetDistance", 0, 0, 3, 4)).toBe(5);
    expect(call(vm, "GetDistance", fromInt(-3), 4)).toBe(5);
  });

  it("GetAngle : 0 vers le haut, 90 vers la droite, arc tangente entière de l'original", () => {
    expect(angleBetween(0, 0, 0, -10)).toBe(0);
    expect(angleBetween(0, 0, 10, 0)).toBe(90);
    expect(angleBetween(0, 0, 0, 10)).toBe(180);
    expect(angleBetween(0, 0, -10, 0)).toBe(270);
    expect(angleBetween(0, 0, 10, -10)).toBe(45);
    expect(angleBetween(0, 0, -10, 10)).toBe(225);
    expect(angleBetween(0, 0, 0, 0)).toBe(0);
    // tan < 0,1 : approximation linéaire (57 × 1 + 10) / 20 = 3.
    expect(angleBetween(0, 0, 1, -20)).toBe(3);
    // Interpolation dans la table : atan(1/2) = 26,6°.
    expect(angleBetween(0, 0, 10, -20)).toBe(27);
    expect(call(emptyWorld(), "GetAngle", 100, 100, 110, 80)).toBe(27);
  });

  it("Random tire dans l'intervalle fermé, de façon reproductible", () => {
    const draw = (seed: number): number[] => {
      const vm = emptyWorld();
      vm.rng.seed(seed);
      return Array.from({ length: 200 }, () => call(vm, "Random", 3, 6));
    };
    const values = draw(1);
    expect(new Set(values)).toEqual(new Set([3, 4, 5, 6]));
    expect(draw(1)).toEqual(values);
    expect(draw(2)).not.toEqual(values);
    const vm = emptyWorld();
    expect(call(vm, "Random", 5, 5)).toBe(5);
    expect(call(vm, "Random", 9, 4)).toBe(4);
    expect(call(vm, "Random", 77)).toBe(0);
  });

  it("Platform et GetTime", () => {
    const vm = emptyWorld();
    expect(call(vm, "Platform")).toBe(1);
    expect(call(vm, "Platform", 0)).toBe(1);
    expect(call(vm, "Platform", 2)).toBe(0);
    vm.ticks = 0x12345;
    expect(call(vm, "GetTime")).toBe(0x2345);
    expect(call(vm, "GetTime", 0)).toBe(0x2345);
    vm.wallClock = () => ({ year: 1994, month: 5, day: 3, hour: 15, minute: 7, second: 9 });
    expect(call(vm, "GetTime", 1)).toBe((3 << 12) | (7 << 6) | 9);
    expect(call(vm, "GetTime", 2)).toBe((15 << 11) | (7 << 5) | 4);
    expect(call(vm, "GetTime", 3)).toBe((14 << 9) | (5 << 5) | 3);
    expect(call(vm, "MemoryInfo", 0)).toBe(0x7fe8);
    vm.acc = 5;
    expect(call(vm, "SetDebug")).toBe(5);
  });
});

describe("noyau : ressources et scripts", () => {
  const spec: ScriptSpec[] = [
    { number: 0, locals: [0] },
    { number: 4, objects: [{ name: "thing", species: 0, properties: [["x", 1]] }], exports: ["thing", [...ret]] },
    { number: 6 },
  ];

  it("ScriptID charge un script et rend l'objet exporté", () => {
    const { vm, built } = makeWorld(spec);
    const thing = call(vm, "ScriptID", 4, 0);
    expect(thing).toBe(makeReg(vm.scripts.loaded(4)!.id, built.get(4)!.objects.get("thing")!));
    expect(call(vm, "ScriptID", 4)).toBe(thing);
    // Export qui est une procédure, export absent, script sans export : 0. Une référence est rendue telle quelle.
    expect(call(vm, "ScriptID", 4, 1)).toBe(0);
    expect(call(vm, "ScriptID", 4, 9)).toBe(0);
    expect(call(vm, "ScriptID", 6)).toBe(0);
    expect(call(vm, "ScriptID", thing)).toBe(thing);
    expect(vm.scripts.loaded(4)!.lockers).toBe(4);
  });

  it("DisposeScript décharge le script quel que soit le nombre de demandes", () => {
    const { vm } = makeWorld(spec);
    call(vm, "ScriptID", 4, 0);
    call(vm, "ScriptID", 4, 0);
    vm.acc = 9;
    expect(call(vm, "DisposeScript", 4)).toBe(9);
    expect(vm.scripts.loaded(4)).toBeUndefined();
    expect(call(vm, "DisposeScript", 4, 77)).toBe(77);
    expect(call(vm, "DisposeScript", 500)).toBe(77);
  });

  it("Load, Lock, ResCheck", () => {
    const { vm } = makeWorld(spec);
    const script = 0x82;
    expect(call(vm, "Load", script, 4)).toBe((2 << 11) | 4);
    expect(call(vm, "ResCheck", script, 4)).toBe(1);
    expect(call(vm, "ResCheck", 2, 4)).toBe(1);
    expect(call(vm, "ResCheck", script, 5)).toBe(0);
    call(vm, "Lock", script, 4);
    call(vm, "Lock", script, 4, 1);
    call(vm, "Lock", script, 6, 1);
    expect(vm.resources.lockCount(script, 4)).toBe(2);
    call(vm, "Lock", script, 4, 0);
    expect(vm.resources.lockCount(script, 4)).toBe(1);
    call(vm, "Lock", script, 0xffff, 0);
    expect([vm.resources.lockCount(script, 4), vm.resources.lockCount(script, 6)]).toEqual([0, 0]);
    call(vm, "Lock", script, 999, 1);
    expect(vm.resources.lockCount(script, 999)).toBe(0);
    vm.acc = 3;
    expect([call(vm, "Unload", script, 4), call(vm, "Purge", 100)]).toEqual([3, 3]);
  });
});

describe("noyau : listes", () => {
  function listOf(vm: Vm, ...values: Reg[]): { list: Reg; nodes: Reg[] } {
    const list = call(vm, "NewList");
    const nodes = values.map((value) => {
      const node = call(vm, "NewNode", value, value);
      call(vm, "AddToEnd", list, node);
      return node;
    });
    return { list, nodes };
  }
  function values(vm: Vm, list: Reg): Reg[] {
    const out: Reg[] = [];
    for (let node = call(vm, "FirstNode", list); node !== NULL_REG; node = call(vm, "NextNode", node)) out.push(call(vm, "NodeValue", node));
    return out;
  }
  function reversed(vm: Vm, list: Reg): Reg[] {
    const out: Reg[] = [];
    for (let node = call(vm, "LastNode", list); node !== NULL_REG; node = call(vm, "PrevNode", node)) out.push(call(vm, "NodeValue", node));
    return out;
  }

  it("construit, parcourt et cherche", () => {
    const vm = emptyWorld();
    const empty = call(vm, "NewList");
    expect([call(vm, "EmptyList", empty), call(vm, "FirstNode", empty), call(vm, "LastNode", empty)]).toEqual([1, 0, 0]);
    expect([call(vm, "FirstNode", 0), call(vm, "LastNode", 0), call(vm, "EmptyList", 0), call(vm, "NodeValue", 0)]).toEqual([0, 0, 0, 0]);
    expect(call(vm, "ListAt", empty, 0)).toBe(0);

    const { list, nodes } = listOf(vm, 10, 20, 30);
    expect(call(vm, "EmptyList", list)).toBe(0);
    expect(values(vm, list)).toEqual([10, 20, 30]);
    expect(reversed(vm, list)).toEqual([30, 20, 10]);
    expect(call(vm, "FindKey", list, 20)).toBe(nodes[1]);
    expect(call(vm, "FindKey", list, 99)).toBe(0);
    expect([call(vm, "ListAt", list, 0), call(vm, "ListAt", list, 2), call(vm, "ListAt", list, 3)]).toEqual([10, 30, 0]);
    expect([call(vm, "ListIndexOf", list, 30), call(vm, "ListIndexOf", list, 99)]).toEqual([2, SIGNAL_REG]);
  });

  it("ajoute en tête, en queue, après un nœud, avec ou sans clé", () => {
    const vm = emptyWorld();
    const { list, nodes } = listOf(vm, 10, 30);
    call(vm, "AddToFront", list, call(vm, "NewNode", 5), 500);
    call(vm, "AddAfter", list, nodes[0], call(vm, "NewNode", 20));
    call(vm, "AddAfter", list, nodes[1], call(vm, "NewNode", 40), 400);
    call(vm, "AddAfter", list, 0, call(vm, "NewNode", 1));
    expect(values(vm, list)).toEqual([1, 5, 10, 20, 30, 40]);
    expect(reversed(vm, list)).toEqual([40, 30, 20, 10, 5, 1]);
    // La clé d'un nœud est sa valeur, sauf si elle est donnée.
    expect(call(vm, "NodeValue", call(vm, "FindKey", list, 500))).toBe(5);
    expect(call(vm, "NodeValue", call(vm, "FindKey", list, 400))).toBe(40);
    expect(call(vm, "FindKey", list, 5)).toBe(0);
    expect(call(vm, "NodeValue", call(vm, "FindKey", list, 20))).toBe(20);
  });

  it("DeleteKey retire un nœud en tête, au milieu, en queue", () => {
    const vm = emptyWorld();
    const { list, nodes } = listOf(vm, 10, 20, 30, 40);
    expect(call(vm, "DeleteKey", list, 99)).toBe(0);
    expect(call(vm, "DeleteKey", list, 20)).toBe(1);
    expect(call(vm, "DeleteKey", list, 10)).toBe(1);
    expect(call(vm, "DeleteKey", list, 40)).toBe(1);
    expect(values(vm, list)).toEqual([30]);
    expect(reversed(vm, list)).toEqual([30]);
    // Le nœud retiré reste lisible et ne mène nulle part.
    expect([call(vm, "NodeValue", nodes[1]), call(vm, "NextNode", nodes[1]), call(vm, "PrevNode", nodes[1])]).toEqual([20, 0, 0]);
    call(vm, "DeleteKey", list, 30);
    expect(call(vm, "EmptyList", list)).toBe(1);
    expect(call(vm, "DisposeList", list)).toBe(vm.acc);
  });

  /**
   * Classe `Item` (x, y) : `doit` ajoute x à la variable globale 0 ; `sum` y ajoute x + paramètre 1 et rend y ; `get` rend x ;
   * `cue` demande une image (FrameOut) puis ajoute 100 à la globale 0 ; `kind` se retire de la liste gardée en globale 1.
   */
  function itemWorld(): { vm: Vm; items: Reg[]; list: Reg; globals: Uint32Array } {
    const probe = emptyWorld();
    const addGlobal = [...ins(Op.FirstVariable | VariableType.Global | 0x04, [0]), ...ins(Op.Add), ...ins(Op.FirstVariable | VariableType.Global | 0x10, [0])];
    const items: ScriptSpec = {
      number: 3,
      objects: [
        {
          name: "Item",
          species: 0,
          properties: [
            ["x", 0],
            ["y", 0],
          ],
          methods: {
            doit: [...ins(Op.PToa, [X]), ...addGlobal, ...ret],
            sum: [...ins(Op.PTos, [X]), ...ins(Op.FirstVariable | VariableType.Param, [1]), ...ins(Op.Add), ...addGlobal, ...ins(Op.PToa, [Y]), ...ret],
            get: [...ins(Op.PToa, [X]), ...ret],
            cue: [...ins(Op.Pushi, [0]), ...ins(Op.Callk, [probe.kernel.indexOf("FrameOut"), 0]), ...ins(Op.Ldi, [100]), ...addGlobal, ...ret],
            // (DeleteKey liste self)
            kind: [
              ...ins(Op.Pushi, [2]),
              ...ins(Op.FirstVariable | VariableType.Global | 0x04, [1]),
              ...ins(Op.PushSelf),
              ...ins(Op.Callk, [probe.kernel.indexOf("DeleteKey"), 4]),
              ...ins(Op.Ldi, [1]),
              ...addGlobal,
              ...ret,
            ],
          },
        },
      ],
    };
    const { vm } = makeWorld([{ number: 0, locals: [0, 0] }, items]);
    const globalsSegment = vm.scripts.instantiate(0).localsSegment;
    vm.useGlobals(globalsSegment);
    const itemClass = vm.scripts.classAddress(0, 0);
    const made = [1, 2, 3].map((x) => {
      const item = call(vm, "Clone", itemClass);
      writeSelector(vm.memory, item, sel("x"), x);
      writeSelector(vm.memory, item, sel("y"), 1);
      return item;
    });
    const { list } = listOf(vm, ...made);
    const globals = vm.memory.localsSegment(globalsSegment)!.values;
    globals[1] = list;
    return { vm, items: made, list, globals };
  }

  it("ListEachElementDo appelle une méthode de chaque élément, avec ses arguments", () => {
    const { vm, list, globals } = itemWorld();
    call(vm, "ListEachElementDo", list, sel("doit"));
    expect(globals[0]).toBe(6);
    call(vm, "ListEachElementDo", list, sel("sum"), 10);
    expect(globals[0]).toBe(6 + 36);
    expect(vm.memory.list(list).recursions).toBe(0);
    expect(vm.frames).toHaveLength(0);
  });

  it("ListEachElementDo écrit une propriété de chaque élément", () => {
    const { vm, list, items } = itemWorld();
    call(vm, "ListEachElementDo", list, sel("y"), 9);
    expect(items.map((item) => readSelector(vm.memory, item, sel("y")))).toEqual([9, 9, 9]);
    expect(() => call(vm, "ListEachElementDo", list, sel("y"))).toThrow(/propriété « y »/);
  });

  it("ListFirstTrue rend le premier élément qui répond vrai, par méthode ou par propriété", () => {
    const { vm, list, items } = itemWorld();
    expect(call(vm, "ListFirstTrue", list, sel("get"))).toBe(items[0]);
    writeSelector(vm.memory, items[0], sel("x"), 0);
    writeSelector(vm.memory, items[1], sel("x"), 0);
    expect(call(vm, "ListFirstTrue", list, sel("get"))).toBe(items[2]);
    expect(call(vm, "ListFirstTrue", list, sel("x"))).toBe(items[2]);
    writeSelector(vm.memory, items[2], sel("x"), 0);
    expect(call(vm, "ListFirstTrue", list, sel("get"))).toBe(0);
    expect(call(vm, "ListFirstTrue", list, sel("x"))).toBe(0);
    expect(call(vm, "ListFirstTrue", call(vm, "NewList"), sel("get"))).toBe(0);
  });

  it("ListAllTrue s'arrête au premier élément qui répond faux", () => {
    const { vm, list, items, globals } = itemWorld();
    expect(call(vm, "ListAllTrue", list, sel("get"))).toBe(3);
    expect(call(vm, "ListAllTrue", list, sel("x"))).toBe(3);
    expect(call(vm, "ListAllTrue", call(vm, "NewList"), sel("get"))).toBe(1);
    writeSelector(vm.memory, items[1], sel("y"), 0);
    // `sum` rend y : le deuxième répond faux, le troisième n'est pas appelé (1 + 2 seulement, plus le paramètre deux fois).
    expect(call(vm, "ListAllTrue", list, sel("sum"), 0)).toBe(0);
    expect(globals[0]).toBe(3);
    expect(call(vm, "ListAllTrue", list, sel("y"))).toBe(0);
  });

  it("un élément peut se retirer de la liste pendant l'itération", () => {
    const { vm, list, globals } = itemWorld();
    call(vm, "ListEachElementDo", list, sel("kind"));
    expect(globals[0]).toBe(3);
    expect(call(vm, "EmptyList", list)).toBe(1);
  });

  it("un FrameOut dans un élément suspend l'itération, qui reprend ensuite", () => {
    const { vm, list, globals } = itemWorld();
    vm.acc = vm.kernel.call(vm, vm.kernel.indexOf("ListEachElementDo"), Uint32Array.of(list, sel("cue")));
    for (let i = 0; i < 3; i++) {
      expect(vm.run()).toEqual({ status: RunStatus.Suspended, reason: "FrameOut" });
      expect(globals[0]).toBe(100 * i);
      // L'état en attente n'est fait que de nombres.
      expect(vm.frames.every((frame) => frame.state.every((value) => typeof value === "number"))).toBe(true);
    }
    expect(vm.run()).toEqual({ status: RunStatus.Finished });
    expect(globals[0]).toBe(300);
    expect(vm.memory.list(list).recursions).toBe(0);
  });

  it("le ramasse-miettes garde ce qui est accessible et reprend le reste", () => {
    const { vm, list, items, globals } = itemWorld();
    const orphanList = listOf(vm, 1, 2).list;
    const orphanClone = call(vm, "Clone", items[0]);
    const kept = call(vm, "Array", ArrayOp.New, 2, ArrayType.Id);
    call(vm, "Array", ArrayOp.Put, kept, 0, orphanClone);
    call(vm, "Array", ArrayOp.New, 2, ArrayType.Int16);
    vm.acc = NULL_REG;
    vm.prev = NULL_REG;
    vm.gcRoots.push(() => [kept]);
    expect(vm.memory.lists.get(orphanList)).toBeDefined();
    // La liste des éléments tient par la variable globale 1 ; le clone orphelin par le tableau, lui-même racine déclarée.
    expect(collectGarbage(vm)).toEqual({ clones: 0, lists: 1, nodes: 2, arrays: 1, bitmaps: 0 });
    expect(vm.memory.lists.get(orphanList)).toBeUndefined();
    expect(vm.memory.getObject(orphanClone)).toBeDefined();
    vm.gcRoots.length = 0;
    expect(collectGarbage(vm)).toEqual({ clones: 1, lists: 0, nodes: 0, arrays: 1, bitmaps: 0 });
    globals[1] = NULL_REG;
    expect(collectGarbage(vm)).toEqual({ clones: 3, lists: 1, nodes: 3, arrays: 0, bitmaps: 0 });
    expect(vm.memory.lists.get(list)).toBeUndefined();
    expect(vm.memory.clones.size).toBe(0);
    // La classe du script reste.
    expect(vm.memory.isObject(vm.scripts.classAddress(0, 0))).toBe(true);
  });
});

describe("noyau : Array et String", () => {
  it("Array : New, Size, At, Put, Fill, Copy, Dup, Free", () => {
    const vm = emptyWorld();
    const array = call(vm, "Array", ArrayOp.New, 3, ArrayType.Int16);
    expect(call(vm, "Array", ArrayOp.Size, array)).toBe(3);
    expect(call(vm, "Array", ArrayOp.Put, array, 1, 11, 12, 13)).toBe(array);
    expect(call(vm, "Array", ArrayOp.Size, array)).toBe(4);
    expect([0, 1, 3, 9].map((i) => call(vm, "Array", ArrayOp.At, array, i))).toEqual([0, 11, 13, 0]);
    call(vm, "Array", ArrayOp.Fill, array, 0, 2, 7);
    const copy = call(vm, "Array", ArrayOp.Duplicate, array);
    call(vm, "Array", ArrayOp.Copy, array, 2, copy, 0, 2);
    expect([0, 1, 2, 3].map((i) => call(vm, "Array", ArrayOp.At, array, i))).toEqual([7, 7, 7, 7]);
    expect([0, 1, 2, 3].map((i) => call(vm, "Array", ArrayOp.At, copy, i))).toEqual([7, 7, 12, 13]);
    expect(call(vm, "Array", ArrayOp.GetData, array)).toBe(array);
    call(vm, "Array", ArrayOp.Free, copy);
    expect(vm.memory.isArray(copy)).toBe(false);
    call(vm, "Array", ArrayOp.Free, 0);
    // Un tableau de chaîne a la place de son 0 final.
    expect(call(vm, "Array", ArrayOp.Size, call(vm, "Array", ArrayOp.New, 5, ArrayType.String))).toBe(6);
    expect(() => call(vm, "Array", 42, array)).toThrow(/sous-fonction/);
  });

  it("String : chaînes de tableau et chaînes de script", () => {
    const { vm, built } = makeWorld([{ number: 0, locals: [0], strings: ["%d pommes", "Abc"], objects: [{ name: "Str", species: 0, properties: [["data", 0]] }] }]);
    const segment = vm.scripts.instantiate(0);
    const heapString = (text: string): Reg => {
      const heap = built.get(0)!.heap;
      const bytes = [...text].map((c) => c.charCodeAt(0));
      for (let at = 0; at < heap.length; at++) if (bytes.every((b, i) => heap[at + i] === b) && heap[at + bytes.length] === 0) return makeReg(segment.id, at);
      throw new Error(text);
    };
    const raw = heapString("Abc");
    const text = call(vm, "String", StringOp.New, 4);
    expect(call(vm, "String", StringOp.Size, text)).toBe(4);
    call(vm, "String", StringOp.Copy, text, 0, raw, 0, 0xffff);
    expect(vm.memory.getString(text)).toBe("Abc");
    expect(call(vm, "String", StringOp.Length, text)).toBe(3);
    expect(call(vm, "String", StringOp.Length, raw)).toBe(3);
    expect([call(vm, "String", StringOp.At, text, 1), call(vm, "String", StringOp.At, raw, 2), call(vm, "String", StringOp.At, raw, 9)]).toEqual([0x62, 0x63, 0]);
    call(vm, "String", StringOp.Put, text, 3, 0x64, 0x65, 0);
    expect(vm.memory.getString(text)).toBe("Abcde");
    expect(call(vm, "String", StringOp.Compare, text, raw)).toBe(1);
    expect(call(vm, "String", StringOp.Compare, raw, text)).toBe(fromInt(-1));
    expect(call(vm, "String", StringOp.Compare, text, raw, 3)).toBe(0);
    expect(vm.memory.getString(call(vm, "String", StringOp.Duplicate, raw))).toBe("Abc");
    call(vm, "String", StringOp.ToUpper, text);
    expect(vm.memory.getString(text)).toBe("ABCDE");
    call(vm, "String", StringOp.ToLower, text);
    expect(vm.memory.getString(text)).toBe("abcde");

    // Un objet `Str` vaut sa propriété `data`.
    const str = vm.scripts.classAddress(0, 0);
    writeSelector(vm.memory, str, sel("data"), text);
    expect(call(vm, "String", StringOp.GetData, str)).toBe(text);
    expect(call(vm, "String", StringOp.GetData, text)).toBe(text);
    const formatted = call(vm, "String", StringOp.Format, heapString("%d pommes"), 12);
    expect(vm.memory.getString(formatted)).toBe("12 pommes");
    expect(call(vm, "String", StringOp.FormatAt, text, heapString("%d pommes"), fromInt(-1))).toBe(text);
    expect(vm.memory.getString(text)).toBe("-1 pommes");
    vm.memory.setString(text, " 42 ans");
    expect(call(vm, "String", StringOp.ToInteger, text)).toBe(42);
    expect(call(vm, "String", StringOp.ToInteger, raw)).toBe(0);
    call(vm, "String", StringOp.Trim, text, TRIM_LEFT);
    expect(vm.memory.getString(text)).toBe("42 ans");
    call(vm, "String", StringOp.Free, text);
    expect(vm.memory.isArray(text)).toBe(false);
  });

  it("formatString : types, largeur, précision, drapeaux", () => {
    const { vm, built } = makeWorld([{ number: 0, locals: [0], strings: ["mot"] }]);
    const segment = vm.scripts.instantiate(0);
    const word = makeReg(segment.id, built.get(0)!.heap.indexOf(0x6d));
    expect(formatString(vm, "%d %i %u %x %X %o %c", [fromInt(-5), 7, fromInt(-5), 255, 255, 8, 0x41])).toBe("-5 7 65531 ff FF 10 A");
    expect(formatString(vm, "[%5d] [%-5d] [%05d] [%+d] [%.3d]", [42, 42, 42, 42, 7])).toBe("[   42] [42   ] [00042] [+42] [007]");
    expect(formatString(vm, "[%s] [%5s] [%-5s] [%.2s]", [word, word, word, word])).toBe("[mot] [  mot] [mot  ] [mo]");
    expect(formatString(vm, "100%% %d", [3])).toBe("100% 3");
    expect(formatString(vm, "%hd", [3])).toBe("3");
    expect(() => formatString(vm, "%d %d", [1])).toThrow(/argument manquant/);
  });

  it("trimString : droite, gauche, centre, caractère préservé", () => {
    expect(trimString("  a b  ", TRIM_RIGHT, 0)).toBe("  a b");
    expect(trimString("  a b  ", TRIM_LEFT, 0)).toBe("a b  ");
    expect(trimString("  a b  ", TRIM_LEFT | TRIM_RIGHT, 0)).toBe("a b");
    expect(trimString("  a \t b  ", TRIM_CENTER, 0)).toBe("  ab  ");
    expect(trimString("  a b  ", TRIM_LEFT | TRIM_CENTER | TRIM_RIGHT, 0)).toBe("ab");
    expect(trimString("\n a \n", TRIM_LEFT | TRIM_RIGHT, 0x0a)).toBe("\n a \n");
    expect(trimString("   ", TRIM_LEFT | TRIM_RIGHT, 0)).toBe("");
  });
});
