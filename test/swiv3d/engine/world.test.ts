import { describe, expect, it } from "vitest";
import {
  emptyInput,
  input,
  type PlayerInput,
} from "../../../src/games/swiv3d/engine/input";
import { World, simulate } from "../../../src/games/swiv3d/engine/world";
import { WORLD_SIZE } from "../../../src/games/swiv3d/data/level";
import { hasOriginalFiles, loadLevel } from "./helpers";

const NAMES = ["TERRAN00", "TERRAN01", "TERRAN02", "TERRAN03", "DEMO"] as const;

function histogram(types: number[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const t of types) out[t] = (out[t] ?? 0) + 1;
  return out;
}

describe.skipIf(!hasOriginalFiles)("monde (fichiers du jeu)", () => {
  it("charge TERRAN00 avec les comptes d'objets de slv.md (un corps par enregistrement)", () => {
    const { level, models } = loadLevel("TERRAN00");
    const w = World.load(level, models);
    expect(w.levelObjects).toHaveLength(580); // 581 enregistrements, moins le départ du joueur
    expect(histogram(w.levelObjects.map((o) => o.type))).toEqual({
      2000: 114,
      2002: 165,
      2003: 225,
      3000: 18,
      4001: 5,
      5000: 5,
      7000: 48,
    });
    // tourelles (18 + 5) et bonus de 7000 (48) en plus des corps, plus le joueur
    expect(w.pool.liveCount).toBe(580 + 1 + 18 + 5 + 48);
  });

  it("charge les cinq niveaux et pose chaque objet sur le terrain (mode 2)", () => {
    for (const n of NAMES) {
      const { level, models } = loadLevel(n);
      const w = World.load(level, models);
      expect(w.levelObjects).toHaveLength(level.objects.length - 1);
      for (const o of w.levelObjects.slice(0, 80)) {
        const foot = (models.get(o.model)?.groundOffset ?? 0) * 256;
        expect(o.y).toBe(w.terrain.height(o.x, o.z) - foot);
        expect(o.x).toBeGreaterThanOrEqual(0);
        expect(o.x).toBeLessThan(WORLD_SIZE * 256); // replié dans le tore, même pour TERRAN03
      }
      expect(w.pool.liveCount).toBeLessThan(3000);
    }
  });

  it("place le joueur sur l'enregistrement de type 1000, 80 unités au-dessus du sol", () => {
    const expected: Record<string, [number, number, number]> = {
      TERRAN00: [12159, 29373, 248],
      TERRAN01: [30804, 20028, 424],
      TERRAN02: [3963, 10467, 72],
      TERRAN03: [11121, 16469, 208],
    };
    for (const [n, [x, z, yaw]] of Object.entries(expected)) {
      const { level, models } = loadLevel(n);
      const w = World.load(level, models);
      const p = w.player;
      expect(p.x).toBe(x * 256);
      expect(p.z).toBe(z * 256);
      expect(p.yaw).toBe(yaw);
      expect(p.y).toBe(w.terrain.height(p.x, p.z) + 80 * 256);
      expect(p.form).toBe(0);
      expect(p.obj.classe).toBe(0x217);
      expect(p.hp).toBe(496);
    }
  });

  it("démarre la démo en forme 0x2a (type 1001), sans pilotage", () => {
    const { level, models } = loadLevel("DEMO");
    const w = World.load(level, models);
    expect(w.player.form).toBe(0x2a);
    const x = w.player.x;
    for (let i = 0; i < 20; i++) w.tick(input({ forward: true }));
    expect(w.player.x).toBe(x);
  });

  it("est déterministe : mêmes entrées, même empreinte ; entrées différentes, empreintes différentes", () => {
    const { level, models } = loadLevel("TERRAN00");
    const script = (seed: number) => {
      let s = seed;
      return (_t: number): PlayerInput => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return input({
          forward: (s & 1) !== 0,
          turnLeft: (s & 6) === 2,
          turnRight: (s & 6) === 4,
          strafeLeft: (s & 24) === 8,
          brake: (s & 32) !== 0,
          firePrimary: (s & 64) !== 0,
        });
      };
    };
    const a = simulate(level, models, script(7), 600);
    const b = simulate(level, models, script(7), 600);
    const c = simulate(level, models, script(8), 600);
    expect(a.stateHash()).toBe(b.stateHash());
    expect(a.stateHash()).not.toBe(c.stateHash());
    expect(a.tickCount).toBe(600);
  });

  it("saute le tick en pause", () => {
    const { level, models } = loadLevel("TERRAN00");
    const w = World.load(level, models);
    const h = w.stateHash();
    w.tick(input({ pause: true, forward: true }));
    expect(w.tickCount).toBe(0);
    expect(w.stateHash()).toBe(h);
  });

  it("replie le joueur dans le tore", () => {
    const { level, models } = loadLevel("TERRAN00");
    const w = World.load(level, models);
    const o = w.player.obj;
    w.grid.remove(o);
    o.x = (1 << 23) - 2000;
    w.grid.insert(o);
    o.yaw = 128; // cap +x
    o.vx = 3000;
    w.player.accYaw = 128 << 8;
    for (let i = 0; i < 5; i++) w.tick(emptyInput());
    expect(o.x).toBeLessThan(1 << 20);
    expect(o.x).toBeGreaterThanOrEqual(0);
  });

  it("détruit une cible statique touchée (collision de cellule, mort, score 73) et libère son emplacement", () => {
    const { level, models } = loadLevel("TERRAN00");
    const w = World.load(level, models);
    const p = w.player.obj;
    // cible de type 2002 la plus proche du joueur
    const target = w.levelObjects
      .filter((o) => o.type === 2002)
      .sort(
        (a, b) =>
          Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z),
      )[0]!;
    expect(Math.hypot(target.x - p.x, target.z - p.z) / 256).toBeLessThan(1500);
    expect(target.hp).toBe(10);
    const bullet = w.spawn({
      classe: 0x3b,
      hp: 35,
      x: target.x,
      y: target.y,
      z: target.z,
      update: "inert",
    })!;
    const slot = target.slot;
    w.tick(emptyInput());
    expect(target.hp).toBe(0);
    expect(bullet.hp).toBe(25);
    w.tick(emptyInput());
    expect(w.pool.objects[slot]!.classe).toBe(0);
    const destroyed = w
      .drainEvents()
      .filter((e) => e.kind === "objectDestroyed");
    expect(destroyed).toHaveLength(1);
    expect(destroyed[0]).toMatchObject({ type: 2002, score: 73 });
  });

  it("gèle les cibles intactes et ne simule pas celles hors de la zone active", () => {
    const { level, models } = loadLevel("TERRAN00");
    const w = World.load(level, models);
    w.tick(emptyInput());
    w.tick(emptyInput());
    const statics = w.levelObjects.filter((o) => o.type === 2003);
    const aged = statics.filter((o) => o.age > 0);
    const idle = statics.filter((o) => o.age === 0);
    expect(aged.length).toBeGreaterThan(0);
    expect(idle.length).toBeGreaterThan(0); // le monde fait 512×512 cellules, la fenêtre 11×11 cellules de hachage
    for (const o of aged) expect(o.flags & 0x20).toBe(0x20);
  });

  it("laisse H1 brancher un comportement", () => {
    const { level, models } = loadLevel("TERRAN00");
    const w = World.load(level, models);
    const calls: number[] = [];
    w.registerBehavior("probe", (_w, o) => calls.push(o.slot));
    w.spawn({
      classe: 1,
      hp: 1,
      x: w.player.x,
      y: w.player.y,
      z: w.player.z,
      update: "probe",
    });
    w.tick(emptyInput());
    expect(calls).toHaveLength(1);
  });
});
