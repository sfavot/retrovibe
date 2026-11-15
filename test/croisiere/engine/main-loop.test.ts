import { describe, expect, it } from "vitest";
import { CREDITS_PATCH } from "../../../src/games/croisiere/engine/vm";
import { globalVarsHash } from "../../../src/games/croisiere/engine/trace";
import { bssWord, code, makeEngine } from "./helpers";
import { asm } from "./ovl-builder";

const str = (s: string) => [...`${s}\0`].map((c) => c.charCodeAt(0));
/** Boucle : lit un mot, l'incrémente, rend la main, recommence. */
const counter = (offset: number) => code(asm.load(5, offset), asm.push(1), asm.math(0), asm.store(5, offset), asm.yield(), asm.jump(7, -16));

describe("boucle principale", () => {
  it("cadence : un tour toutes les 50 ms, puis 100 ms dès que le menu joueur est autorisé", () => {
    const { engine, e } = makeEngine({ AUTO00: { procs: [{ code: code(asm.push(1), asm.call(0x79), [0x10], asm.stop()) }] } });
    const stepsUntilFrame = () => {
      let n = 1;
      while (!engine.step()) n++;
      return n;
    };
    expect(stepsUntilFrame()).toBe(5);
    expect(e.playerMenuEnabled).toBe(1);
    expect(e.gameSpeed).toBe(50);
    expect(stepsUntilFrame()).toBe(5);
    expect(e.gameSpeed).toBe(100);
    expect(stepsUntilFrame()).toBe(10);
  });

  it("au plus un changement de bouton par tour : appui et relâchement dans le même tour sont vus sur deux tours", () => {
    const { engine, host, e } = makeEngine({
      AUTO00: { bss: 2, procs: [{ code: code(asm.call(0x59), asm.store(5, 0), asm.yield(), asm.jump(7, -9)) }] },
    });
    engine.runFrame();
    host.push({ type: "move", x: 5, y: 6 }, { type: "down", button: 1 }, { type: "up", button: 1 });
    engine.runFrame();
    expect(bssWord(e, 1, 0)).toBe(1);
    expect([e.currentMouseX, e.currentMouseY]).toEqual([5, 6]);
    engine.runFrame();
    expect(bssWord(e, 1, 0)).toBe(0);
  });

  it("userDelay efface le bouton au début du tour (rustine de ScummVM)", () => {
    const { engine, e } = makeEngine({
      AUTO00: { bss: 2, procs: [{ code: code(asm.push(2), asm.call(0x35), [0x10], asm.yield(), asm.call(0x59), asm.store(5, 0), asm.yield(), asm.jump(7, -9)) }] },
    });
    engine.runFrame();
    engine.applyInputLevel(0, 0, 1);
    engine.runFrame();
    expect(bssWord(e, 1, 0)).toBe(0);
    expect(e.userDelay).toBe(1);
  });

  it("deux passes de scripts de plus quand le fond devient S06B.PI1", () => {
    const pi1 = new Uint8Array(2 + 768 + 64000);
    pi1[1] = 8;
    const { engine, e } = makeEngine(
      {
        AUTO00: {
          bss: 2,
          procs: [
            { code: code(asm.push(0), asm.push(1), asm.push(0), asm.call(0x64), [0x10], asm.push(0), asm.push(2), asm.push(0), asm.call(0x06), [0x10], asm.stop()) },
            { code: counter(0) },
            { code: code(asm.push(0), asm.addr(2, 0), asm.call(0x03), [0x10], asm.stop()), strings: str("s06b.pi1") },
          ],
        },
      },
      { "S06B.PI1": pi1 },
    );
    engine.runFrame();
    expect(bssWord(e, 1, 0)).toBe(1);
    engine.runFrame();
    expect(e.display.backgroundNames[0]).toBe("S06B.PI1");
    expect(bssWord(e, 1, 0)).toBe(4);
    engine.runFrame();
    expect(bssWord(e, 1, 0)).toBe(5);
  });

  it("rustine des crédits : FIN01, offset 1884, un seul élément empilé -> 50", () => {
    const fin = (name: string) => ({
      bss: 2,
      procs: [{ code: code(new Array(CREDITS_PATCH.offset - 3).fill(0x58), asm.push(1000), asm.store(5, 0), asm.stop()) }],
      name,
    });
    const boot = (ovl: string) => ({
      procs: [{ code: code(asm.addr(2, 0), asm.call(0x0c), [0x10], asm.push(2), asm.push(0), asm.push(0), asm.call(0x64), [0x10], asm.stop()), strings: str(ovl) }],
    });
    for (const [name, expected] of [["FIN01", 50], ["FIN02", 1000]] as const) {
      const { engine, e } = makeEngine({ AUTO00: boot(name), [name]: fin(name) });
      engine.runFrame();
      expect(bssWord(e, 2, 0)).toBe(expected);
    }
  });

  it("hash des variables globales au format du banc (VH)", () => {
    expect(globalVarsHash(new Int16Array(2000))).toBe(2491714117);
  });
});
