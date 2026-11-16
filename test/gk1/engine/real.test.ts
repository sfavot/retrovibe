import { describe, expect, it } from "vitest";
import { ResourceType } from "../../../src/games/gk1/data/ids";
import { OBJECT_PROPERTY } from "../../../src/games/gk1/data/script";
import { collectGarbage } from "../../../src/games/gk1/engine/gc";
import { VIEW_PROPERTY_FIRST, VIEW_PROPERTY_LAST } from "../../../src/games/gk1/engine/ids";
import { NULL_REG, type Reg, regSegment } from "../../../src/games/gk1/engine/memory";
import { RunStatus, Vm } from "../../../src/games/gk1/engine/vm";
import { mainIndex, original } from "../data/real";

/** Exécute jusqu'à `frames` suspensions ; l'horloge avance d'un tick par tranche, comme la boucle du jeu. */
function runFrames(vm: Vm, frames: number): void {
  for (let done = 0, slices = 0; done < frames; slices++) {
    if (slices > 100 * frames + 1000) throw new Error("le jeu ne rend plus la main");
    const result = vm.run();
    if (result.status === RunStatus.Finished) throw new Error("play est revenu");
    if (result.status === RunStatus.Suspended) {
      expect(result.reason).toBe("FrameOut");
      done++;
    }
    vm.ticks++;
  }
}

function send(vm: Vm, object: Reg, selector: string, ...args: Reg[]): Reg {
  vm.start(object, vm.selectors.id(selector), args);
  expect(vm.run().status).toBe(RunStatus.Finished);
  return vm.acc;
}

function classNamed(vm: Vm, name: string): Reg {
  for (let species = 0; species < vm.scripts.classCount; species++) {
    const address = vm.scripts.classAddress(species, 0);
    if (vm.nameOf(address) === name) return address;
  }
  throw new Error(name);
}

describe.skipIf(!original.has)("scripts réels", () => {
  it("charge les 213 scripts : objets, classes, formes", () => {
    const vm = new Vm(mainIndex());
    const numbers = mainIndex().numbers(ResourceType.Script);
    expect(numbers).toHaveLength(213);
    for (const number of numbers) vm.scripts.instantiate(number);
    const segments = vm.memory.scriptSegments();
    expect(segments).toHaveLength(213);
    let objects = 0;
    let classes = 0;
    for (const segment of segments) {
      for (const object of segment.objects.values()) {
        objects++;
        if (object.isClass) classes++;
        // Toute instance a une classe, autant de propriétés qu'elle, et `-propDict-` est une référence.
        const superClass = vm.memory.getObject(object.superClass);
        if (!object.isClass) expect(superClass?.isClass).toBe(true);
        if (!object.isClass) expect(object.vars.length).toBe(superClass!.vars.length);
        expect(object.shape.selectors.length).toBe(object.vars.length);
        expect(regSegment(object.vars[OBJECT_PROPERTY.PropertyDict])).toBeGreaterThan(0);
        expect(object.vars[OBJECT_PROPERTY.ClassScript]).toBe(segment.number);
      }
    }
    expect([objects, classes]).toEqual([2629, 170]);
    expect(vm.scripts.classCount).toBe(169);
    expect(vm.warnings.size).toBe(0);
  });

  it("la classe 133 (ForRepeat) est celle du script 808, même si le script 22 est chargé d'abord", () => {
    const vm = new Vm(mainIndex());
    const first = vm.scripts.instantiate(22);
    expect(vm.scripts.loaded(808)).toBeUndefined();
    const address = vm.scripts.classAddress(133, 0);
    expect(vm.nameOf(address)).toBe("ForRepeat");
    expect(regSegment(address)).toBe(vm.scripts.loaded(808)!.id);
    expect(regSegment(address)).not.toBe(first.id);
  });

  it("les indices 26 à 44 de View sont ses propriétés graphiques, de x à yStep", () => {
    const vm = new Vm(mainIndex());
    const view = vm.memory.getObject(classNamed(vm, "View"))!;
    const names = [...view.shape.selectors].map((selector) => vm.selectors.name(selector));
    expect(names.slice(VIEW_PROPERTY_FIRST, VIEW_PROPERTY_LAST + 1)).toEqual(
      "x y z scaleX scaleY maxScale scaleType priority fixPriority inLeft inTop inRight inBottom useInsetRect view loop cel bitmap yStep".split(" "),
    );
    expect(names[VIEW_PROPERTY_FIRST - 1]).toBe("plane");
    // `name` n'est pas toujours la neuvième propriété : on la trouve par son sélecteur.
    expect(view.propertyIndex(vm.selectors.id("name"))).toBe(OBJECT_PROPERTY.Name);
  });

  it("envoie des messages aux classes du système : new, isKindOf, isMemberOf, respondsTo, héritage", () => {
    const vm = new Vm(mainIndex());
    vm.useGlobals(vm.scripts.instantiate(0).localsSegment);
    const obj = classNamed(vm, "Obj");
    const list = classNamed(vm, "List");
    const collection = classNamed(vm, "Collect");
    expect(vm.memory.getObject(list)!.superClass).toBe(collection);

    // (List new:) : la méthode `new` vient de Obj, deux classes plus haut, et appelle Clone.
    const made = send(vm, list, "new");
    expect(vm.memory.isObject(made)).toBe(true);
    expect(vm.memory.getObject(made)!.isClone).toBe(true);
    expect(vm.memory.getObject(made)!.superClass).toBe(list);
    expect(send(vm, made, "isKindOf", collection)).not.toBe(0);
    expect(send(vm, made, "isKindOf", obj)).not.toBe(0);
    expect(send(vm, made, "isKindOf", classNamed(vm, "View"))).toBe(0);
    expect(send(vm, made, "isMemberOf", list)).not.toBe(0);
    expect(send(vm, made, "isMemberOf", collection)).toBe(0);
    expect(send(vm, made, "respondsTo", vm.selectors.id("addToFront"))).not.toBe(0);
    expect(send(vm, made, "respondsTo", vm.selectors.id("cel"))).toBe(0);

    // La liste des scripts sait compter : add crée la liste du noyau, size la relit.
    send(vm, made, "add", obj, list);
    expect(send(vm, made, "size")).toBe(2);
    expect(send(vm, made, "contains", list)).not.toBe(0);
    send(vm, made, "delete", obj);
    expect(send(vm, made, "size")).toBe(1);
    send(vm, made, "dispose");
    expect(vm.memory.isObject(made)).toBe(false);
    expect(vm.warnings.size).toBe(0);
  });
});

describe.skipIf(!original.has)("démarrage sans tête", () => {
  function boot(): Vm {
    const vm = new Vm(mainIndex());
    vm.kernel.journal.capture = true;
    vm.boot();
    return vm;
  }

  it("play s'exécute jusqu'au premier FrameOut, avec un journal du noyau identique d'une exécution à l'autre", () => {
    const first = boot();
    runFrames(first, 1);
    const second = boot();
    runFrames(second, 1);
    expect(second.kernel.journal.entries).toEqual(first.kernel.journal.entries);
    expect(second.kernel.journal.hash).toBe(first.kernel.journal.hash);
    expect(second.instructionCount).toBe(first.instructionCount);

    expect(first.nameOf(first.gameObject)).toBe("GK");
    // FrameOut laisse l'accumulateur tel quel : le journal montre la valeur qu'il avait.
    expect(first.kernel.journal.entries.at(-1)).toMatch(/^FrameOut\(\) = /);
    expect(first.warnings.size).toBe(0);
    expect(Object.fromEntries(first.kernel.journal.countsByName())).toMatchInlineSnapshot(`
      {
        "AddPlane": 4,
        "AddScreenItem": 148,
        "AddToEnd": 165,
        "AddToFront": 1,
        "Array": 1,
        "BaseSetter": 30,
        "CelHigh": 8,
        "CelWide": 8,
        "Clone": 14,
        "DeleteScreenItem": 85,
        "DisposeClone": 1,
        "DisposeScript": 3,
        "DoSound": 11,
        "FileIO": 4,
        "FindKey": 433,
        "FirstNode": 17,
        "FrameOut": 1,
        "GetSaveDir": 2,
        "GetTime": 2,
        "Graph": 1,
        "IsHiRes": 147,
        "ListEachElementDo": 14,
        "Load": 1,
        "NewList": 29,
        "NewNode": 166,
        "NextNode": 360,
        "NodeValue": 360,
        "PalCycle": 1,
        "Platform": 1,
        "Purge": 1,
        "RemapColors": 1,
        "ScriptID": 62,
        "SetCursor": 2,
        "SetNowSeen": 148,
        "SetShowStyle": 1,
        "String": 9,
        "UpdatePlane": 5,
        "UpdateScreenItem": 9,
      }
    `);
    expect([first.instructionCount, first.kernel.journal.entries.length, first.kernel.journal.hash.toString(16)]).toMatchInlineSnapshot(`
      [
        55854,
        2256,
        "cc091ace",
      ]
    `);
    expect([...first.kernel.journal.stubs.keys()].sort()).toMatchInlineSnapshot(`[]`);
  });

  it("la boucle du jeu tourne ensuite image après image, et le ramasse-miettes ne change rien à l'exécution", () => {
    const frames = 300;
    const plain = boot();
    runFrames(plain, frames);
    const collected = boot();
    collected.gcInterval = 40;
    runFrames(collected, frames);
    expect(Object.fromEntries(collected.kernel.journal.countsByName())).toEqual(Object.fromEntries(plain.kernel.journal.countsByName()));
    expect(collected.instructionCount).toBe(plain.instructionCount);
    expect(plain.warnings.size + collected.warnings.size).toBe(0);
    // Un clone d'évènement par image : sans ramassage ils s'accumulent, avec ils sont repris.
    expect(plain.memory.clones.size).toBeGreaterThan(frames / 2);
    expect(collected.memory.clones.size).toBeLessThan(60);
    expect(collectGarbage(plain).clones).toBeGreaterThan(frames / 2);
    expect(plain.acc).not.toBe(NULL_REG);
    expect(plain.backtrace().at(-1)).toMatch(/^GK::play \(script 0/);
  });
});
