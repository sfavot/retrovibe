import { describe, expect, it } from "vitest";
import { Camera } from "../../../src/games/swiv3d/engine/camera";
import { COS, SIN } from "../../../src/games/swiv3d/engine/fixed";
import { Terrain } from "../../../src/games/swiv3d/engine/terrain";
import { input } from "../../../src/games/swiv3d/engine/input";
import { World } from "../../../src/games/swiv3d/engine/world";
import { hasOriginalFiles, loadLevel } from "./helpers";

const flat = (h: number) => new Terrain(new Uint8Array(512 * 512).fill(h));

describe("caméra de poursuite", () => {
  it("vise 128 unités devant, œil 513 derrière et 197 au-dessus (site 30, distance 550)", () => {
    const cam = new Camera();
    const p = { x: 1000 * 256, y: 600 * 256, z: 2000 * 256, yaw: 0, roll: 0 };
    cam.setGoal(p, flat(0));
    expect(cam.goalAimX).toBe(1000);
    expect(cam.goalAimZ).toBe(2000 + 128);
    expect(cam.goalAimY).toBe(600);
    const radius = (COS[30]! * 550) >> 8;
    expect(radius).toBe(513); // le doc arrondit à 508 / 198 : calcul entier avec les tables
    expect(cam.goalEyeZ).toBe(2128 - ((COS[0]! * radius) >> 8));
    expect(cam.goalEyeY).toBe(600 + ((SIN[30]! * 550) >> 8));
    expect(cam.goalEyeY - 600).toBe(197);
  });

  it("garde l'œil à 120 unités au-dessus du relief environnant", () => {
    const cam = new Camera();
    cam.setGoal(
      { x: 1000 * 256, y: 100 * 256, z: 1000 * 256, yaw: 0, roll: 0 },
      flat(100),
    ); // relief à 400 unités
    expect(cam.goalEyeY).toBe(400 + 120);
  });

  it("borne l'angle de site et la distance, et le roulis cible à ±0,5", () => {
    const cam = new Camera();
    cam.pitch = 500;
    cam.distance = 10;
    cam.setGoal({ x: 0, y: 5000 * 256, z: 0, yaw: 0, roll: 90 }, flat(0));
    expect(cam.goalRoll).toBe(-0.5);
    expect(cam.goalEyeY - 5000).toBe((SIN[100]! * 200) >> 8);
  });

  it("lisse en 1/k par image avec k = max(1, fps/4) et suit le tore", () => {
    const cam = new Camera();
    cam.setGoal({ x: 100 * 256, y: 0, z: 100 * 256, yaw: 0, roll: 0 }, flat(0));
    const e0 = cam.eyeX;
    cam.setGoal({ x: 200 * 256, y: 0, z: 100 * 256, yaw: 0, roll: 0 }, flat(0));
    cam.smooth(40); // k = 10
    expect(cam.eyeX - e0).toBeCloseTo(10, 5);
    // franchissement de la couture : 32 760 → 8, l'écart est de 16 et non de -32 752
    const c2 = new Camera();
    c2.setGoal(
      { x: 32760 * 256, y: 0, z: 100 * 256, yaw: 0, roll: 0 },
      flat(0),
    );
    const before = c2.eyeX;
    c2.setGoal({ x: 8 * 256, y: 0, z: 100 * 256, yaw: 0, roll: 0 }, flat(0));
    c2.smooth(4); // k = 1 : rejoint la cible
    expect(c2.eyeX - before).toBeCloseTo(16, 5);
  });
});

describe.skipIf(!hasOriginalFiles)("caméra du monde", () => {
  it("suit le joueur derrière lui à la distance réglée", () => {
    const { level, models } = loadLevel("TERRAN00");
    const w = World.load(level, models);
    for (let i = 0; i < 400; i++) w.tick(input({ forward: true }));
    const c = w.camera;
    const dx = c.eyeX - (w.player.x >> 8);
    const dz = c.eyeZ - (w.player.z >> 8);
    // bonne échelle : de l'ordre de 500 unités (la poursuite lissée traîne, et le joueur a une vitesse de 17 u/tick)
    const wrap = (d: number) => d - Math.round(d / 32768) * 32768;
    expect(Math.hypot(wrap(dx), wrap(dz))).toBeGreaterThan(300);
    expect(Math.hypot(wrap(dx), wrap(dz))).toBeLessThan(900);
    expect(c.eyeY).toBeGreaterThan(
      w.terrain.height(w.player.x, w.player.z) / 256 + 119,
    );
  });

  it("n'est pas lissée automatiquement quand cameraFps vaut 0", () => {
    const { level, models } = loadLevel("TERRAN00");
    const w = World.load(level, models, { cameraFps: 0 });
    const e0 = w.camera.eyeX;
    for (let i = 0; i < 40; i++)
      w.tick(input({ forward: true, turnRight: true }));
    expect(w.camera.eyeX).toBe(e0);
    w.updateCamera(40);
    expect(w.camera.eyeX).not.toBe(e0);
  });
});
