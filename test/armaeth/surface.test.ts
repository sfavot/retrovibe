import { describe, expect, it } from "vitest";
import {
  DirtyRects,
  Surface,
  clipRect,
} from "../../src/games/armaeth/render/surface";

describe("clipRect", () => {
  it("rogne aux quatre côtés", () => {
    expect(clipRect({ x: -5, y: -3, width: 10, height: 10 })).toEqual({
      x: 0,
      y: 0,
      width: 5,
      height: 7,
    });
    expect(clipRect({ x: 315, y: 195, width: 10, height: 10 })).toEqual({
      x: 315,
      y: 195,
      width: 5,
      height: 5,
    });
  });

  it("rend null s'il ne reste rien", () => {
    expect(clipRect({ x: 320, y: 0, width: 4, height: 4 })).toBeNull();
    expect(clipRect({ x: -4, y: 0, width: 4, height: 4 })).toBeNull();
    expect(clipRect({ x: 0, y: 0, width: 0, height: 4 })).toBeNull();
  });
});

describe("Surface", () => {
  it("a la taille de l'écran VGA et se remet à zéro", () => {
    const s = new Surface();
    expect(s.pixels).toHaveLength(64000);
    expect(s.priority).toHaveLength(64000);
    s.clear(7, 9);
    expect(s.pixels[63999]).toBe(7);
    expect(s.priority[0]).toBe(9);
  });

  it("fillRect rogne et ne touche la priorité que si on la donne", () => {
    const s = new Surface(8, 4);
    s.fillRect({ x: -2, y: 1, width: 4, height: 10 }, 5);
    expect([...s.pixels.subarray(8, 16)]).toEqual([5, 5, 0, 0, 0, 0, 0, 0]);
    expect(s.pixels[0]).toBe(0);
    expect(s.priority.every((v) => v === 0)).toBe(true);
    s.fillRect({ x: 6, y: 0, width: 5, height: 1 }, 1, 3);
    expect([...s.priority.subarray(0, 8)]).toEqual([0, 0, 0, 0, 0, 0, 3, 3]);
  });

  it("setPixel ignore ce qui est hors de la page", () => {
    const s = new Surface(4, 4);
    s.setPixel(-1, 0, 9);
    s.setPixel(4, 0, 9);
    s.setPixel(0, 4, 9);
    s.setPixel(3, 3, 9);
    expect(s.pixels.filter((v) => v === 9)).toHaveLength(1);
    expect(s.pixels[15]).toBe(9);
  });

  it("readRect / writeRect font un aller-retour, priorités comprises", () => {
    const s = new Surface(6, 6);
    const rect = { x: 1, y: 2, width: 3, height: 2 };
    s.writeRect(rect, Uint8Array.from([1, 2, 3, 4, 5, 6]), Uint8Array.from([9, 9, 9, 8, 8, 8]));
    expect([...s.readRect(rect)]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.pixels[2 * 6 + 1]).toBe(1);
    expect(s.pixels[3 * 6 + 3]).toBe(6);
    expect(s.priority[2 * 6 + 2]).toBe(9);
    expect(s.priority[3 * 6 + 2]).toBe(8);
    expect(s.pixels[2 * 6]).toBe(0);
  });

  it("refuse un rectangle hors de la page ou des données de mauvaise taille", () => {
    const s = new Surface(4, 4);
    expect(() => s.readRect({ x: 3, y: 0, width: 2, height: 1 })).toThrow(RangeError);
    expect(() => s.writeRect({ x: 0, y: 0, width: 2, height: 2 }, new Uint8Array(3))).toThrow(RangeError);
    expect(() => s.writeRect({ x: 0, y: -1, width: 1, height: 1 }, new Uint8Array(1))).toThrow(RangeError);
  });

  it("copyRect recopie à la même position, rogné, sans la priorité par défaut", () => {
    const from = new Surface(4, 4);
    from.clear(3, 7);
    const to = new Surface(4, 4);
    to.copyRect(from, { x: 2, y: 2, width: 9, height: 9 });
    expect(to.pixels[2 * 4 + 2]).toBe(3);
    expect(to.pixels[1 * 4 + 2]).toBe(0);
    expect(to.priority.every((v) => v === 0)).toBe(true);
    to.copyRect(from, { x: 0, y: 0, width: 1, height: 1 }, true);
    expect(to.priority[0]).toBe(7);
  });
});

describe("DirtyRects", () => {
  it("garde les rectangles tels quels (pas de fusion) et se vide", () => {
    const d = new DirtyRects();
    d.add({ x: 0, y: 0, width: 2, height: 2 });
    d.add({ x: 1, y: 1, width: 2, height: 2 });
    expect(d.list).toHaveLength(2);
    expect(d.all).toBe(false);
    d.markAll();
    expect(d.all).toBe(true);
    d.clear();
    expect(d.list).toHaveLength(0);
    expect(d.all).toBe(false);
  });
});
