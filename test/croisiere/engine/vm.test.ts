import { describe, expect, it } from "vitest";
import { Freeze } from "../../../src/games/croisiere/engine/ids";
import { bssWord, code, makeEngine } from "./helpers";
import { asm } from "./ovl-builder";

describe("VM : opcodes", () => {
  it("arithmétique : sommet = opérande gauche, int16, division tronquée", () => {
    const { engine, e } = makeEngine({
      AUTO00: {
        bss: 16,
        procs: [
          {
            code: code(
              asm.push(10), asm.push(3), asm.math(2), asm.store(5, 0), // 3 - 10
              asm.push(2), asm.push(-7), asm.math(1), asm.store(5, 2), // -7 / 2
              asm.push(30000), asm.push(30000), asm.math(0), asm.store(5, 4), // débordement int16
              asm.push(3), asm.push(-7), asm.math(4), asm.store(5, 6), // -7 % 3
              asm.push(12), asm.push(10), asm.math(6), asm.store(5, 8), // 10 & 12
              asm.stop(),
            ),
          },
        ],
      },
    });
    engine.runFrame();
    expect([0, 2, 4, 6, 8].map((o) => bssWord(e, 1, o))).toEqual([-7, -3, -5536, -1, 8]);
  });

  it("comparaisons `var2 OP var1` et sauts sur le registre de condition", () => {
    const head = code(asm.push(5), asm.push(3), asm.test(2), asm.store(5, 0), asm.push(3), asm.push(5), asm.test(2), asm.store(5, 2), asm.push(-4), asm.ccr());
    const skipped = code(asm.push(99), asm.store(5, 4));
    const jumpAt = head.length;
    const prog = code(head, asm.jump(4, 3 - 1 + skipped.length), skipped, asm.push(1), asm.store(5, 6), asm.stop());
    expect(prog[jumpAt]).toBe(0x34);
    const { engine, e } = makeEngine({ AUTO00: { bss: 8, procs: [{ code: prog }] } });
    engine.runFrame();
    expect([0, 2, 4, 6].map((o) => bssWord(e, 1, o))).toEqual([0, 1, 0, 1]);
  });

  it("accès indexé à un mot : l'index compte deux fois (offset + index, puis + index)", () => {
    const { engine, e } = makeEngine({
      AUTO00: {
        bss: 16,
        procs: [{ code: code(asm.push(2), asm.setIndex(), asm.push(77), asm.store(5, 4, 1, 0, true), asm.load(5, 4, 1, 0, true), asm.store(5, 0), asm.stop()) }],
      },
    });
    engine.runFrame();
    expect(bssWord(e, 1, 8)).toBe(77);
    expect(bssWord(e, 1, 0)).toBe(77);
  });

  it("lien non résolu : la tranche s'arrête (−10), IP déjà avancé, reprise au tour suivant", () => {
    const { engine, e } = makeEngine({
      AUTO00: { bss: 4, procs: [{ code: code(asm.push(1), asm.store(5, 0), [0x09, 0, 0, 0, 0], asm.push(2), asm.store(5, 2), asm.stop()) }] },
    });
    engine.runFrame();
    expect([bssWord(e, 1, 0), bssWord(e, 1, 2)]).toEqual([1, 0]);
    expect(e.vm.lastRet).toBe(-10);
    engine.runFrame();
    expect(bssWord(e, 1, 2)).toBe(2);
  });

  it("chaînes : Strcpy du segment de chaînes vers le BSS, puis Strcat", () => {
    const str = [..."AB\0CD\0"].map((c) => c.charCodeAt(0));
    const { engine, e } = makeEngine({
      AUTO00: {
        bss: 16,
        procs: [
          {
            code: code(asm.addr(5, 0), asm.addr(2, 0), asm.call(0x6d), [0x10], asm.addr(5, 0), asm.addr(2, 3), asm.call(0x6e), asm.stop()),
            strings: str,
          },
        ],
      },
    });
    engine.runFrame();
    const bss = e.overlays.entries[1]!.data!.bss;
    expect(String.fromCharCode(...bss.subarray(0, 5))).toBe("ABCD\0");
  });
});

describe("VM : ordonnancement", () => {
  it("Exec démarre dans la même passe, AddProc à la passe suivante ; arguments dans l'ordre de ScummVM", () => {
    // proc 1 et 2 recopient leurs deux arguments (BSS du processus) dans le BSS de l'overlay.
    const copy = (to: number) => ({ bss: 4, code: code(asm.load(1, 0), asm.store(5, to), asm.load(1, 2), asm.store(5, to + 2), asm.stop()) });
    const { engine, e } = makeEngine({
      AUTO00: {
        bss: 8,
        procs: [
          {
            code: code(
              asm.push(0), asm.push(1), asm.push(10), asm.push(20), asm.push(2), asm.call(0x06), [0x10],
              asm.push(0), asm.push(2), asm.push(10), asm.push(20), asm.push(2), asm.call(0x64), [0x10],
              asm.stop(),
            ),
          },
          copy(0),
          copy(4),
        ],
      },
    });
    engine.runFrame();
    expect([bssWord(e, 1, 0), bssWord(e, 1, 4), bssWord(e, 1, 6)]).toEqual([0, 10, 20]);
    expect(e.procs.map((p) => [p.scriptNumber, p.sysKey])).toEqual([[1, 1]]);
    engine.runFrame();
    expect([bssWord(e, 1, 0), bssWord(e, 1, 2)]).toEqual([20, 10]);
    expect(e.procs).toEqual([]);
  });

  it("UserWait gèle le script (9999) jusqu'au clic gauche, qui est ensuite effacé", () => {
    const { engine, e } = makeEngine({ AUTO00: { bss: 2, procs: [{ code: code(asm.call(0x15), [0x10], asm.yield(), asm.push(1), asm.store(5, 0), asm.stop()) }] } });
    engine.runFrame();
    expect(e.userWait).toBe(true);
    expect(e.procs[0]!.freeze).toBe(Freeze.userWait);
    engine.runFrame();
    expect(bssWord(e, 1, 0)).toBe(0);
    engine.applyInputLevel(10, 10, 1);
    engine.runFrame();
    expect(e.userWait).toBe(false);
    expect(bssWord(e, 1, 0)).toBe(1);
    expect(e.currentMouseButton).toBe(0);
  });

  it("FreezeOverlay saute les scripts de l'overlay", () => {
    const { engine, e } = makeEngine({
      AUTO00: { bss: 2, procs: [{ code: code(asm.load(5, 0), asm.push(1), asm.math(0), asm.store(5, 0), asm.yield(), asm.jump(7, -16)) }] },
    });
    engine.runFrame();
    engine.runFrame();
    expect(bssWord(e, 1, 0)).toBe(2);
    e.overlays.entries[1]!.executeScripts = 1;
    engine.runFrame();
    expect(bssWord(e, 1, 0)).toBe(2);
  });
});
