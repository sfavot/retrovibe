import { describe, expect, it } from "vitest";
import { IndexedPresenter, paintIndexed, paletteToLut, vga6ToRgb8, type IndexedContext } from "../../src/ui/indexed-canvas";

const LITTLE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function fakeContext() {
  const puts: { data: Uint8ClampedArray; x: number; y: number }[] = [];
  let created = 0;
  const context = {
    createImageData: (w: number, h: number) => {
      created++;
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData: (image: { data: Uint8ClampedArray }, x: number, y: number) => {
      puts.push({ data: Uint8ClampedArray.from(image.data), x, y });
    },
  } as unknown as IndexedContext;
  return { context, puts, created: () => created };
}

function rgbPalette(): Uint8Array {
  const rgb = new Uint8Array(768);
  rgb.set([10, 20, 30], 3); // index 1
  rgb.set([255, 128, 1], 6); // index 2
  return rgb;
}

describe("vga6ToRgb8", () => {
  it("convertit 0 -> 0 et 63 -> 255", () => {
    const palette = new Uint8Array(768);
    palette[0] = 0;
    palette[1] = 63;
    palette[2] = 32;
    palette[3] = 1;
    const rgb = vga6ToRgb8(palette);
    expect(rgb).toHaveLength(768);
    expect(Array.from(rgb.subarray(0, 4))).toEqual([0, 255, 130, 4]);
  });

  it("ignore les bits de poids fort (masque 6 bits)", () => {
    expect(vga6ToRgb8(new Uint8Array(768).fill(0xff))[0]).toBe(255);
  });
});

describe("paletteToLut", () => {
  it("écrit RGBA opaque dans l'ordre mémoire", () => {
    const lut = paletteToLut(rgbPalette());
    expect(lut).toHaveLength(256);
    const bytes = new Uint8Array(lut.buffer);
    expect(Array.from(bytes.subarray(4, 8))).toEqual([10, 20, 30, 255]);
    expect(Array.from(bytes.subarray(8, 12))).toEqual([255, 128, 1, 255]);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0, 0, 0, 255]);
    if (LITTLE) expect(lut[1]).toBe(0xff1e140a);
  });
});

describe("paintIndexed", () => {
  it("peint via une palette RGB ou une table, avec origine", () => {
    const pixels = Uint8Array.from([0, 1, 2, 1]);
    const a = fakeContext();
    paintIndexed(a.context, pixels, 2, 2, rgbPalette(), { originX: 3, originY: 4 });
    const b = fakeContext();
    paintIndexed(b.context, pixels, 2, 2, paletteToLut(rgbPalette()));
    expect(a.puts[0].x).toBe(3);
    expect(a.puts[0].y).toBe(4);
    expect(Array.from(a.puts[0].data.subarray(4, 8))).toEqual([10, 20, 30, 255]);
    expect(a.puts[0].data).toEqual(b.puts[0].data);
  });

  it("rend l'index transparent à 0", () => {
    const f = fakeContext();
    paintIndexed(f.context, Uint8Array.from([1, 2]), 2, 1, rgbPalette(), { transparent: 1 });
    expect(Array.from(f.puts[0].data)).toEqual([0, 0, 0, 0, 255, 128, 1, 255]);
  });
});

describe("IndexedPresenter", () => {
  it("réutilise un seul ImageData et applique l'origine", () => {
    const f = fakeContext();
    const presenter = new IndexedPresenter(f.context, 2, 1, 32, 24);
    presenter.present(Uint8Array.from([1, 2]), rgbPalette());
    presenter.present(Uint8Array.from([2, 1]), rgbPalette());
    expect(f.created()).toBe(1);
    expect(f.puts).toHaveLength(2);
    expect(f.puts[1].x).toBe(32);
    expect(f.puts[1].y).toBe(24);
    expect(Array.from(f.puts[0].data)).toEqual([10, 20, 30, 255, 255, 128, 1, 255]);
    expect(Array.from(f.puts[1].data)).toEqual([255, 128, 1, 255, 10, 20, 30, 255]);
  });
});
