import { describe, expect, it } from "vitest";
import { INFO_CLASS, INFO_CLONE } from "../../../src/games/gk1/data/ids";
import { OBJECT_PROPERTY } from "../../../src/games/gk1/data/script";
import { INFO_VIEW_VISIBLE, VIEW_PROPERTY_FIRST, VIEW_PROPERTY_LAST } from "../../../src/games/gk1/engine/ids";
import { makeReg, NULL_REG, type Reg, regSegment } from "../../../src/games/gk1/engine/memory";
import { lookupSelector, makeShape, newLookup, readSelector, SciObject, SelectorKind, writeSelector } from "../../../src/games/gk1/engine/object";
import { Op, VAR_OPERATION_SHIFT, VariableOperation, VariableType } from "../../../src/games/gk1/engine/opcodes";
import { RunStatus, type Vm } from "../../../src/games/gk1/engine/vm";
import { ins, makeWorld, runToEnd, type ScriptSpec, sel, type World } from "./synthetic";

const ret = ins(Op.Ret);
const lap = (i: number) => ins(Op.FirstVariable | VariableType.Param, [i]);
/** Offset en octets d'une propriété : huit mots d'en-tête, `name`, puis x, y, data. */
const X = 2 * 9;
const Y = 2 * 10;
const DATA = 2 * 11;
const BASE = 0;
const DERIVED = 1;
const OBJECTS = 10;

/**
 * Script 10 : classe `Base` (x, y), classe `Derived` (hérite, ajoute `data`, redéfinit `kind` et `sum`), instance `thing`
 * de `Derived` avec sa propre méthode `cue`.
 */
const objects: ScriptSpec = {
  number: OBJECTS,
  locals: [0],
  strings: ["bonjour"],
  objects: [
    {
      name: "Base",
      species: BASE,
      properties: [
        ["x", 1],
        ["y", 2],
      ],
      methods: {
        get: [...ins(Op.PToa, [X]), ...ret],
        set: [...lap(1), ...ins(Op.ATop, [X]), ...ret],
        sum: [...ins(Op.PTos, [X]), ...ins(Op.PToa, [Y]), ...ins(Op.Add), ...ret],
        kind: [...ins(Op.Ldi, [1]), ...ret],
        // (self get:) : envoi à soi-même.
        doit: [...ins(Op.Pushi, [sel("get")]), ...ins(Op.Push0), ...ins(Op.Self, [4]), ...ret],
      },
    },
    {
      name: "Derived",
      species: DERIVED,
      superClass: BASE,
      inherited: [
        ["x", 10],
        ["y", 20],
      ],
      properties: [["data", 0]],
      methods: {
        kind: [...ins(Op.Ldi, [2]), ...ret],
        // (+ (super sum:) 1000)
        sum: [...ins(Op.Pushi, [sel("sum")]), ...ins(Op.Push0), ...ins(Op.Super, [BASE, 4]), ...ins(Op.Push), ...ins(Op.Ldi, [1000]), ...ins(Op.Add), ...ret],
        // (* 2 (self get:)), l'objet courant vu par selfID et pushSelf.
        twice: [...ins(Op.Pushi, [sel("get")]), ...ins(Op.Push0), ...ins(Op.Self, [4]), ...ins(Op.Push), ...ins(Op.Ldi, [2]), ...ins(Op.Mul), ...ret],
      },
    },
    {
      name: "thing",
      superClass: DERIVED,
      inherited: [
        ["x", 5],
        ["y", 6],
      ],
      properties: [["data", 0]],
      methods: {
        cue: [...ins(Op.Ldi, [77]), ...ret],
      },
    },
  ],
  exports: ["thing"],
};

function world(extra: ScriptSpec[] = []): World & { thing: Reg; segment: number } {
  const made = makeWorld([{ number: 0, locals: [0, 0, 0, 0] }, objects, ...extra]);
  made.vm.useGlobals(made.vm.scripts.instantiate(0).localsSegment);
  const segment = made.vm.scripts.instantiate(OBJECTS);
  return { ...made, segment: segment.id, thing: made.vm.scripts.exportedObject(segment, 0) };
}

function send(vm: Vm, object: Reg, selector: Parameters<typeof sel>[0], ...args: number[]): number {
  vm.start(object, sel(selector), args);
  return runToEnd(vm);
}

describe("chargement d'un script et modèle objet", () => {
  it("relie classes, instances et table des classes", () => {
    const { vm, thing, segment, built } = world();
    const offsets = built.get(OBJECTS)!.objects;
    const base = vm.scripts.classAddress(BASE, 0);
    const derived = vm.scripts.classAddress(DERIVED, 0);
    expect(base).toBe(makeReg(segment, offsets.get("Base")!));
    expect(derived).toBe(makeReg(segment, offsets.get("Derived")!));
    expect(thing).toBe(makeReg(segment, offsets.get("thing")!));

    const instance = vm.memory.getObject(thing)!;
    const derivedClass = vm.memory.getObject(derived)!;
    expect(instance.isClass).toBe(false);
    expect(derivedClass.isClass).toBe(true);
    expect(instance.superClass).toBe(derived);
    expect(derivedClass.superClass).toBe(base);
    expect(vm.memory.getObject(base)!.superClass).toBe(NULL_REG);
    // L'instance partage la forme de sa classe et en recopie `-propDict-` ; `-classScript-` est le numéro du script.
    expect(instance.shape).toBe(derivedClass.shape);
    expect(instance.vars[OBJECT_PROPERTY.PropertyDict]).toBe(derivedClass.vars[OBJECT_PROPERTY.PropertyDict]);
    expect(derivedClass.vars[OBJECT_PROPERTY.PropertyDict]).not.toBe(vm.memory.getObject(base)!.vars[OBJECT_PROPERTY.PropertyDict]);
    expect(instance.vars[OBJECT_PROPERTY.ClassScript]).toBe(OBJECTS);
    // Le nom est une référence vers le heap, lue par son sélecteur.
    expect(vm.nameOf(thing)).toBe("thing");
    expect(vm.nameOf(derived)).toBe("Derived");
    expect(vm.memory.isObject(thing)).toBe(true);
    expect(vm.memory.isObject(makeReg(segment, 2))).toBe(false);
  });

  it("cherche un sélecteur : propriété, méthode propre, méthode héritée, rien", () => {
    const { vm, thing } = world();
    const object = vm.memory.getObject(thing)!;
    const out = newLookup();
    expect(lookupSelector(vm.memory, object, sel("x"), out)).toBe(SelectorKind.Variable);
    expect(out.index).toBe(9);
    expect(lookupSelector(vm.memory, object, sel("cue"), out)).toBe(SelectorKind.Method);
    expect(lookupSelector(vm.memory, object, sel("kind"), out)).toBe(SelectorKind.Method);
    expect(lookupSelector(vm.memory, object, sel("get"), out)).toBe(SelectorKind.Method);
    expect(lookupSelector(vm.memory, object, sel("play"), out)).toBe(SelectorKind.None);
    // Une classe ne voit pas les méthodes de ses instances.
    expect(lookupSelector(vm.memory, vm.memory.getObject(vm.scripts.classAddress(DERIVED, 0))!, sel("cue"), out)).toBe(SelectorKind.None);
    expect(readSelector(vm.memory, thing, sel("y"))).toBe(6);
    expect(readSelector(vm.memory, thing, sel("play"))).toBe(0);
    writeSelector(vm.memory, thing, sel("y"), 60);
    expect(readSelector(vm.memory, thing, sel("y"))).toBe(60);
    expect(() => writeSelector(vm.memory, thing, sel("play"), 1)).toThrow();
  });

  it("n'inscrit une classe que pour le script que lui attribue la table des classes", () => {
    // La classe 3 est définie par les scripts 20 et 21 ; la table retient le 21 (comme `ForRepeat` : 22 et 808).
    const twin = (number: number, value: number): ScriptSpec => ({ number, objects: [{ name: "Twin", species: 3, properties: [["x", value]] }] });
    const { vm } = makeWorld([{ number: 0, locals: [0] }, twin(20, 20), twin(21, 21)], { 3: 21 });
    const first = vm.scripts.instantiate(20);
    expect(vm.scripts.loaded(21)).toBeUndefined();
    const address = vm.scripts.classAddress(3, 0);
    expect(regSegment(address)).toBe(vm.scripts.loaded(21)!.id);
    expect(regSegment(address)).not.toBe(first.id);
    expect(readSelector(vm.memory, address, sel("x"))).toBe(21);
  });

  it("décharge un script et le recharge au même segment, propriétés et variables remises à neuf", () => {
    const { vm, thing, segment } = world();
    writeSelector(vm.memory, thing, sel("x"), 99);
    const locals = vm.memory.localsSegment(vm.scripts.loaded(OBJECTS)!.localsSegment)!;
    locals.values[0] = 7;
    const base = vm.scripts.classAddress(BASE, 0);

    vm.scripts.loaded(OBJECTS)!.lockers = 1;
    vm.scripts.uninstantiate(OBJECTS);
    expect(vm.scripts.loaded(OBJECTS)).toBeUndefined();
    // L'objet reste lisible, mais n'est plus un objet valide ; la classe a quitté la table.
    expect(readSelector(vm.memory, thing, sel("x"))).toBe(99);
    expect(vm.memory.isObject(thing)).toBe(false);

    expect(vm.scripts.classAddress(BASE, 0)).toBe(base);
    expect(vm.scripts.loaded(OBJECTS)!.id).toBe(segment);
    expect(readSelector(vm.memory, thing, sel("x"))).toBe(5);
    expect(vm.memory.localsSegment(vm.scripts.loaded(OBJECTS)!.localsSegment)).toBe(locals);
    expect(locals.values[0]).toBe(0);
    expect(vm.memory.isObject(thing)).toBe(true);
  });

  it("refuse un script absent ou une classe inconnue", () => {
    const { vm } = world();
    expect(() => vm.scripts.instantiate(999)).toThrow(/script 999/);
    expect(() => vm.scripts.classAddress(50, 0)).toThrow(/classe 50/);
  });

  it("écrire une propriété graphique marque l'objet à redessiner", () => {
    const object = new SciObject(NULL_REG, new Uint32Array(VIEW_PROPERTY_LAST + 2), new Map(), 0);
    object.shape = makeShape(new Uint16Array(VIEW_PROPERTY_LAST + 2));
    object.setProperty(VIEW_PROPERTY_FIRST - 1, 1);
    object.setProperty(VIEW_PROPERTY_LAST + 1, 1);
    expect(object.info & INFO_VIEW_VISIBLE).toBe(0);
    object.setProperty(VIEW_PROPERTY_FIRST, 1);
    expect(object.info & INFO_VIEW_VISIBLE).toBe(INFO_VIEW_VISIBLE);
    object.vars[OBJECT_PROPERTY.Info] = 0;
    object.setProperty(VIEW_PROPERTY_LAST, 1);
    expect(object.info & INFO_VIEW_VISIBLE).toBe(INFO_VIEW_VISIBLE);
  });
});

describe("send, self, super", () => {
  it("appelle la méthode de l'objet, de sa classe ou d'une classe mère", () => {
    const { vm, thing } = world();
    expect(send(vm, thing, "cue")).toBe(77);
    expect(send(vm, thing, "kind")).toBe(2);
    expect(send(vm, thing, "get")).toBe(5);
    expect(send(vm, vm.scripts.classAddress(BASE, 0), "kind")).toBe(1);
    expect(send(vm, vm.scripts.classAddress(DERIVED, 0), "get")).toBe(10);
  });

  it("super cherche dans la classe mère en gardant l'objet courant", () => {
    const { vm, thing } = world();
    expect(send(vm, thing, "sum")).toBe(5 + 6 + 1000);
    expect(send(vm, vm.scripts.classAddress(BASE, 0), "sum")).toBe(3);
  });

  it("self envoie à l'objet courant", () => {
    const { vm, thing } = world();
    expect(send(vm, thing, "doit")).toBe(5);
    expect(send(vm, thing, "twice")).toBe(10);
  });

  it("lit et écrit une propriété par un envoi", () => {
    const { vm, thing } = world();
    expect(send(vm, thing, "x")).toBe(5);
    send(vm, thing, "x", 42);
    expect(send(vm, thing, "x")).toBe(42);
    expect(send(vm, thing, "get")).toBe(42);
    // Passer par une méthode : (thing set: 8).
    send(vm, thing, "set", 8);
    expect(send(vm, thing, "x")).toBe(8);
  });

  /** Exécute, dans le script 30, le code produit par `code` (qui reçoit l'offset de `thing` dans le heap du script 10). */
  function runProcedure(code: number[], args: number[] = []): { vm: Vm; acc: number; thing: Reg } {
    const made = world([{ number: 30, exports: [code] }]);
    made.vm.scripts.instantiate(30);
    made.vm.startProcedure(30, made.built.get(30)!.procedures.get(0)!, args);
    return { vm: made.vm, acc: runToEnd(made.vm), thing: made.thing };
  }

  /** `(ScriptID 10 0)` : l'objet `thing` dans l'accumulateur. */
  function loadThing(vm: Vm): number[] {
    return [...ins(Op.Pushi, [2]), ...ins(Op.Pushi, [OBJECTS]), ...ins(Op.Push0), ...ins(Op.Callk, [vm.kernel.indexOf("ScriptID"), 4])];
  }
  const kernel = world().vm;

  it("un envoi à plusieurs sélecteurs les traite dans l'ordre", () => {
    // (thing x: 3 y: 4 sum:) : deux écritures puis une méthode.
    const message = [sel("x"), 1, 3, sel("y"), 1, 4, sel("sum"), 0];
    const code = [...message.flatMap((value) => ins(Op.Pushi, [value])), ...loadThing(kernel), ...ins(Op.Send, [2 * message.length]), ...ret];
    expect(runProcedure(code).acc).toBe(3 + 4 + 1000);
  });

  it("une propriété lue après une méthode du même envoi voit son effet", () => {
    // (thing set: 9 x?) : la lecture attend le retour de la méthode.
    const message = [sel("set"), 1, 9, sel("x"), 0];
    const code = [...message.flatMap((value) => ins(Op.Pushi, [value])), ...loadThing(kernel), ...ins(Op.Send, [2 * message.length]), ...ret];
    expect(runProcedure(code).acc).toBe(9);
    // (thing x? set: 9) : la lecture passe d'abord, le résultat est celui de la méthode (le 9 qu'elle laisse dans l'accumulateur).
    const reversed = [sel("x"), 0, sel("set"), 1, 9];
    const second = runProcedure([...reversed.flatMap((value) => ins(Op.Pushi, [value])), ...loadThing(kernel), ...ins(Op.Send, [2 * reversed.length]), ...ret]);
    expect(second.acc).toBe(9);
    expect(readSelector(second.vm.memory, second.thing, sel("x"))).toBe(9);
  });

  it("&rest transmet les arguments à un envoi", () => {
    // (thing set: &rest) appelé avec (31). `&rest` vaut pour l'appel qui suit : l'objet est donc cherché avant, dans une variable.
    const temp = VariableType.Temp;
    const code = [
      ...ins(Op.Link, [1]),
      ...loadThing(kernel),
      ...ins(Op.FirstVariable | temp | (VariableOperation.Store << VAR_OPERATION_SHIFT), [0]),
      ...ins(Op.Pushi, [sel("set")]),
      ...ins(Op.Push0),
      ...ins(Op.Rest, [1]),
      ...ins(Op.FirstVariable | temp, [0]),
      ...ins(Op.Send, [4]),
      ...ret,
    ];
    const { vm, thing } = runProcedure(code, [31]);
    expect(readSelector(vm.memory, thing, sel("x"))).toBe(31);
  });

  it("class charge l'adresse d'une classe, à qui l'on peut envoyer un message", () => {
    for (const byteForm of [false, true]) {
      const code = [...ins(Op.Pushi, [sel("kind")]), ...ins(Op.Push0), ...ins(Op.Class, [DERIVED], byteForm), ...ins(Op.Send, [4]), ...ret];
      expect(runProcedure(code).acc).toBe(2);
    }
  });

  it("refuse un envoi à autre chose qu'un objet, ou un sélecteur inconnu", () => {
    const { vm, thing } = world();
    expect(() => send(vm, 1234, "get")).toThrow(/n'est pas un objet/);
    expect(() => send(vm, thing, "play")).toThrow(/« thing » ne répond pas au sélecteur « play »/);
  });
});

describe("opcodes de propriétés et d'objets", () => {
  /** Ajoute à `thing` une méthode `doit` faite de `code`, l'appelle et rend l'accumulateur et l'objet. */
  function method(code: number[] | ((link: { object(name: string): number; string(text: string): number }) => number[])) {
    const spec: ScriptSpec = {
      ...objects,
      objects: objects.objects!.map((o) => (o.name === "thing" ? { ...o, methods: { ...o.methods, doit: code } } : o)),
    };
    const { vm } = makeWorld([{ number: 0, locals: [0] }, spec]);
    vm.useGlobals(vm.scripts.instantiate(0).localsSegment);
    const segment = vm.scripts.instantiate(OBJECTS);
    const thing = vm.scripts.exportedObject(segment, 0);
    vm.start(thing, sel("doit"), []);
    return { vm, thing, segment, acc: runToEnd(vm), object: vm.memory.getObject(thing)! };
  }

  it("pToa, aTop, pTos, sTop", () => {
    // y = x (par la pile), x = 50, résultat x + y.
    const { acc, object } = method([
      ...ins(Op.PTos, [X]),
      ...ins(Op.STop, [Y]),
      ...ins(Op.Ldi, [50]),
      ...ins(Op.ATop, [X], true),
      ...ins(Op.PTos, [X], true),
      ...ins(Op.PToa, [Y], true),
      ...ins(Op.Add),
      ...ret,
    ]);
    expect(acc).toBe(55);
    expect([object.vars[9], object.vars[10]]).toEqual([50, 5]);
  });

  it("ipToa, dpToa, ipTos, dpTos", () => {
    // x: 5 → 6 (acc), y: 6 → 5 (acc) ; data: 0 → 1 → 0 par la pile.
    const { vm, acc, object } = method([
      ...ins(Op.IpToa, [X]),
      ...ins(Op.Push),
      ...ins(Op.DpToa, [Y]),
      ...ins(Op.Push),
      ...ins(Op.IpTos, [DATA]),
      ...ins(Op.DpTos, [DATA]),
      ...ins(Op.Ldi, [0]),
      ...ins(Op.Add), // 0 (data après dpTos)
      ...ins(Op.Add), // + 1 (data après ipTos)
      ...ins(Op.Add), // + 5
      ...ins(Op.Add), // + 6
      ...ret,
    ]);
    expect(acc).toBe(12);
    expect([object.vars[9], object.vars[10], object.vars[11]]).toEqual([6, 5, 0]);
    expect(vm.warnings.size).toBe(0);
  });

  it("une propriété hors de l'objet se lit 0 et ne s'écrit pas", () => {
    const { vm, acc } = method([...ins(Op.Ldi, [9]), ...ins(Op.ATop, [2 * 40]), ...ins(Op.PToa, [2 * 40]), ...ret]);
    expect(acc).toBe(0);
    expect(vm.warnings.size).toBe(2);
  });

  it("selfID et pushSelf donnent l'objet courant", () => {
    const { acc, thing } = method([...ins(Op.PushSelf), ...ins(Op.SelfId), ...ins(Op.Eq), ...ins(Op.Push), ...ins(Op.SelfId), ...ins(Op.Toss), ...ret]);
    expect(acc).toBe(thing);
  });

  it("lofsa et lofss donnent une référence dans le heap du script", () => {
    const { vm, acc, segment, thing } = method((link) => [...ins(Op.Lofss, [link.object("thing")]), ...ins(Op.Lofsa, [link.string("bonjour")]), ...ins(Op.ATop, [DATA]), ...ins(Op.Toss), ...ins(Op.Lofsa, [link.object("thing")]), ...ret]);
    expect(acc).toBe(thing);
    expect(regSegment(acc)).toBe(segment.id);
    expect(vm.memory.getString(readSelector(vm.memory, thing, sel("data")))).toBe("bonjour");
  });

  it("un clone copie les propriétés, garde les méthodes et hérite comme son modèle", () => {
    const { vm, thing } = world();
    const call = (name: string, ...args: number[]): number => vm.kernel.call(vm, vm.kernel.indexOf(name), Uint32Array.from(args));
    const copy = call("Clone", thing);
    const object = vm.memory.getObject(copy)!;
    expect(object.info & INFO_CLONE).toBe(INFO_CLONE);
    expect(object.vars[OBJECT_PROPERTY.Species]).toBe(thing);
    expect(object.superClass).toBe(vm.scripts.classAddress(DERIVED, 0));
    send(vm, copy, "x", 70);
    expect(send(vm, copy, "sum")).toBe(70 + 6 + 1000);
    expect(send(vm, copy, "cue")).toBe(77);
    expect(send(vm, thing, "x")).toBe(5);

    // Clone d'une classe : une instance dont la classe mère est cette classe.
    const derived = vm.scripts.classAddress(DERIVED, 0);
    const instance = call("Clone", derived);
    expect(vm.memory.getObject(instance)!.info & (INFO_CLASS | INFO_CLONE)).toBe(INFO_CLONE);
    expect(vm.memory.getObject(instance)!.superClass).toBe(derived);
    expect(send(vm, instance, "kind")).toBe(2);
    expect(call("RespondsTo", instance, sel("get"))).toBe(1);
    expect(call("RespondsTo", instance, sel("cue"))).toBe(0);
    expect(call("RespondsTo", 5, sel("get"))).toBe(0);

    // DisposeClone : le clone reste lisible mais n'est plus un objet ; un objet de script n'est pas touché.
    call("DisposeClone", instance);
    expect(vm.memory.isObject(instance)).toBe(false);
    expect(readSelector(vm.memory, instance, sel("x"))).toBe(10);
    call("DisposeClone", thing);
    expect(vm.memory.isObject(thing)).toBe(true);
    expect(vm.run().status).toBe(RunStatus.Finished);
  });
});
