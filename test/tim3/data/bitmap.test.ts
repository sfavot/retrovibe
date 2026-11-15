import { describe, expect, it } from "vitest";
import { readBitmap } from "../../../src/games/tim3/data/bitmap";
import { baseIndex, frenchPackIndex, namesWithExtension, original } from "./real";

function flat(frames: { w: number; h: number; pixels: number[] }[]): Uint8Array {
  const parts: number[] = [];
  const offsets: number[] = [];
  let at = 12 + 4 * frames.length;
  for (const f of frames) {
    offsets.push(at);
    const n = f.w * f.h;
    parts.push(f.w & 255, f.w >> 8, f.h & 255, f.h >> 8, 0, n & 255, (n >> 8) & 255, 0, 0, ...f.pixels);
    at += 9 + n;
  }
  const out = new Uint8Array(at);
  const view = new DataView(out.buffer);
  out.set([0x42, 0x4d, 0x50, 0x3a]);
  view.setUint32(4, at - 8, true);
  view.setUint16(8, 1000, true);
  view.setUint16(10, frames.length, true);
  offsets.forEach((o, i) => view.setUint32(12 + 4 * i, o, true));
  out.set(parts, 12 + 4 * frames.length);
  return out;
}

function chunk(tag: string, data: number[], container = false): number[] {
  const size = data.length | (container ? 0x80000000 : 0);
  return [...[...tag].map((c) => c.charCodeAt(0)), size & 255, (size >> 8) & 255, (size >> 16) & 255, (size >>> 24) & 255, ...data];
}

function u16(...values: number[]): number[] {
  return values.flatMap((v) => [v & 255, v >> 8]);
}

describe("BMP plat v1000", () => {
  it("lit plusieurs frames", () => {
    const bmp = readBitmap(flat([{ w: 2, h: 2, pixels: [1, 2, 3, 4] }, { w: 3, h: 1, pixels: [7, 8, 9] }]));
    expect(bmp.frames.map((f) => [f.width, f.height, [...f.pixels]])).toEqual([
      [2, 2, [1, 2, 3, 4]],
      [3, 1, [7, 8, 9]],
    ]);
  });

  it("refuse un reste, une version inconnue ou une frame tronquée", () => {
    const ok = flat([{ w: 2, h: 1, pixels: [1, 2] }]);
    const extra = new Uint8Array(ok.length + 1);
    extra.set(ok);
    expect(() => readBitmap(extra)).toThrow(/incohérente/);
    const version = ok.slice();
    new DataView(version.buffer).setUint16(8, 999, true);
    expect(() => readBitmap(version)).toThrow(/version/);
    expect(() => readBitmap(ok.subarray(0, ok.length - 1))).toThrow();
    expect(() => readBitmap(Uint8Array.from([0x58, 0x58, 0x58, 0x3a, 0, 0, 0, 0]))).toThrow(/signature/);
  });
});

describe("BMP DGDS", () => {
  /** Deux frames 2×1 et 2×1 : pixels 0x21, 0x43 | 0x65, 0x87 → quartets bas dans BIN, hauts dans VGA. */
  function dgds(method: number): Uint8Array {
    // pixels : 0x21 0x43 0x65 0x87 ; BIN = bas 4 bits du pixel pair | bas du pixel impair << 4
    const pixels = [0x21, 0x43, 0x65, 0x87];
    const bin: number[] = [];
    const vga: number[] = [];
    for (let i = 0; i < pixels.length; i += 2) {
      bin.push((pixels[i] & 15) | ((pixels[i + 1] & 15) << 4));
      vga.push((pixels[i] >> 4) | (pixels[i + 1] & 0xf0));
    }
    const payload = (raw: number[]) => (method === 0 ? [0, raw.length, 0, 0, 0, ...raw] : [1, raw.length, 0, 0, 0, 0x80 | raw.length, 0]);
    const rle = (raw: number[]) => [1, raw.length, 0, 0, 0, raw.length, ...raw];
    const encode = method === 0 ? payload : rle;
    return Uint8Array.from(
      chunk(
        "BMP:",
        [...chunk("INF:", u16(2, 2, 2, 1, 1)), ...chunk("BIN:", encode(bin)), ...chunk("VGA:", encode(vga)), ...chunk("SCL:", [])],
        true,
      ),
    );
  }

  it("recompose les pixels de 4+4 bits (brut et RLE)", () => {
    for (const method of [0, 1]) {
      const bmp = readBitmap(dgds(method));
      expect(bmp.frames.map((f) => [f.width, f.height, [...f.pixels]])).toEqual([
        [2, 1, [0x21, 0x43]],
        [2, 1, [0x65, 0x87]],
      ]);
    }
  });

  it("refuse des frames dont la surface ne correspond pas aux données", () => {
    const bad = dgds(0).slice();
    bad[8 + 8 + 4] = 3; // largeur de la 1re frame : 2 → 3
    expect(() => readBitmap(bad)).toThrow(/somme/);
  });
});

describe.skipIf(!original.has)("BMP réels", () => {
  it("lit les 477 BMP de RESOURCE.001 : taille w×h, rien de reste", () => {
    const names = namesWithExtension(baseIndex(), "BMP");
    expect(names.length).toBe(477);
    let frames = 0;
    for (const name of names) {
      const bmp = readBitmap(baseIndex().get(name));
      expect(bmp.frames.length, name).toBeGreaterThan(0);
      for (const f of bmp.frames) expect(f.pixels.length, name).toBe(f.width * f.height);
      frames += bmp.frames.length;
    }
    expect(frames).toBeGreaterThanOrEqual(3244);
  });

  it("lit les BMP de FRENCH.DAT", () => {
    const names = namesWithExtension(frenchPackIndex(), "BMP");
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const bmp = readBitmap(frenchPackIndex().get(name));
      for (const f of bmp.frames) expect(f.pixels.length, name).toBe(f.width * f.height);
    }
  });

  it("reconnaît les 11 BMP DGDS (5 de base, 6 du pack français)", () => {
    const dgdsNames = (index: ReturnType<typeof baseIndex>) =>
      namesWithExtension(index, "BMP").filter((n) => (index.get(n)[7] & 0x80) !== 0);
    expect(dgdsNames(baseIndex())).toHaveLength(5);
    expect(dgdsNames(frenchPackIndex())).toHaveLength(6);
  });

  it("SIERRA.BMP est plein écran 640×480", () => {
    const bmp = readBitmap(baseIndex().get("SIERRA.BMP"));
    expect([bmp.frames[0].width, bmp.frames[0].height]).toEqual([640, 480]);
  });
});
