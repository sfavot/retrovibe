import { describe, expect, it } from "vitest";
import { snapshot, traceWorld } from "../../../src/games/tim3/engine/trace";
import { step } from "../../../src/games/tim3/engine/step";
import { levelNames, original, realWorld } from "./helpers";

describe.skipIf(!original.has)("TIM3 : monde chargé depuis les LEV", () => {
  it("charge les 206 niveaux et fait 100 pas sans erreur", () => {
    const stubs = new Map<string, number>();
    for (const name of levelNames()) {
      const w = realWorld(name);
      expect(w.statics.toArray().length + w.mobiles.toArray().length, name).toBeGreaterThan(0);
      for (let i = 0; i < 100; i++) step(w);
      for (const [k, v] of w.log.stubs) stubs.set(k, (stubs.get(k) ?? 0) + v);
      for (const list of [w.statics, w.mobiles])
        for (const p of list) for (const v of [p.fx, p.fy, p.vx, p.vy]) expect(Number.isInteger(v), name).toBe(true);
    }
    // Les handlers non portés (vague Φ2) sont journalisés, jamais muets.
    expect(stubs.size).toBeGreaterThan(0);
  });

  it("remet la machine dans son état de départ quand on la redémarre", () => {
    const w = realWorld("TLEV1");
    const start = snapshot(w, 0);
    for (let i = 0; i < 80; i++) step(w);
    expect(snapshot(w, 0)).not.toEqual(start);
    w.start();
    // 43ada7 n'efface que les 4 bits bas de +0x0C : « déplacée » (0x40) reste, et sera effacée au premier pas.
    const masked = (rows: ReturnType<typeof snapshot>) => rows.map((r) => ({ ...r, flags0C: r.flags0C & ~0x48 }));
    expect(masked(snapshot(w, 0))).toEqual(masked(start));
  });

  it("est déterministe", () => {
    for (const name of ["TLEV1", "TLEV2", "MLEV4"]) expect(traceWorld(realWorld(name), name, 300)).toBe(traceWorld(realWorld(name), name, 300));
  });
});
