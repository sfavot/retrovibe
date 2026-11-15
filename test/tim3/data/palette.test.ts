import { describe, expect, it } from "vitest";
import { readPalette } from "../../../src/games/tim3/data/palette";
import { baseIndex, frenchPackIndex, namesWithExtension, original } from "./real";

function riff(entries: number[][]): Uint8Array {
  const out = new Uint8Array(24 + 4 * entries.length);
  const view = new DataView(out.buffer);
  out.set([...("RIFF" + "\0\0\0\0" + "PAL data").split("").map((c) => c.charCodeAt(0))]);
  view.setUint32(4, out.length - 8, true);
  view.setUint32(16, 4 + 4 * entries.length, true);
  view.setUint16(20, 0x300, true);
  view.setUint16(22, entries.length, true);
  entries.forEach((e, i) => out.set(e, 24 + 4 * i));
  return out;
}

function dgdsPal(vga: number[], extra = false): Uint8Array {
  const chunk = (tag: string, data: number[], container = false) => {
    const size = data.length | (container ? 0x80000000 : 0);
    return [...[...tag].map((c) => c.charCodeAt(0)), size & 255, (size >> 8) & 255, (size >> 16) & 255, (size >>> 24) & 255, ...data];
  };
  const inner = [...chunk("VGA:", vga), ...(extra ? chunk("EGA:", new Array(17).fill(0)) : [])];
  return Uint8Array.from(chunk("PAL:", inner, true));
}

describe("palette", () => {
  it("lit une palette RIFF, index 0 transparent", () => {
    const entries = Array.from({ length: 256 }, (_, i) => [i, 255 - i, 7, 0]);
    const rgba = readPalette(riff(entries));
    expect(rgba.length).toBe(1024);
    expect([...rgba.subarray(0, 4)]).toEqual([0, 255, 7, 0]);
    expect([...rgba.subarray(4 * 10, 4 * 10 + 4)]).toEqual([10, 245, 7, 255]);
    expect([...rgba.subarray(4 * 255, 4 * 256)]).toEqual([255, 0, 7, 255]);
  });

  it("étend une palette DGDS de 6 à 8 bits (63 → 255)", () => {
    const vga = Array.from({ length: 768 }, (_, i) => (i % 3 === 0 ? 63 : i % 3 === 1 ? 32 : 0));
    const rgba = readPalette(dgdsPal(vga, true));
    expect([...rgba.subarray(4, 8)]).toEqual([255, 130, 0, 255]);
    expect(rgba[3]).toBe(0);
  });

  it("refuse une palette mal formée", () => {
    expect(() => readPalette(riff([[1, 2, 3, 0]]))).toThrow(/mal formée/);
    expect(() => readPalette(dgdsPal([1, 2, 3]))).toThrow(/768/);
    const bad = riff(Array.from({ length: 256 }, () => [0, 0, 0, 0]));
    expect(() => readPalette(bad.subarray(0, bad.length - 1))).toThrow();
  });
});

describe.skipIf(!original.has)("palettes réelles", () => {
  it("lit les 28 PAL (25 RIFF, 3 DGDS) et le français", () => {
    const names = namesWithExtension(baseIndex(), "PAL");
    expect(names.length).toBe(28);
    for (const name of names) {
      const rgba = readPalette(baseIndex().get(name));
      expect(rgba.length, name).toBe(1024);
      expect(rgba[3], name).toBe(0);
      expect(rgba[7], name).toBe(255);
    }
    for (const name of namesWithExtension(frenchPackIndex(), "PAL")) readPalette(frenchPackIndex().get(name));
  });

  it("TIM_NEW.PAL : l'index 0 est le magenta transparent, 255 est vert", () => {
    const rgba = readPalette(baseIndex().get("TIM_NEW.PAL"));
    expect([...rgba.subarray(0, 4)]).toEqual([255, 0, 255, 0]);
    expect([...rgba.subarray(1020, 1024)]).toEqual([0, 255, 0, 255]);
    const distinct = new Set<number>();
    for (let i = 0; i < 256; i++) distinct.add((rgba[4 * i] << 16) | (rgba[4 * i + 1] << 8) | rgba[4 * i + 2]);
    expect(distinct.size).toBe(220);
  });
});
