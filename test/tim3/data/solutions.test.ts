import { describe, expect, it } from "vitest";
import { readLev } from "../../../src/games/tim3/data/lev";
import { goalConditions, readBinSolveRes, readSolveRes } from "../../../src/games/tim3/data/solutions";
import { ResourceIndex } from "../../../src/games/tim3/data/volume";
import { originalFiles } from "../../support/original";

const original = originalFiles("tim3", "RESOURCE.MAP");
const text = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

describe("solutions", () => {
  it("lit les états de SOLVE.RES", () => {
    const parts = readSolveRes(
      text("!Part0\r\nBall\r\n@1,-1&1%\r\n!Part1\r\nWall\r\n!Part 2\r\nBomb\r\n2,3\r\nIdle\r\n3,-1E&3% \r\nBoom\r\n\r\n\x1a"),
    );
    expect(parts).toEqual([
      { type: 0, name: "Ball", position: [{ from: 1, to: -1, explodes: false, frame: 1, suffix: "%" }], states: [] },
      { type: 1, name: "Wall", states: [] },
      {
        type: 2,
        name: "Bomb",
        states: [
          { label: "Idle", ranges: [{ from: 2, to: 3, explodes: false, suffix: "" }] },
          { label: "Boom", ranges: [{ from: 3, to: -1, explodes: true, frame: 3, suffix: "%" }] },
        ],
      },
    ]);
  });

  it("refuse un numéro de pièce décalé ou une plage illisible", () => {
    expect(() => readSolveRes(text("!Part3\r\nX\r\n"))).toThrow(/rang 0/);
    expect(() => readSolveRes(text("!Part0\r\nX\r\n1;2\r\nY\r\n"))).toThrow(/illisible/);
  });

  it.skipIf(!original.has)("lit SOLVE.RES et BINSOLVE.RES (anglais et français) et les conditions des 206 puzzles", () => {
    const index = new ResourceIndex().add(original.read("RESOURCE.MAP"), (n) => original.read(n));
    const en = readSolveRes(index.get("SOLVE.RES"));
    expect(en).toHaveLength(149);
    expect(en[35]?.name).toBe("Boxing Glove");
    expect(en[4]?.states.map((s) => s.label)).toEqual(["Not Popped", "Popped"]);
    expect(en.filter((p) => p.position).length).toBe(12);
    expect(readBinSolveRes(index.get("BINSOLVE.RES"))).toHaveLength(6);

    let goals = 0;
    let levels = 0;
    for (const name of index.names().filter((n) => n.toUpperCase().endsWith(".LEV"))) {
      const conditions = goalConditions(readLev(index.get(name)));
      expect(conditions.length, name).toBeGreaterThan(0);
      goals += conditions.length;
      levels++;
    }
    expect([levels, goals]).toEqual([206, 389]);

    index.overlay(original.read("FRENCH.DAT"), "FRENCH.DAT");
    const fr = readSolveRes(index.get("SOLVE.RES"));
    expect(fr.map((p) => p.states.length)).toEqual(en.map((p) => p.states.length));
    expect(fr[4]?.states.map((s) => s.label)).toEqual(["Intact", "Éclaté"]);
    expect(readBinSolveRes(index.get("BINSOLVE.RES"))).toHaveLength(6);
  });
});
