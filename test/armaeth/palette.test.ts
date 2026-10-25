import { describe, expect, it } from "vitest";
import {
  PALETTE_OFFSET,
  readDefaultPalette,
  readRecolorTables,
} from "../../src/games/armaeth/data/palette";
import { hasOriginalFiles, readOriginal } from "./helpers";

describe("palette (données synthétiques)", () => {
  it("refuse un exécutable de taille inattendue", () => {
    expect(() => readDefaultPalette(new Uint8Array(100))).toThrow(
      /AM1\.EXE inattendu/,
    );
    expect(() => readRecolorTables(new Uint8Array(100))).toThrow(
      /AM1\.EXE inattendu/,
    );
  });

  it("refuse une valeur supérieure à 63", () => {
    const exe = new Uint8Array(254892);
    exe[PALETTE_OFFSET + 5] = 64;
    expect(() => readDefaultPalette(exe)).toThrow(/supérieure à 63/);
  });
});

describe.skipIf(!hasOriginalFiles)("palette d'Armaeth", () => {
  const exe = hasOriginalFiles ? readOriginal("AM1.EXE") : new Uint8Array();

  it("lit 768 valeurs VGA de 0 à 63", () => {
    const palette = readDefaultPalette(exe);
    expect(palette).toHaveLength(768);
    expect(Math.max(...palette)).toBeLessThanOrEqual(63);
    // entrée 0 noire, entrées 1 à 9 magenta (documenté)
    expect([...palette.subarray(0, 3)]).toEqual([0, 0, 0]);
    for (let i = 1; i <= 9; i++)
      expect([...palette.subarray(i * 3, i * 3 + 3)]).toEqual([63, 0, 63]);
  });

  it("place la palette à DGROUP:5512 (224 624 + 0x5512) et les tables de recoloration juste avant", () => {
    expect(PALETTE_OFFSET).toBe(224624 + 0x5512);
    const tables = readRecolorTables(exe);
    expect(tables.type1).toHaveLength(256);
    expect(tables.type2).toHaveLength(256);
    expect([...exe.subarray(224624 + 0x5312, 224624 + 0x5312 + 256)]).toEqual([
      ...tables.type1,
    ]);
    expect([...exe.subarray(224624 + 0x5412, 224624 + 0x5412 + 256)]).toEqual([
      ...tables.type2,
    ]);
  });
});
