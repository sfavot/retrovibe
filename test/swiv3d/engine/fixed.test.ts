import { describe, expect, it } from "vitest";
import {
  COS,
  SIN,
  TORUS_Q8,
  friction16,
  normalize256,
  sin,
  torusDelta,
  wrapQ8,
} from "../../../src/games/swiv3d/engine/fixed";

describe("virgule fixe et trigonométrie", () => {
  it("construit des tables de 512 entrées arrondies au plus proche", () => {
    expect(SIN).toHaveLength(512);
    expect(COS).toHaveLength(512);
    expect([SIN[0], SIN[64], SIN[128], SIN[256], SIN[384]]).toEqual([
      0, 181, 256, 0, -256,
    ]);
    expect(SIN[1]).toBe(3);
    for (let i = 0; i < 512; i++)
      expect(SIN[i]).toBe(Math.round(256 * Math.sin((2 * Math.PI * i) / 512)));
  });

  it("décale cos d'un quart de tour et respecte sin² + cos² ≈ 256²", () => {
    for (let i = 0; i < 512; i++) {
      expect(COS[i]).toBe(SIN[(i + 128) & 511]);
      expect(Math.abs(SIN[i]! ** 2 + COS[i]! ** 2 - 65536)).toBeLessThan(600);
    }
    expect(COS[0]).toBe(256);
    expect(COS[256]).toBe(-256);
  });

  it("replie les angles négatifs ou trop grands", () => {
    expect(sin(-384)).toBe(SIN[128]);
    expect(sin(512 + 64)).toBe(SIN[64]);
  });

  it("replie dans le tore et mesure l'écart le plus court", () => {
    expect(wrapQ8(TORUS_Q8 + 5)).toBe(5);
    expect(wrapQ8(-1)).toBe(TORUS_Q8 - 1);
    expect(torusDelta(10, TORUS_Q8 - 10)).toBe(20);
    expect(torusDelta(TORUS_Q8 - 10, 10)).toBe(-20);
  });

  it("applique le frottement 1/16 avec le cas v >> 4 == 0", () => {
    expect(friction16(160)).toBe(150);
    expect(friction16(15)).toBe(0);
    expect(friction16(-15)).toBe(-14); // -15 >> 4 = -1 : décalage arithmétique, comme dans l'exe
    expect(friction16(-160)).toBe(-150);
  });

  it("normalise à la longueur 256 (±2)", () => {
    const out = { x: 0, y: 0, z: 0 };
    normalize256(800, 0, 600, out);
    expect(Math.hypot(out.x, out.y, out.z)).toBeGreaterThan(250);
    expect(Math.hypot(out.x, out.y, out.z)).toBeLessThan(260);
    expect(out.x / out.z).toBeCloseTo(800 / 600, 1);
  });
});
