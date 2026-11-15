import { describe, expect, it } from "vitest";
import {
  latin1String,
  loadOverlayFiles,
  nthString,
  parseOverlay,
  parseOverlayTexts,
  scriptImportName,
  scriptImports,
  splitNulStrings,
} from "../../../src/games/croisiere/data/overlay";
import { CruiseVolumes } from "../../../src/games/croisiere/data/volumes";
import { originalFiles } from "../../support/original";

const original = originalFiles("croisiere", "VOL.CNF");
const REQUIRED = ["VOL.CNF", "D1", "D2", "D3", "D4", "D5"];
const hasOriginalFiles = original.has && REQUIRED.every((name) => original.list((n) => n === name).length === 1);

let cached: CruiseVolumes | undefined;
function volumes(): CruiseVolumes {
  cached ??= CruiseVolumes.open((name) => original.read(name));
  return cached;
}

function overlayNames(): string[] {
  return [...new Set(volumes().entries.filter((e) => e.name.endsWith(".OVL")).map((e) => e.name.slice(0, -4)))];
}

/** Octets d'un OVL minimal : 1 procédure, 1 export, 1 import, 1 message, 1 objet, 1 état. */
function tinyOverlay(): Uint8Array {
  const out: number[] = new Array(60).fill(0xaa); // pointeurs mémoire : ignorés
  const w = (...values: number[]) => values.forEach((v) => out.push((v >> 8) & 255, v & 255));
  // numProc numRel numSymbGlob numRelocGlob numMsgRelHeader numObj numStrings numStates numObjVars
  w(1, 0, 1, 1, 0, 1, 1, 1, 0);
  // importNamesSize exportNamesSize specialString2Length bssSize initDataSize specialString1Length scriptNumber
  w(6, 4, 2, 10, 2, 3, 7);
  w(0, 0, 20, 0, 0); // export : var0 var2 var4 idx offsetToName
  out.push(...[..."run"].map((c) => c.charCodeAt(0)), 0);
  w(1, 2, 3, 4, 0); // import
  out.push(...[..."A.B"].map((c) => c.charCodeAt(0)), 0, 0, 0);
  out.push(0, 0, 0, 0); // pointeur de procédure
  w(6, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0); // sizeOfData=6 puis offsets, sysKey=3...
  out.push(0x08, 0x00, 0x2a, 0x50, 0x50, 0x00); // push 42 ; stop ; stop ; pad
  out.push(9, 8); // données initiales
  w(0, 1, 5, 2, 0, 0, 0); // objet
  w(1, 2, 3, 4, 5, 6); // état
  w(77); // id de message
  return Uint8Array.from(out);
}

describe("overlay (synthétique)", () => {
  it("lit toutes les sections d'un OVL minimal et garde les blocs en octets bruts copiés", () => {
    const file = tinyOverlay();
    const ovl = parseOverlay(file);
    expect(ovl.header).toMatchObject({ numProc: 1, numSymbGlob: 1, numRelocGlob: 1, numObj: 1, numStrings: 1, bssSize: 10, initDataSize: 2, scriptNumber: 7 });
    expect(ovl.exports).toEqual([{ var0: 0, var2: 0, var4: 20, idx: 0, offsetToName: 0, name: "run" }]);
    expect(ovl.imports[0]).toMatchObject({ linkType: 3, linkIdx: 4, name: "A.B" });
    expect(ovl.procs).toHaveLength(1);
    expect(ovl.procs[0]!.sysKey).toBe(3);
    expect(Array.from(ovl.procs[0]!.data)).toEqual([8, 0, 42, 0x50, 0x50, 0]);
    expect(Array.from(ovl.initData)).toEqual([9, 8]);
    expect(ovl.objects[0]).toMatchObject({ class: 1, nameOffset: 5, numStates: 2 });
    expect(ovl.states[0]).toEqual({ X: 1, Y: 2, Z: 3, frame: 4, scale: 5, state: 6 });
    expect(ovl.messageIds).toEqual([77]);
    // Le bloc est une copie : la modifier (liaison en place) ne touche pas le fichier.
    ovl.procs[0]!.data[0] = 0xff;
    expect(parseOverlay(file).procs[0]!.data[0]).toBe(8);
  });

  it("refuse un fichier tronqué ou suivi d'octets non expliqués", () => {
    const file = tinyOverlay();
    expect(() => parseOverlay(file.subarray(0, file.length - 3))).toThrow(/tronqué/);
    expect(() => parseOverlay(Uint8Array.from([...file, 0, 0]))).toThrow(/non expliqués/);
    expect(() => parseOverlay(Uint8Array.from([...file, 1]))).toThrow(/non expliqués/);
    expect(parseOverlay(Uint8Array.from([...file, 0])).messageIds).toEqual([77]); // padding d'un octet nul toléré
  });

  it("découpe les blocs de chaînes NUL et lit les textes d'un .FR minimal", () => {
    const blob = Uint8Array.from([97, 0, 98, 99, 0, 0, 100, 0]);
    expect(splitNulStrings(blob)).toEqual(["a", "bc", "", "d"]);
    expect(nthString(blob, 1)).toBe("bc");
    expect(nthString(blob, 2)).toBe("");
    expect(() => nthString(blob, 5)).toThrow(RangeError);
    expect(latin1String(Uint8Array.from([0xe9, 0x74, 0xe9, 0, 65]))).toBe("été");
    const fr = Uint8Array.from([0, 2, 86, 0, /* objets */ 0, 3, 79, 49, 0, /* msg */ 0, 4, 0xe9, 0x7c, 0x41, 0, 0, 0]);
    const texts = parseOverlayTexts(fr, 2);
    expect(Array.from(texts.verbNames)).toEqual([86, 0]);
    expect(texts.messages).toEqual(["é|A", ""]);
    expect(() => parseOverlayTexts(fr, 3)).toThrow(/tronqué/);
  });
});

describe.skipIf(!hasOriginalFiles)("overlay (fichiers originaux)", () => {
  it("analyse les 82 overlays sans octet restant (formats.md § 3.6)", () => {
    const names = overlayNames();
    expect(names).toHaveLength(82);
    const totals = { procs: 0, rels: 0, objects: 0, states: 0, strings: 0, exports: 0, imports: 0, links: 0 };
    for (const name of names) {
      const ovl = parseOverlay(volumes().readFile(`${name}.OVL`));
      expect(ovl.procs).toHaveLength(ovl.header.numProc);
      expect(ovl.rels).toHaveLength(ovl.header.numRel);
      expect(ovl.initData.length).toBe(ovl.header.initDataSize);
      totals.procs += ovl.procs.length;
      totals.rels += ovl.rels.length;
      totals.objects += ovl.objects.length;
      totals.states += ovl.states.length;
      totals.strings += ovl.messageIds.length;
      totals.exports += ovl.exports.length;
      totals.imports += ovl.imports.length;
      totals.links += ovl.msgRelHeaders.length;
    }
    expect(totals.states).toBeGreaterThan(0);
    expect({ ...totals, states: 0 }).toEqual({ procs: 860, rels: 1711, objects: 2583, states: 0, strings: 2725, exports: 6180, imports: 1132, links: 2670 });
  });

  it("lit l'overlay de démarrage AUTO00 et ses exports nommés", () => {
    const ovl = parseOverlay(volumes().readFile("AUTO00.OVL"));
    expect(ovl.header.numProc).toBeGreaterThan(0);
    expect(ovl.exports.every((e) => e.name.length > 0)).toBe(true);
    expect(ovl.procs.every((p) => p.data.length === p.sizeOfData)).toBe(true);
  });

  it("les tables d'import des scripts sont dans leur bloc et nomment des symboles OVL.SYMBOLE", () => {
    let checked = 0;
    for (const name of overlayNames()) {
      const ovl = parseOverlay(volumes().readFile(`${name}.OVL`));
      for (const block of [...ovl.procs, ...ovl.rels]) {
        const imports = scriptImports(block);
        expect(imports).toHaveLength(Math.max(0, block.numRelocGlob));
        for (const entry of imports) {
          expect(entry.offset, name).toBeLessThan(block.sizeOfData);
          const text = scriptImportName(block, entry);
          expect(text.length, name).toBeGreaterThan(0);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("les textes .FR coïncident avec l'en-tête de leur OVL (82 sur 82) ; XX2 donne la protection", () => {
    for (const name of overlayNames()) {
      const loaded = loadOverlayFiles(name, (file) => volumes().readFile(file));
      const { header } = loaded.data;
      if (header.numStrings > 0 || header.specialString1Length > 0) {
        expect(loaded.texts, name).not.toBeNull();
        expect(loaded.texts!.verbNames.length, name).toBe(header.specialString1Length);
        expect(loaded.texts!.objectNames.length, name).toBe(header.specialString2Length);
        expect(loaded.texts!.messages, name).toHaveLength(header.numStrings);
      } else expect(loaded.texts, name).toBeNull();
    }
    const xx2 = loadOverlayFiles("XX2", (file) => volumes().readFile(file));
    expect(xx2.data.header.numStrings).toBeGreaterThan(0);
    expect(xx2.texts!.messages.some((m) => m.includes("combinaison"))).toBe(true);
    // Latin-1 : é = 0xE9, pas d'UTF-8.
    expect(xx2.texts!.messages.join("").includes("�")).toBe(false);
  });
});
