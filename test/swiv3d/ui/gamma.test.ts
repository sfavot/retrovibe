import { describe, expect, it } from "vitest";
import { paletteToLut } from "../../../src/ui/indexed-canvas";
import { GammaCache, applyGamma, gammaTable } from "../../../src/games/swiv3d/ui/gamma";

describe("correction gamma (`gm_gamma_build`)", () => {
  it("table 0 = identité ; tables 1 à 3 : 63·(i/63)^(1 − g/8), tronqué, 0 et 63 fixes", () => {
    expect([...gammaTable(0)]).toEqual(Array.from({ length: 64 }, (_, i) => i));
    for (let g = 1; g < 4; g++) {
      const t = gammaTable(g);
      expect([t[0], t[63]]).toEqual([0, 63]);
      for (let i = 1; i < 63; i++) expect(t[i]).toBeGreaterThanOrEqual(i);
    }
    // valeurs relevées : i = 1 et 32 avec g = 3 (exposant 0,625)
    expect(gammaTable(3)[1]).toBe(4);
    expect(gammaTable(3)[32]).toBe(41);
  });

  it("corrige R, V, B d'une table de couleurs et garde l'alpha ; gamma 0 rend la même table", () => {
    const rgb = new Uint8Array(768);
    rgb.set([128, 0, 255], 3);
    const lut = paletteToLut(rgb);
    expect(applyGamma(lut, 0)).toBe(lut);
    const out = new Uint8Array(applyGamma(lut, 3).buffer);
    // 128 = (32 << 2) | 0 -> 41 -> 164 + 2 ; 255 = 63 -> 63
    expect([...out.subarray(4, 8)]).toEqual([166, 0, 255, 255]);
  });

  it("garde le résultat par table source et par niveau", () => {
    const cache = new GammaCache();
    const lut = paletteToLut(new Uint8Array(768).fill(100));
    expect(cache.lut(lut)).toBe(lut);
    cache.level = 2;
    const a = cache.lut(lut);
    expect(a).not.toBe(lut);
    expect(cache.lut(lut)).toBe(a);
    cache.level = 1;
    expect(cache.lut(lut)).not.toBe(a);
  });
});
