import { describe, expect, it } from "vitest";
import { digitalAudioOf } from "../../../src/games/gk1/audio/digital";
import { parseDurationJson, samplesToTicks, voiceIndexPath } from "../../../src/games/gk1/data/audio-index";
import { ResourceType } from "../../../src/games/gk1/data/ids";
import { readScript } from "../../../src/games/gk1/data/script";
import { disassembleScript } from "../../../src/games/gk1/engine/disasm";
import { DoAudioOp } from "../../../src/games/gk1/engine/kernel/audio";
import { type Reg, toSint16 } from "../../../src/games/gk1/engine/memory";
import { messagesOf } from "../../../src/games/gk1/engine/message";
import { applyPatch, compileSignature, findSignature, type GameFixes, missingParamValue, NO_FIXES, ScriptPatcher, uninitializedValue, VariableKind } from "../../../src/games/gk1/engine/patches";
import { RunStatus, Vm } from "../../../src/games/gk1/engine/vm";
import { GK1_FIXES } from "../../../src/games/gk1/game/fixes";
import { diskFiles } from "../audio/digital-files";
import { fnv1a, mainIndex, original } from "../data/real";

/** Sélecteurs inventés pour la notation. */
const SELECTORS: Record<string, number> = { view: 14, setCursor: 418 };
const resolve = (name: string): number => SELECTORS[name] ?? -1;

describe("notation des correctifs", () => {
  it("signature : octets, mots, sélecteurs, octets quelconques", () => {
    expect(compileSignature("3c w:00dc s:setCursor b:view +2 48", resolve)).toEqual([0x3c, 0xdc, 0x00, 0xa2, 0x01, 14, -1, -1, 0x48]);
    expect(() => compileSignature("3c zz", resolve)).toThrow("zz");
    expect(() => compileSignature("s:inconnu", resolve)).toThrow("inconnu");
    expect(() => compileSignature("b:setCursor", resolve)).toThrow("trop grand");
  });

  it("recherche : toutes les occurrences, les octets quelconques ne comptent pas", () => {
    const data = Uint8Array.of(1, 2, 3, 9, 1, 7, 3, 1, 2);
    expect(findSignature(data, compileSignature("01 +1 03", resolve))).toEqual([0, 4]);
    expect(findSignature(data, compileSignature("+1 03", resolve))).toEqual([1, 5]);
    expect(findSignature(data, compileSignature("05", resolve))).toEqual([]);
  });

  it("remplacement : octets gardés, octets et mots d'origine ajustés, copie", () => {
    const original = Uint8Array.of(0x10, 0x20, 0x30, 0x40, 0xff, 0x01, 0x70, 0x80);
    const data = original.slice();
    applyPatch(data, original, 1, "+1 o:3 o:0+2 ow:3-1 c:0*2", resolve);
    //                                      0x20 gardé, puis 0xff, 0x22, 0x01fe (0x01ff - 1), puis 0x20 0x30
    expect([...data]).toEqual([0x10, 0x20, 0xff, 0x22, 0xfe, 0x01, 0x20, 0x30]);
    expect(() => applyPatch(original.slice(), original, 7, "01 02", resolve)).toThrow("plus long");
  });

  it("ScriptPatcher : une copie corrigée, `count` occurrences, rien si la signature manque", () => {
    const code = Uint8Array.of(1, 2, 3, 1, 2, 3, 1, 2, 3);
    const heap = Uint8Array.of(9, 1, 2, 3);
    const patcher = new ScriptPatcher(
      [
        { script: 7, name: "deux premières", count: 2, signature: "01 02", patch: "+1 aa" },
        { script: 7, name: "dans le heap", count: 1, signature: "09 01", patch: "bb" },
        { script: 7, name: "absente", count: 1, signature: "05 05", patch: "cc" },
        { script: 7, name: "pas assez", count: 5, signature: "01 02 03", patch: "dd" },
        { script: 7, name: "autre jeu", count: 1, signature: "01 s:inconnu", patch: "ee" },
      ],
      resolve,
    );
    const patched = patcher.patch(7, code, heap);
    expect([...patched.code]).toEqual([1, 0xaa, 3, 1, 0xaa, 3, 1, 2, 3]);
    expect([...patched.heap]).toEqual([0xbb, 1, 2, 3]);
    expect([...code]).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3]);
    expect(patcher.applied).toEqual(["7:deux premières", "7:dans le heap"]);
    // Rechargement : la même copie, sans recompter ; un autre script est rendu tel quel.
    expect(patcher.patch(7, code, heap)).toBe(patched);
    expect(patcher.applied).toHaveLength(2);
    expect(patcher.patch(8, code, heap).code).toBe(code);
  });

  it("lecture non initialisée connue : par script, objet, méthode, sorte et indice", () => {
    expect(uninitializedValue(GK1_FIXES, 64950, "Feature", "handleEvent", VariableKind.Temp, 0)).toBe(0);
    expect(uninitializedValue(GK1_FIXES, 12, "GKIconbar", "showInvItem", VariableKind.Param, 1)).toBe(1);
    expect(uninitializedValue(GK1_FIXES, 64950, "Feature", "handleEvent", VariableKind.Temp, 1)).toBeUndefined();
    expect(uninitializedValue(GK1_FIXES, 64950, "Feature", "handleEvent", VariableKind.Param, 0)).toBeUndefined();
  });

  it("paramètre non passé connu : par script, objet, méthode et indice", () => {
    // `GKEgo::getPoints(drapeau)` sans le nombre de points (enveloppe du jour 6) : un point, au lieu du score doublé.
    expect(missingParamValue(GK1_FIXES, 18, "GKEgo", "getPoints", 2)).toBe(1);
    expect(missingParamValue(GK1_FIXES, 18, "GKEgo", "getPoints", 1)).toBeUndefined();
    expect(missingParamValue(GK1_FIXES, 18, "GKEgo", "get", 2)).toBeUndefined();
    expect(missingParamValue(NO_FIXES, 18, "GKEgo", "getPoints", 2)).toBeUndefined();
  });
});

describe.skipIf(!original.has)("correctifs de GK1 sur les scripts du CD français", () => {
  const names = () => GK1_FIXES.scriptPatches.map((patch) => `${patch.script}:${patch.name}`);

  it("chaque signature est dans son script, autant de fois qu'il le faut ; les noms sont uniques", () => {
    const index = mainIndex();
    const vm = new Vm(index);
    for (const patch of GK1_FIXES.scriptPatches) {
      const code = index.get(ResourceType.Script, patch.script);
      const heap = index.get(ResourceType.Heap, patch.script);
      const data = new Uint8Array(code.length + heap.length);
      data.set(code);
      data.set(heap, code.length);
      const found = findSignature(data, compileSignature(patch.signature, (name) => vm.selectors.find(name)));
      expect(found.length, `${patch.script}:${patch.name}`).toBeGreaterThanOrEqual(patch.count);
    }
    expect(new Set(names()).size).toBe(GK1_FIXES.scriptPatches.length);
  });

  it("tous les correctifs se posent, les scripts corrigés se désassemblent sans saut au milieu d'une instruction", () => {
    const index = mainIndex();
    const vm = new Vm(index);
    const scripts = [...new Set(GK1_FIXES.scriptPatches.map((patch) => patch.script))].sort((a, b) => a - b);
    const sums: Record<number, string> = {};
    for (const number of scripts) {
      const code = index.get(ResourceType.Script, number);
      const heap = index.get(ResourceType.Heap, number);
      const patched = vm.patcher.patch(number, code, heap);
      expect(patched.code).not.toBe(code);
      expect([patched.code.length, patched.heap.length]).toEqual([code.length, heap.length]);
      const before = disassembleScript(readScript(code, heap));
      const after = disassembleScript(readScript(patched.code, patched.heap));
      // Deux correctifs déplacent ou retirent un `lofsa` : la table de relocation du script, que le moteur ne lit pas pour le
      // code, désigne alors un autre octet. Toute autre anomalie serait un correctif mal posé.
      const serious = after.problems.filter((problem) => !before.problems.includes(problem) && !problem.includes("relocation"));
      expect(serious, `script ${number}`).toEqual([]);
      expect(after.routines.length, `script ${number}`).toBe(before.routines.length);
      expect(after.unattributed, `script ${number}`).toEqual(before.unattributed);
      sums[number] = ((fnv1a(patched.code) ^ Math.imul(fnv1a(patched.heap), 31)) >>> 0).toString(16);
    }
    expect(vm.patcher.applied).toEqual(names().sort((a, b) => Number.parseInt(a) - Number.parseInt(b)));
    expect(sums).toMatchInlineSnapshot(`
      {
        "0": "eafe141",
        "21": "751fd969",
        "210": "44e079bb",
        "211": "a59b0283",
        "212": "5d916adf",
        "220": "5abd75ce",
        "230": "770133bd",
        "231": "18c2ef95",
        "250": "2410f224",
        "260": "977d3ce1",
        "280": "f45e1648",
        "350": "c8ef2728",
        "380": "ef43ccfc",
        "420": "75e4851c",
        "471": "389c7283",
        "480": "e2db1521",
        "530": "8888e240",
        "64928": "c0beca15",
        "64990": "4f196f45",
        "710": "8d0664e9",
        "720": "7f092aa9",
        "891": "9c300a3",
        "892": "fae70c27",
        "894": "21fbaef7",
        "93": "e135deb4",
      }
    `);
  });

  it("sans correctifs, les scripts sont ceux des ressources", () => {
    const index = mainIndex();
    const vm = new Vm(index, NO_FIXES);
    expect(vm.scripts.instantiate(0).code).toBe(index.get(ResourceType.Script, 0));
    expect(vm.patcher.applied).toEqual([]);
    expect(new Vm(index).scripts.instantiate(0).code).not.toBe(index.get(ResourceType.Script, 0));
  });

  it("Feature::handleEvent rend sa variable temporaire sans l'avoir écrite : valeur connue, sans avertissement, héritiers compris", () => {
    // Un évènement qui ne concerne pas l'objet : la méthode saute tout et rend `temp0`, jamais écrite sur une pile neuve.
    const ignored = (fixes: GameFixes | undefined, className: string): { result: Reg; warnings: string[] } => {
      const vm = new Vm(mainIndex(), fixes);
      vm.useGlobals(vm.scripts.instantiate(0).localsSegment);
      const classNamed = (name: string): Reg => {
        for (let species = 0; species < vm.scripts.classCount; species++) {
          const address = vm.scripts.classAddress(species, 0);
          if (vm.nameOf(address) === name) return address;
        }
        throw new Error(name);
      };
      const clone = (name: string): Reg => vm.kernel.call(vm, vm.kernel.indexOf("Clone"), Uint32Array.of(classNamed(name)));
      const event = clone("Event");
      vm.start(clone(className), vm.selectors.id("handleEvent"), [event]);
      expect(vm.run().status).toBe(RunStatus.Finished);
      return { result: vm.acc, warnings: [...vm.warnings.keys()] };
    };
    expect(ignored(undefined, "Feature")).toEqual({ result: 0, warnings: [] });
    // `View` hérite la méthode de `Feature` : même lecture, reconnue par la classe mère.
    expect(ignored(undefined, "View")).toEqual({ result: 0, warnings: [] });
    // Sur les scripts tels quels, c'est bien cette lecture qui est signalée.
    const raw = ignored(NO_FIXES, "Feature");
    expect(raw.warnings).toEqual(["lecture d'une variable de pile non initialisée (script 64950, Feature::handleEvent)"]);
  });

  it("messages et voix rangés sous une autre clé", () => {
    const vm = new Vm(mainIndex());
    vm.useGlobals(vm.scripts.instantiate(0).localsSegment);
    const messages = messagesOf(vm);
    const lorelei = (cond: number) => ({ noun: 2, verb: 32, cond, seq: 1 });
    // Condition 3, qui n'existe pas : le texte « assise » de la condition 0, dont la voix est rangée sous la condition 3.
    expect(messages.get(420, lorelei(3), true)?.text).toContain("avenir");
    expect(messages.lastQuery()).toEqual({ module: 420, tuple: lorelei(0) });
    expect(messages.next(true)).toBeUndefined();
    // Condition 0 : le texte « en train de danser » de la condition 2 (pas de second remplacement en chaîne).
    expect(messages.get(420, lorelei(0), true)?.text).toContain("danseuse");
    expect(messages.lastQuery()).toEqual({ module: 420, tuple: lorelei(2) });
    expect(messages.size(420, lorelei(3))).toBeGreaterThan(1);
    // L'artiste : le message de la photocopie (verbe 48) est celui de l'original (verbe 24).
    expect(messages.get(410, { noun: 3, verb: 48, cond: 31, seq: 1 }, true)?.text).toContain("artiste");
    expect(messages.lastQuery().tuple.verb).toBe(24);
    // Sans correctifs : rien sous ces clés.
    const raw = new Vm(mainIndex(), NO_FIXES);
    raw.useGlobals(raw.scripts.instantiate(0).localsSegment);
    expect(messagesOf(raw).get(420, lorelei(3), true)).toBeUndefined();
    expect(messagesOf(raw).get(410, { noun: 3, verb: 48, cond: 31, seq: 1 }, true)).toBeUndefined();

    // Voix : la clé du texte (condition 0) joue le clip rangé sous la condition 3.
    const files = diskFiles();
    digitalAudioOf(vm).files = files;
    const durations = parseDurationJson(files.text(voiceIndexPath(420)) as string);
    expect(durations.has("2-32-0-1")).toBe(false);
    const play = (machine: Vm): number => toSint16(machine.kernel.call(machine, machine.kernel.indexOf("DoAudio"), Uint32Array.of(DoAudioOp.Play, 420, 2, 32, 0, 1)));
    expect(play(vm)).toBe(samplesToTicks(durations.get("2-32-3-1")!));
  });
});
