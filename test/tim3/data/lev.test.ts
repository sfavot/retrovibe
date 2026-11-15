import { describe, expect, it } from "vitest";
import {
  activeConditions,
  binParts,
  emptyPart,
  type Level,
  type LevPart,
  levelParts,
  partRecordSize,
  readLev,
  writeLev,
} from "../../../src/games/tim3/data/lev";
import { ResourceIndex } from "../../../src/games/tim3/data/volume";
import { originalFiles } from "../../support/original";

const original = originalFiles("tim3", "RESOURCE.MAP");

function part(type: number, fields: Partial<Record<string, number>> = {}): LevPart {
  return { ...emptyPart(type), ...fields } as LevPart;
}

function minimal(version: number, types: number[] = []): Level {
  return {
    version,
    prefix: version >= 0x113 ? { unknown04: 0, backgroundColor: 3 } : undefined,
    title: "Élan",
    goal: "But",
    hintCount: 1,
    hints: Array.from({ length: 8 }, (_, i) =>
      version >= 0x112 ? { x: i, y: 10 - i, flip: i & 3, text: i === 0 ? "Indice" : "" } : { x: i, y: 10 - i, text: "" },
    ),
    info: { pressure: 67, gravity: 272, unknown04: 0, unknown06: 0, music: 1000, unknown0E: 0 },
    fixedParts: types.map((t) => part(t, { flags1: 0x6000, y: -5 })),
    movingParts: [],
    solution: {
      unknown00: 1,
      conditions: Array.from({ length: 8 }, (_, i) => ({
        partIndex: i === 0 ? 0 : -1,
        state1: 0,
        state2: 0,
        count: 0,
        rectX: 0,
        rectY: 0,
        rectWidth: 0,
        rectHeight: 0,
      })),
      delay: 0,
    },
  };
}

describe("LEV", () => {
  it("donne la taille d'enregistrement de chaque forme de pièce", () => {
    expect([0, 7, 8, 10, 76, 87, 148].map(partRecordSize)).toEqual([48, 56, 52, 54, 54, 60, 48]);
  });

  it("relit et réécrit un puzzle synthétique de chaque version", () => {
    for (const version of [0x111, 0x112, 0x113, 0x114]) {
      const level = minimal(version, [0, 7, 8, 10, 87]);
      const bytes = writeLev(level);
      const back = readLev(bytes);
      expect(back).toEqual(level);
      expect(writeLev(back)).toEqual(bytes);
      expect(back.fixedParts.map((p) => p.kind)).toEqual(["default", "pulley", "belt", "rope", "programmableBall"]);
    }
  });

  it("nomme les champs propres aux pièces et en déduit le bac", () => {
    const level = minimal(0x113);
    level.fixedParts = [part(0, { flags3: 0x40, x: -8, y: 312 }), part(10, { ropePart1: 0, ropePart2: 2, segmentLength: 46 })];
    level.movingParts = [part(87, { flags1: 0x1000, density: 2832, mass: 200, gravityBuoyancy: -3 })];
    const back = readLev(writeLev(level));
    const [ball] = back.movingParts;
    expect(ball?.kind === "programmableBall" && [ball.density, ball.mass, ball.gravityBuoyancy]).toEqual([2832, 200, -3]);
    const rope = back.fixedParts[1];
    expect(rope?.kind === "rope" && [rope.ropePart1, rope.ropePart2, rope.segmentLength]).toEqual([0, 2, 46]);
    expect(back.fixedParts[0]).toMatchObject({ x: -8, y: 312 });
    expect(binParts(back).map((p) => p.type)).toEqual([10, 87]);
    expect(levelParts(back).length).toBe(3);
    expect(activeConditions(back)).toHaveLength(1);
  });

  it("refuse un magic, une version ou une longueur inattendus", () => {
    const bytes = writeLev(minimal(0x113));
    expect(() => readLev(new Uint8Array(8))).toThrow(/magic/);
    const v = bytes.slice();
    v[2] = 0x20;
    expect(() => readLev(v)).toThrow(/version/);
    expect(() => readLev(Uint8Array.from([...bytes, 0]))).toThrow(/mal lu/);
    const wrongKind = minimal(0x113, [7]);
    wrongKind.fixedParts[0] = { ...wrongKind.fixedParts[0]!, type: 0 } as LevPart;
    expect(() => writeLev(wrongKind)).toThrow(/décrite comme/);
  });

  it.skipIf(!original.has)("relit et réécrit à l'octet près les 206 puzzles du jeu", () => {
    const index = new ResourceIndex().add(original.read("RESOURCE.MAP"), (n) => original.read(n));
    const names = index.names().filter((n) => n.toUpperCase().endsWith(".LEV"));
    expect(names).toHaveLength(206);
    const versions = new Map<number, number>();
    let conditions = 0;
    for (const name of names) {
      const bytes = index.get(name);
      const level = readLev(bytes);
      expect(writeLev(level), name).toEqual(new Uint8Array(bytes));
      versions.set(level.version, (versions.get(level.version) ?? 0) + 1);
      for (const p of level.fixedParts) expect(p.flags1 & 0x7000, name).toBe(0x6000);
      for (const p of level.movingParts) expect(p.flags1 & 0x7000, name).toBe(0x1000);
      const active = activeConditions(level);
      expect(active.length, name).toBeGreaterThan(0);
      for (const c of active) expect(c.partIndex, name).toBeLessThan(levelParts(level).length);
      conditions += active.length;
    }
    expect(Object.fromEntries(versions)).toEqual({ 0x111: 3, 0x112: 3, 0x113: 193, 0x114: 7 });
    expect(conditions).toBe(389);
    // Aucun LEV dans le pack français.
    const fr = new ResourceIndex().overlay(original.read("FRENCH.DAT"), "FRENCH.DAT");
    expect(fr.names().filter((n) => n.toUpperCase().endsWith(".LEV"))).toEqual([]);
  });
});
