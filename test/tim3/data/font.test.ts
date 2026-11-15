import { describe, expect, it } from "vitest";
import { glyphFor, readFnt, readPft } from "../../../src/games/tim3/data/font";
import { baseIndex, frenchPackIndex, namesWithExtension, original } from "./real";

function chunk(tag: string, data: number[]): number[] {
  return [...[...tag].map((c) => c.charCodeAt(0)), data.length & 255, (data.length >> 8) & 255, 0, 0, ...data];
}

/** FNT de deux glyphes : « I » (largeur 3, 1 octet par ligne) et un glyphe de largeur 9 (2 octets par ligne), hauteur 2, flux RLE. */
function fnt(): Uint8Array {
  // données : offsets 0 et 2 ; largeurs 3 et 9 ; glyphe 0 = e0 e0 ; glyphe 1 = 80 00 80 80
  const stream = [0x06, 0, 0, 2, 0, 3, 9, 0x82, 0xe0, 0x04, 0x80, 0x00, 0x80, 0x80];
  const body = [0xff, 9, 2, 1, 0x49, 2, 12, 0, 1, 12, 0, 0, 0, ...stream];
  return Uint8Array.from(chunk("FNT:", body));
}

describe("FNT DGDS", () => {
  it("lit largeur variable, bits de poids fort à gauche", () => {
    const font = readFnt(fnt());
    expect([font.kind, font.height, font.baseline, font.firstChar, font.glyphs.length]).toEqual(["fnt", 2, 1, 0x49, 2]);
    expect(glyphFor(font, 0x49)).toEqual({ width: 3, height: 2, pixels: Uint8Array.from([1, 1, 1, 1, 1, 1]) });
    const wide = glyphFor(font, 0x4a)!;
    expect([wide.width, wide.height]).toEqual([9, 2]);
    expect([...wide.pixels.subarray(0, 9)]).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect([...wide.pixels.subarray(9, 18)]).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(glyphFor(font, 0x10)).toBeUndefined();
  });

  it("refuse une police tronquée ou avec un reste", () => {
    const ok = fnt();
    expect(() => readFnt(ok.subarray(0, ok.length - 1))).toThrow();
    expect(() => readFnt(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/FNT/);
  });
});

/** PFT minimal : `rmap` de 255 entrées vers 255 glyphes 1×1 (lignes de 4 octets) ; la taille de chaque PBMP est inférieure de 4 octets. */
function pft(): Uint8Array {
  const u32 = (...v: number[]) => v.flatMap((x) => [x & 255, (x >> 8) & 255, (x >> 16) & 255, 0]);
  const tag = (t: string) => [...t].map((c) => c.charCodeAt(0));
  const out: number[] = [...tag("PFNT"), 0, 0, 0, 0];
  out.push(...chunk("head", u32(1, 0x45, 0, 0xff, 5, 4, 0xff, 0, 5, 0x10000, 0x10000, 0)));
  out.push(...tag("PBMA"), 0, 0, 0, 0);
  out.push(...chunk("head", u32(0x101, 255)));
  out.push(...chunk("user", new Array(12).fill(0)));
  const rmap = Array.from({ length: 255 }, (_, i) => ((i + 1) % 255) + 1); // permutation
  out.push(...chunk("rmap", u32(...rmap)));
  for (let i = 0; i < 255; i++) {
    out.push(...tag("PBMP"), ...u32(8 + 20 + 8 + 4 - 4));
    out.push(...chunk("head", u32(1, 1, 1, 8, 1)));
    out.push(...chunk("data", [i + 1, 0, 0, 0]));
  }
  return Uint8Array.from(out);
}

describe("PFT", () => {
  it("lit les glyphes par `rmap` et les PBMP de taille décalée de 4", () => {
    const font = readPft(pft());
    expect([font.kind, font.height, font.baseline, font.firstChar, font.glyphs.length]).toEqual(["pft", 5, 4, 1, 255]);
    // code 1 → rmap[0] = 2 → glyphe d'indice 1 → pixel 2
    expect([...font.glyphs[0].pixels]).toEqual([2]);
    expect(font.glyphs[0].width).toBe(1);
  });

  it("refuse une police tronquée", () => {
    const ok = pft();
    expect(() => readPft(ok.subarray(0, ok.length - 3))).toThrow();
  });
});

describe.skipIf(!original.has)("polices réelles", () => {
  it("lit les 6 FNT et les 8 PFT, plus SYS12.FNT du pack français", () => {
    const fnts = namesWithExtension(baseIndex(), "FNT");
    const pfts = namesWithExtension(baseIndex(), "PFT");
    expect(fnts.length).toBe(6);
    expect(pfts.length).toBe(8);
    for (const name of fnts) {
      const font = readFnt(baseIndex().get(name));
      expect(font.glyphs.length, name).toBeGreaterThan(90);
    }
    for (const name of pfts) {
      const font = readPft(baseIndex().get(name));
      expect(font.glyphs.length, name).toBe(255);
      for (const g of font.glyphs) expect(g.pixels.length).toBe(g.width * g.height);
    }
    for (const name of namesWithExtension(frenchPackIndex(), "FNT")) readFnt(frenchPackIndex().get(name));
  });

  it("dessine un « F » reconnaissable dans SYS12.FNT", () => {
    const font = readFnt(baseIndex().get("SYS12.FNT"));
    const g = glyphFor(font, 0x46)!;
    const rows = Array.from({ length: g.height }, (_, y) => [...g.pixels.subarray(y * g.width, (y + 1) * g.width)].join(""));
    expect(rows[1]).toBe("11111111100".slice(0, g.width));
    expect(rows.some((r) => r.includes("1"))).toBe(true);
  });
});
