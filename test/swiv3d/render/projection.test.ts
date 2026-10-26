import { describe, expect, it } from "vitest";
import { createProjection, projectPoint, setupProjection, type ProjectedPoint } from "../../../src/games/swiv3d/render/camera";
import { COS, RECIP_FFFF, SIN, SIN320, WAVE, normalize256 } from "../../../src/games/swiv3d/render/tables";
import { wrapDelta } from "../../../src/games/swiv3d/render/view";

const origin = { x: 1000, y: 500, z: 2000 };

function project(camera: { yaw: number; pitch: number; roll?: number }, x: number, y: number, z: number): ProjectedPoint {
  const pr = setupProjection(createProjection(), { ...origin, ...camera });
  return projectPoint(pr, x, y, z, { x: -1, y: -1, depth: 0 });
}

describe("projection du rendu (render.md §4.3)", () => {
  it("place un point droit devant au centre de l'écran, à la profondeur + 0x19", () => {
    const p = project({ yaw: 0, pitch: 0 }, origin.x, origin.y, origin.z + 475);
    expect(p).toEqual({ x: 159, y: 199, depth: 500 });
  });

  it("divise par la profondeur : 319 pas horizontaux, 531 verticaux (pixels non carrés)", () => {
    // Droite de la caméra = +x quand elle regarde vers +z ; 100 unités à D = 500.
    const right = project({ yaw: 0, pitch: 0 }, origin.x + 100, origin.y, origin.z + 475);
    expect(right.x).toBe(159 + Math.trunc((100 * 319) / 500));
    expect(right.y).toBe(199);
    const above = project({ yaw: 0, pitch: 0 }, origin.x, origin.y + 100, origin.z + 475);
    expect(above.x).toBe(159);
    expect(above.y).toBe(199 - Math.trunc((100 * 531) / 500));
  });

  it("tourne avec le cap : 128 pas regardent vers +x, la gauche d'un cap de 256 est +x", () => {
    expect(project({ yaw: 128, pitch: 0 }, origin.x + 475, origin.y, origin.z)).toEqual({ x: 159, y: 199, depth: 500 });
    const behindRight = project({ yaw: 256, pitch: 0 }, origin.x + 100, origin.y, origin.z - 475);
    expect(behindRight.x).toBe(159 - Math.trunc((100 * 319) / 500));
  });

  it("l'élévation positive regarde vers le bas : le point sous l'axe est au centre à 45°", () => {
    const d = 475;
    const k = Math.SQRT1_2;
    const p = project({ yaw: 0, pitch: 64 }, origin.x, origin.y - d * k, origin.z + d * k);
    expect(Math.abs(p.x - 159)).toBeLessThanOrEqual(1);
    expect(Math.abs(p.y - 199)).toBeLessThanOrEqual(2);
    expect(Math.abs(p.depth - 500)).toBeLessThanOrEqual(2);
  });

  it("laisse x et y inchangés derrière la caméra (profondeur <= 0)", () => {
    const pr = setupProjection(createProjection(), { ...origin, yaw: 0, pitch: 0 });
    const out = { x: 12, y: 34, depth: 0 };
    projectPoint(pr, origin.x, origin.y, origin.z - 100, out);
    expect(out.x).toBe(12);
    expect(out.y).toBe(34);
    expect(out.depth).toBeLessThanOrEqual(0);
  });

  it("incline l'horizon avec la gîte", () => {
    const flat = project({ yaw: 0, pitch: 0, roll: 0 }, origin.x + 100, origin.y, origin.z + 475);
    const banked = project({ yaw: 0, pitch: 0, roll: 0.4 }, origin.x + 100, origin.y, origin.z + 475);
    expect(banked.y).not.toBe(flat.y);
  });
});

describe("tables du rendu", () => {
  it("reprennent les valeurs de l'exécutable", () => {
    expect([SIN[0], SIN[128], COS[0], COS[256], SIN[64]]).toEqual([0, 256, 256, -256, 181]);
    expect(SIN320[128]).toBe(320);
    expect(Array.from(WAVE.slice(0, 8))).toEqual([0, 2, 3, 5, 6, 8, 9, 10]);
    expect(RECIP_FFFF[0]).toBe(0xffff);
    expect(RECIP_FFFF[2]).toBe(0x7fff);
  });

  it("normalise un vecteur de pente à la longueur 256 (sol plat : (0, 256, 0) environ)", () => {
    const flat = Int32Array.from([0, 0x40, 0]);
    normalize256(flat);
    expect(flat[0]).toBe(0);
    expect(Math.abs(flat[1]! - 256)).toBeLessThanOrEqual(2);
  });

  it("replie les différences de coordonnées dans le monde torique", () => {
    expect(wrapDelta(100)).toBe(100);
    expect(wrapDelta(32768 - 100)).toBe(-100);
    expect(wrapDelta(-32768 + 100)).toBe(100);
  });
});
