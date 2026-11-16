import { describe, expect, it } from "vitest";
import { INFO_CLASS, NO_SUPERCLASS, OBJECT_MAGIC, ResourceType, SPECIES_INSTANCE, VOCAB_CLASS_TABLE, VOCAB_SELECTOR_NAMES } from "../../../src/games/gk1/data/ids";
import { heapString, OBJECT_HEADER_PROPERTIES, OBJECT_PROPERTY, objectAt, readScript } from "../../../src/games/gk1/data/script";
import { readClassTable, readSelectorNames } from "../../../src/games/gk1/data/vocab";
import { mainIndex, original, tally } from "./real";

function words(...values: number[]): number[] {
  return values.flatMap((v) => [v & 0xff, v >> 8]);
}

/**
 * Paire synthétique : une classe « Obj » (espèce 7, 10 propriétés, 1 méthode) et une instance « it », deux variables locales,
 * trois exports (procédure, objet, vide).
 */
function buildPair(): { script: Uint8Array; heap: Uint8Array } {
  // Heap : en-tête (4) + 2 locales (4) = 8 ; classe à 8 (10 mots), instance à 28 (9 mots), 0 à 46, chaînes à 48.
  const strings = [0x4f, 0x62, 0x6a, 0, 0x69, 0x74, 0]; // « Obj » à 48, « it » à 52
  const relocation = 48 + strings.length;
  const heap = Uint8Array.from([
    ...words(relocation, 2, 5, 52),
    ...words(OBJECT_MAGIC, 10, 14, 34, 0, 7, NO_SUPERCLASS, INFO_CLASS, 48, 123),
    ...words(OBJECT_MAGIC, 9, 0, 40, 0, SPECIES_INSTANCE, 7, 0, 52),
    ...words(0),
    ...strings,
    ...words(3, 6, 24, 44),
  ]);
  // Script : en-tête (8) + 3 exports (6) = 14 ; dictionnaire de propriétés à 14 (10 mots), méthodes à 34 et 40, code à 42.
  const script = Uint8Array.from([
    ...words(44, 0, 0, 3, 42, 28, 0),
    ...words(4096, 4097, 4098, 4099, 4100, 4101, 4102, 4103, 20, 1),
    ...words(1, 60, 42),
    ...words(0),
    0x48, 0x00, // code factice (ret)
    ...words(1, 10),
  ]);
  return { script, heap };
}

describe("script et heap SCI2", () => {
  it("lit exports, variables, objets, chaînes et relocations", () => {
    const { script, heap } = buildPair();
    const result = readScript(script, heap);
    expect(result.exports).toEqual([
      { offset: 42, isObject: false },
      { offset: 28, isObject: true },
      { offset: 0, isObject: false },
    ]);
    expect([...result.locals]).toEqual([5, 52]);
    expect(result.localIsPointer).toEqual([false, true]);
    expect(result.codeEnd).toBe(44);
    expect([...result.scriptRelocations]).toEqual([10]);
    expect([...result.heapRelocations]).toEqual([6, 24, 44]);
    expect(result.strings).toEqual([
      { offset: 48, text: "Obj" },
      { offset: 52, text: "it" },
    ]);

    const [cls, instance] = result.objects;
    expect(cls).toMatchObject({ offset: 8, isClass: true, species: 7, superClass: NO_SUPERCLASS, name: "Obj", methods: [{ selector: 60, codeOffset: 42 }] });
    expect([...cls.propertySelectors!]).toEqual([4096, 4097, 4098, 4099, 4100, 4101, 4102, 4103, 20, 1]);
    expect(cls.values[9]).toBe(123);
    expect(cls.isPointer.map((p, i) => (p ? i : -1)).filter((i) => i >= 0)).toEqual([OBJECT_PROPERTY.Name]);
    expect(instance).toMatchObject({ offset: 28, isClass: false, species: SPECIES_INSTANCE, superClass: 7, name: "it", methods: [], propertySelectors: undefined });
    expect(objectAt(result, result.exports[1].offset)).toBe(instance);
    expect(objectAt(result, 9)).toBeUndefined();
    expect(heapString(heap, 52)).toBe("it");
    expect(() => heapString(heap, 500)).toThrow(/hors du heap/);
  });

  it("refuse une table de relocation mal placée, un objet sans signature ou trop grand", () => {
    const { script, heap } = buildPair();
    expect(() => readScript(script.subarray(0, script.length - 1), heap)).toThrow(/ne finit pas à la fin du script/);
    expect(() => readScript(script, Uint8Array.from([...heap, 0]))).toThrow(/ne finit pas à la fin du heap/);
    const noMagic = heap.slice();
    noMagic[8] = 0x35;
    expect(() => readScript(script, noMagic)).toThrow(/sans signature/);
    const huge = heap.slice();
    huge[10] = 200;
    expect(() => readScript(script, huge)).toThrow(/taille invalide/);
    const tiny = heap.slice();
    tiny[10] = OBJECT_HEADER_PROPERTIES - 1;
    expect(() => readScript(script, tiny)).toThrow(/taille invalide/);
    expect(() => readScript(Uint8Array.of(0), heap)).toThrow(/script tronqué/);
  });
});

describe.skipIf(!original.has)("scripts de Gabriel Knight", () => {
  it("lit les 213 paires : 2 629 objets, 170 classes, 3 346 méthodes, 1 127 variables, 455 exports", () => {
    const index = mainIndex();
    const selectors = readSelectorNames(index.get(ResourceType.Vocab, VOCAB_SELECTOR_NAMES));
    const classTable = readClassTable(index.get(ResourceType.Vocab, VOCAB_CLASS_TABLE));
    const numbers = index.numbers(ResourceType.Script);
    expect(numbers).toHaveLength(213);

    let objects = 0;
    let methods = 0;
    let locals = 0;
    let strings = 0;
    const exportKinds: string[] = [];
    const scriptRelocationKinds: string[] = [];
    let heapRelocations = 0;
    const speciesScripts = new Map<number, number[]>();
    const nameless: string[] = [];
    const header = ["-objID-", "-size-", "-propDict-", "-methDict-", "-classScript-", "-script-", "-super-", "-info-"];

    for (const n of numbers) {
      const script = readScript(index.get(ResourceType.Script, n), index.get(ResourceType.Heap, n));
      const objectOffsets = new Set(script.objects.map((o) => o.offset));
      const stringOffsets = new Set(script.strings.map((s) => s.offset));
      objects += script.objects.length;
      locals += script.locals.length;
      strings += script.strings.length;
      expect(script.localIsPointer.some(Boolean)).toBe(false);

      // Exports : un export relocalisé désigne un objet du heap, les autres du code (ou rien).
      for (const e of script.exports) {
        if (e.isObject) expect(objectOffsets.has(e.offset)).toBe(true);
        else expect(e.offset).toBeLessThan(script.codeEnd);
        exportKinds.push(e.isObject ? "objet" : e.offset === 0 ? "vide" : "code");
      }

      // Relocations du script : exports d'objets, ou opérandes de code qui visent un objet ou une chaîne du heap.
      const exportsEnd = 8 + 2 * script.exports.length;
      const view = new DataView(script.script.buffer, script.script.byteOffset);
      for (const position of script.scriptRelocations) {
        const target = view.getUint16(position, true);
        expect(position).toBeLessThan(script.codeEnd - 1);
        const kind = objectOffsets.has(target) ? "objet" : stringOffsets.has(target) ? "chaîne" : "autre";
        scriptRelocationKinds.push(`${position < exportsEnd ? "export" : "code"}→${kind}`);
      }

      // Relocations du heap : uniquement des propriétés d'objets, qui visent le début d'une chaîne.
      let pointers = 0;
      for (const object of script.objects) {
        methods += object.methods.length;
        expect(object.values[OBJECT_PROPERTY.Magic]).toBe(OBJECT_MAGIC);
        expect(object.values[OBJECT_PROPERTY.ClassScript]).toBe(0);
        expect(object.isPointer.slice(0, OBJECT_HEADER_PROPERTIES).some(Boolean)).toBe(false);
        object.isPointer.forEach((isPointer, i) => {
          if (!isPointer) return;
          pointers++;
          expect(stringOffsets.has(object.values[i])).toBe(true);
        });
        for (const method of object.methods) {
          expect(method.selector).toBeLessThan(selectors.length);
          expect(method.codeOffset).toBeLessThan(script.codeEnd);
        }
        if (object.name === "") nameless.push(`${n}@${object.offset}`);
        if (!object.isClass) {
          expect(object.species).toBe(SPECIES_INSTANCE);
          expect(object.propertySelectors).toBeUndefined();
          continue;
        }
        expect([...object.propertySelectors!.slice(0, OBJECT_HEADER_PROPERTIES)].map((s) => selectors[s])).toEqual(header);
        if (object.name !== "") expect(selectors[object.propertySelectors![OBJECT_PROPERTY.Name]]).toBe("name");
        expect(object.species).toBeLessThan(classTable.length);
        speciesScripts.set(object.species, [...(speciesScripts.get(object.species) ?? []), n]);
      }
      expect(pointers).toBe(script.heapRelocations.length);
      heapRelocations += pointers;

      // Les chaînes vont jusqu'à la table de relocation, sans trou.
      const last = script.strings[script.strings.length - 1];
      if (last) expect(script.heap.indexOf(0, last.offset) + 1).toBe(new DataView(script.heap.buffer, script.heap.byteOffset).getUint16(0, true));
    }

    expect(objects).toBe(2629);
    expect(methods).toBe(3346);
    expect(locals).toBe(1127);
    expect(strings).toBe(3284);
    expect(heapRelocations).toBe(2632);
    expect(Object.fromEntries(tally(exportKinds))).toEqual({ objet: 408, code: 43, vide: 4 });
    expect(Object.fromEntries(tally(scriptRelocationKinds))).toEqual({ "export→objet": 408, "code→objet": 6615, "code→chaîne": 601 });

    // 170 classes pour 169 espèces : la classe 133 (ForRepeat) est définie dans les scripts 22 et 808 ; la table retient 808.
    expect([...speciesScripts.values()].reduce((a, s) => a + s.length, 0)).toBe(170);
    expect(speciesScripts.size).toBe(169);
    for (const [species, scripts] of speciesScripts) {
      if (species === 133) expect(scripts).toEqual([22, 808]);
      else expect(scripts).toEqual([classTable[species]]);
    }
    expect(classTable[133]).toBe(808);
    expect(nameless).toEqual(["64916@4", "64943@90", "64943@112"]);
  });

  it("lit le script 0 : curseurs, exports et noms de méthodes", () => {
    const index = mainIndex();
    const selectors = readSelectorNames(index.get(ResourceType.Vocab, VOCAB_SELECTOR_NAMES));
    const script = readScript(index.get(ResourceType.Script, 0), index.get(ResourceType.Heap, 0));
    expect(script.exports).toHaveLength(2);
    expect(script.objects[0].name).toBe("theWaitCursor");
    expect(script.strings.slice(0, 3).map((s) => s.text)).toEqual(["theWaitCursor", "theNormalCursor", "takeCursor"]);
    const game = objectAt(script, script.exports[0].offset)!;
    expect(script.exports[0].isObject).toBe(true);
    expect(game.methods.map((m) => selectors[m.selector])).toContain("play");
  });
});
