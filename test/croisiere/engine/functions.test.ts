import { describe, expect, it } from "vitest";
import { scummvmRandom } from "../../../src/engine/rng";
import { NATIVE_NAMES } from "../../../src/games/croisiere/data/disasm";
import { EMPTY_NATIVES, NATIVES } from "../../../src/games/croisiere/engine/functions/index";
import { corDroite } from "../../../src/games/croisiere/engine/perso";
import { NotImplemented } from "../../../src/games/croisiere/engine/functions/not-implemented";
import { bssWord, code, makeEngine } from "./helpers";
import { asm } from "./ovl-builder";


describe("table des fonctions natives", () => {
  it("couvre les 121 numéros de ScummVM avec leurs noms, les 5 vides en moins", () => {
    for (let n = 0; n < NATIVE_NAMES.length; n++) {
      if (EMPTY_NATIVES.includes(n)) expect(NATIVES[n]).toBeUndefined();
      else expect(NATIVES[n]?.name).toBe(NATIVE_NAMES[n]);
    }
    expect(NATIVES.filter(Boolean)).toHaveLength(121);
  });

  it("aucune fonction ne lève NotImplemented", () => {
    const { e } = makeEngine({ AUTO00: { procs: [{ code: asm.stop() }] } });
    const todo: string[] = [];
    for (const native of NATIVES) {
      if (!native) continue;
      try {
        e.vm.resetStack();
        native.impl(e);
      } catch (err) {
        if (err instanceof NotImplemented) todo.push(native.name);
      }
    }
    expect(todo).toEqual([]);
  });
});

describe("fonctions du cœur", () => {
  it("Random(n) : 0 si n < 2, sinon getRandomNumber(n - 1) de ScummVM", () => {
    const { engine, e } = makeEngine({
      AUTO00: { bss: 6, procs: [{ code: code(asm.push(1), asm.call(0x3c), asm.store(5, 0), asm.push(12), asm.call(0x3c), asm.store(5, 2), asm.push(18), asm.call(0x3c), asm.store(5, 4), asm.stop()) }] },
    });
    engine.runFrame();
    const rnd = scummvmRandom(1);
    expect([bssWord(e, 1, 0), bssWord(e, 1, 2), bssWord(e, 1, 4)]).toEqual([0, rnd.number(11), rnd.number(17)]);
  });

  it("Itoa avec et sans largeur", () => {
    const { engine, e } = makeEngine({
      AUTO00: {
        bss: 16,
        procs: [{ code: code(asm.addr(5, 0), asm.push(-42), asm.push(0), asm.call(0x6f), [0x10], asm.addr(5, 8), asm.push(7), asm.push(3), asm.push(1), asm.call(0x6f), [0x10], asm.stop()) }],
      },
    });
    engine.runFrame();
    const bss = e.overlays.entries[1]!.data!.bss;
    expect(String.fromCharCode(...bss.subarray(0, 4))).toBe("-42\0");
    expect(String.fromCharCode(...bss.subarray(8, 12))).toBe("  7\0");
  });

  it("cor_droite (ComputeLine) : Bresenham de ScummVM, premier point compris", () => {
    expect(corDroite(0, 0, 3, 1)).toEqual([[0, 0], [1, 0], [2, 1]]);
    expect(corDroite(5, 5, 5, 8)).toEqual([[5, 5], [5, 6], [5, 7]]);
  });
});
