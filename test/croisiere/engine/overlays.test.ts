import { describe, expect, it } from "vitest";
import { ObjClass } from "../../../src/games/croisiere/engine/ids";
import { OverlayTable } from "../../../src/games/croisiere/engine/overlays";
import { bssWord, code, makeEngine } from "./helpers";
import { asm, buildOverlay, memoryFiles } from "./ovl-builder";

const objects = [{ cls: ObjClass.MULTIPLE }, { cls: ObjClass.VARIABLE }, { cls: ObjClass.THEME, stateTableIdx: 1 }];

describe("table des overlays", () => {
  it("index stables et croissants, tranche de globalVars au premier chargement seulement", () => {
    const files = memoryFiles({
      "A.OVL": buildOverlay({ objects, states: [[0, 0, 0, 0, 0, 0]] }),
      "B.OVL": buildOverlay({ objects, states: [[0, 0, 0, 0, 0, 0]] }),
      "C.OVL": buildOverlay({}),
    });
    const t = new OverlayTable(files);
    expect([t.load("A"), t.load("B")]).toEqual([1, 2]);
    expect([t.entries[1]!.state, t.entries[2]!.state, t.stateID]).toEqual([0, 2, 4]);
    expect(t.load("A")).toBe(1);
    expect(t.free(1)).toBe(0);
    expect(t.findLoaded("A")).toBe(0);
    expect(t.load("C")).toBe(3);
    expect(t.load("A")).toBe(1);
    expect([t.entries[1]!.state, t.stateID]).toEqual([0, 4]);
    expect(t.load("ABSENT")).toBe(-18);
    expect(t.entries[4]!.alreadyLoaded).toBe(true);
  });
});

describe("éditeur de liens", () => {
  it("réécrit en place un import de variable, de double empilement et de sous-fonction à chaque LoadOverlay", () => {
    const name = [..."LIB\0"].map((c) => c.charCodeAt(0));
    const loadImported = [0x09, 0, 0, 0, 0];
    const prog = code(asm.addr(2, 0), asm.call(0x0c), [0x10], loadImported, asm.push(5), asm.math(0), asm.store(5, 0), asm.push(0), asm.push(0), asm.stop());
    const varAt = prog.indexOf(0x09, 8) + 1;
    const pushAt = prog.length - 4;
    const { engine, e } = makeEngine({
      AUTO00: {
        bss: 2,
        procs: [
          {
            code: prog,
            strings: name,
            imports: [
              { type: 1, offset: varAt, name: "LIB.COUNTER" },
              { type: 20, offset: pushAt - 3, name: "lib.main" },
            ],
          },
        ],
      },
      LIB: {
        bss: 8,
        exports: [
          { name: "COUNTER", type: 1, idx: 6 },
          { name: "MAIN", type: 20, idx: 0 },
        ],
        procs: [{ code: asm.stop() }],
      },
    });
    engine.runFrame();
    const block = e.overlays.entries[1]!.data!.procs[0]!.data;
    expect([...block.subarray(varAt, varAt + 4)]).toEqual([0x0d, 2, 0, 6]);
    expect([...block.subarray(pushAt - 3, pushAt + 3)]).toEqual([0x08, 0, 2, 0x08, 0, 0]);
    expect(bssWord(e, 1, 0)).toBe(5);
  });
});
