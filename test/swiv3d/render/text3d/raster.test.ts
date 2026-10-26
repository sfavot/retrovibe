import { describe, expect, it } from "vitest";
import { fillFlatTriangle } from "../../../../src/games/swiv3d/render/text3d";

const W = 320;
const H = 400;

function paint(x: number[], y: number[], guard = 0): Uint8Array {
  const buffer = new Uint8Array(W * H + guard).fill(0);
  fillFlatTriangle(buffer.subarray(0, W * H), x, y, 7);
  return buffer;
}
const at = (fb: Uint8Array, x: number, y: number): number => fb[y * W + x]!;

describe("triangle de couleur unie (gm_draw_flat_tri)", () => {
  it("remplit l'intérieur, pas l'extérieur", () => {
    const fb = paint([10, 40, 10], [10, 10, 40]);
    expect(at(fb, 12, 12)).toBe(7);
    expect(at(fb, 12, 30)).toBe(7);
    expect(at(fb, 35, 38)).toBe(0);
    expect(at(fb, 5, 5)).toBe(0);
    expect(at(fb, 9, 20)).toBe(0);
  });

  it("l'ordre des sommets ne change pas la surface", () => {
    const a = paint([10, 40, 10], [10, 10, 40]);
    const b = paint([10, 10, 40], [10, 40, 10]);
    const c = paint([40, 10, 10], [10, 40, 10]);
    const area = (fb: Uint8Array) => fb.reduce((n, v) => n + (v === 7 ? 1 : 0), 0);
    expect(area(a)).toBeGreaterThan(400);
    expect(Math.abs(area(a) - area(b))).toBeLessThan(area(a) * 0.15);
    expect(Math.abs(area(a) - area(c))).toBeLessThan(area(a) * 0.15);
  });

  it("découpe aux bords de l'image sans écrire ailleurs, même avec des coordonnées extrêmes", () => {
    const guard = 2048;
    for (const [x, y] of [
      [[-50, 400, 100], [-30, 120, 600]],
      [[300, 340, 330], [390, 399, 420]],
      [[-1e6, 1e6, 0], [-1e6, 0, 1e6]],
      [[100, 100, 100], [0, 200, 399]],
    ] as const) {
      const buffer = paint([...x], [...y], guard);
      expect(buffer.subarray(W * H).every((v) => v === 0)).toBe(true);
    }
  });

  it("n'écrit pas au-delà de la colonne 319", () => {
    const fb = paint([300, 360, 300], [100, 100, 200]);
    for (let y = 100; y < 200; y++) expect(at(fb, 0, y)).toBe(0);
    expect(at(fb, 319, 105)).toBe(7);
  });
});
