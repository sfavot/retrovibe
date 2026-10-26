import { describe, expect, it } from "vitest";
import { emptyInput, input } from "../../../src/games/swiv3d/engine/input";
import { World } from "../../../src/games/swiv3d/engine/world";
import { hasOriginalFiles, loadLevel } from "./helpers";

function fresh(name = "TERRAN00", opts = {}): World {
  const { level, models } = loadLevel(name);
  return World.load(level, models, opts);
}

describe.skipIf(!hasOriginalFiles)("joueur (hélicoptère, forme 0)", () => {
  it("atteint la vitesse d'équilibre de player.md (≈ 4 320 Q8/tick) en poussée avant continue", () => {
    const w = fresh();
    for (let i = 0; i < 160; i++) w.tick(input({ forward: true }));
    // sol non plat : moyenne sur 40 ticks de vitesse horizontale
    let sum = 0;
    for (let i = 0; i < 40; i++) {
      w.tick(input({ forward: true }));
      sum += w.player.speed;
    }
    expect(sum / 40).toBeGreaterThan(4320 * 0.95);
    expect(sum / 40).toBeLessThan(4320 * 1.05);
    expect(w.player.pitch).toBeLessThan(-30); // ≈ −26° : le nez est piqué
    expect(w.player.pitch).toBeGreaterThan(-40);
  });

  it("monte en vitesse progressivement (l'attitude s'installe en une vingtaine de ticks)", () => {
    const w = fresh();
    const speeds: number[] = [];
    for (let i = 0; i < 60; i++) {
      w.tick(input({ forward: true }));
      speeds.push(w.player.speed);
    }
    expect(speeds[15]!).toBeGreaterThan(0.3 * 4320);
    expect(speeds[15]!).toBeLessThan(0.6 * 4320);
    expect(speeds[59]!).toBeGreaterThan(0.9 * 4320);
  });

  it("atteint la vitesse latérale d'équilibre (≈ 2 700 Q8/tick)", () => {
    const w = fresh();
    for (let i = 0; i < 200; i++) w.tick(input({ strafeRight: true }));
    expect(w.player.speed).toBeGreaterThan(2700 * 0.93);
    expect(w.player.speed).toBeLessThan(2700 * 1.07);
    expect(w.player.roll).toBeGreaterThan(35);
  });

  it("recule moins vite qu'il n'avance quand on tire en arrière : même vitesse, sens opposé", () => {
    const w = fresh("TERRAN01");
    const yaw = w.player.yaw;
    for (let i = 0; i < 120; i++) w.tick(input({ back: true }));
    // direction de déplacement opposée au cap
    const dot =
      w.player.vx * Math.sin((2 * Math.PI * yaw) / 512) +
      w.player.vz * Math.cos((2 * Math.PI * yaw) / 512);
    expect(dot).toBeLessThan(0);
  });

  it("vire de 600/256 pas par tick au clavier (66°/s)", () => {
    const w = fresh();
    const yaw0 = w.player.obj.yaw;
    for (let i = 0; i < 40; i++) w.tick(input({ turnRight: true }));
    expect(w.player.obj.yaw - yaw0).toBe((40 * 600) >> 8);
    for (let i = 0; i < 40; i++) w.tick(input({ turnLeft: true }));
    expect(w.player.obj.yaw - yaw0).toBe(0);
  });

  it("utilise l'axe analogique : cap = axe · 8 / 256 par tick", () => {
    const w = fresh();
    const yaw0 = w.player.obj.yaw;
    for (let i = 0; i < 32; i++) w.tick(input({ axes: { turn: 128 } }));
    expect(w.player.obj.yaw - yaw0).toBe((32 * (128 << 3)) >> 8);
  });

  it("« Strafe On » transforme tourner en déplacement latéral sans changer le cap", () => {
    const w = fresh();
    const yaw0 = w.player.obj.yaw;
    for (let i = 0; i < 100; i++)
      w.tick(input({ turnRight: true, brake: true }));
    expect(w.player.obj.yaw).toBe(yaw0);
    expect(w.player.speed).toBeGreaterThan(2000);
  });

  it("garde l'altitude de consigne de 80 unités au-dessus du relief en vol stationnaire", () => {
    for (const n of ["TERRAN00", "TERRAN01", "TERRAN02", "TERRAN03"]) {
      const w = fresh(n);
      for (let i = 0; i < 200; i++) w.tick(emptyInput());
      expect(
        (w.player.y - w.terrain.height(w.player.x, w.player.z)) / 256,
      ).toBeCloseTo(80, 0);
      expect(w.player.hp).toBe(496);
    }
  });

  it("ne s'enfonce jamais de plus de 20 unités dans le relief en vol (les chocs coûtent 10 pv chacun)", () => {
    for (const n of ["TERRAN00", "TERRAN01", "TERRAN02", "TERRAN03"]) {
      const w = fresh(n);
      for (let t = 0; t < 800; t++) {
        w.tick(input({ forward: true, turnRight: t % 300 > 200 }));
        // le choc est détecté après le déplacement : sur une paroi, l'appareil peut entrer un instant de quelques unités dans le relief
        expect(
          w.player.y - w.terrain.height(w.player.x, w.player.z),
        ).toBeGreaterThan(-20 * 256);
      }
      expect(w.player.hp).toBeGreaterThan(0);
      expect(w.player.hp % 10).toBe(6); // 496 - 10 · chocs
    }
  });

  it("subit un choc au sol : −10 pv, rebond vers l'aval (vy = 1000, vitesse 16 u/tick), son 1001", () => {
    const w = fresh();
    const o = w.player.obj;
    o.y = w.terrain.height(o.x, o.z) + 500; // sous le seuil de 2 000
    o.vx = o.vz = o.vy = 0;
    w.tick(emptyInput());
    expect(w.player.hp).toBe(486);
    expect(o.vy).toBeLessThan(1001);
    const events = w.drainEvents();
    expect(events).toContainEqual({
      kind: "playerDamaged",
      amount: 10,
      source: "ground",
    });
    expect(events.some((e) => e.kind === "sound" && e.id === 0x3e9)).toBe(true);
    // le plancher à 0
    o.hp = 5;
    o.y = w.terrain.height(o.x, o.z);
    w.tick(emptyInput());
    expect(w.player.hp).toBe(0);
    w.tick(emptyInput());
    expect(w.drainEvents().filter((e) => e.kind === "playerDied")).toHaveLength(
      1,
    );
    expect(w.player.dead).toBe(true);
  });

  it("émet les événements d'armes et de tirs", () => {
    const w = fresh();
    w.tick(
      input({
        weaponDirect: 3,
        weaponNext: true,
        weaponPrev: true,
        fireSpecial: true,
        firePrimary: true,
      }),
    );
    expect(w.drainEvents()).toEqual([
      { kind: "weaponSelect", command: 2 },
      { kind: "weaponSelect", command: -1 },
      { kind: "weaponSelect", command: -2 },
      { kind: "fire", special: true },
      { kind: "fire", special: false },
    ]);
    expect(w.player.firePrimaryHeld).toBe(true);
  });
});

describe.skipIf(!hasOriginalFiles)("joueur (véhicule, forme 1)", () => {
  it("retombe sur le sol (gravité 150) et s'y pose avec ses 4 contacts", () => {
    const w = fresh();
    w.setPlayerForm(1);
    expect(w.player.obj.classe).toBe(0x207);
    expect(w.player.obj.model).toBe(991);
    for (let i = 0; i < 300; i++) w.tick(emptyInput());
    const foot =
      (loadLevel("TERRAN00").models.get(991)?.groundOffset ?? 0) * 256;
    const clearance =
      w.player.y + foot - w.terrain.height(w.player.x, w.player.z);
    expect(Math.abs(clearance)).toBeLessThan(2500);
    expect(Math.abs(w.player.vy)).toBeLessThan(300);
  });

  it("accélère vers ≈ 3 400-4 000 Q8/tick sur sol plat et vire de 4 pas par tick", () => {
    const w = fresh("TERRAN03");
    w.setPlayerForm(1);
    const yaw0 = w.player.obj.yaw;
    for (let i = 0; i < 20; i++) w.tick(input({ turnRight: true }));
    expect(w.player.obj.yaw - yaw0).toBe(80);
    let best = 0;
    for (let i = 0; i < 200; i++) {
      w.tick(input({ forward: true }));
      best = Math.max(best, w.player.speed);
    }
    expect(best).toBeGreaterThan(2500);
    expect(best).toBeLessThan(4500);
  });

  it("freine : le frein réduit la vitesse plus vite que le frottement seul", () => {
    const run = (brake: boolean) => {
      const w = fresh("TERRAN03");
      w.setPlayerForm(1);
      for (let i = 0; i < 150; i++) w.tick(input({ forward: true }));
      for (let i = 0; i < 20; i++) w.tick(input({ brake }));
      return w.player.speed;
    };
    expect(run(true)).toBeLessThan(run(false));
  });

  it("revient à l'hélicoptère avec la forme 0", () => {
    const w = fresh();
    w.setPlayerForm(1);
    w.setPlayerForm(0);
    expect(w.player.obj.classe).toBe(0x217);
    expect(w.drainEvents().map((e) => e.kind)).toEqual([
      "formChanged",
      "formChanged",
    ]);
  });
});
