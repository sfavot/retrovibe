import { describe, expect, it } from "vitest";
import { PALETTE_BYTES, SCREEN_HEIGHT, SCREEN_WIDTH, parseMcg, parsePal } from "../../src/games/teleportaschtroumpf/data/mcg";
import { hasOriginalFiles, listData, readData, withExtension } from "./helpers";

describe("MCG / PAL : tailles invalides", () => {
  it("refuse un MCG de mauvaise taille", () => {
    expect(() => parseMcg(new Uint8Array(64769))).toThrow(/MCG invalide/);
  });

  it("refuse une PAL de mauvaise taille", () => {
    expect(() => parsePal(new Uint8Array(767))).toThrow(/PAL invalide/);
  });
});

describe.skipIf(!hasOriginalFiles)("MCG / PAL des fichiers originaux", () => {
  const mcgs = listData(withExtension("MCG"));
  const pals = listData(withExtension("PAL"));

  it("lit les 118 MCG", () => {
    expect(mcgs).toHaveLength(118);
    const headers = new Set<number>();
    for (const path of mcgs) {
      const mcg = parseMcg(readData(path));
      expect(mcg.palette, path).toHaveLength(PALETTE_BYTES);
      expect(mcg.pixels, path).toHaveLength(SCREEN_WIDTH * SCREEN_HEIGHT);
      headers.add(mcg.header);
    }
    expect([...headers].sort()).toEqual([0x0000, 0x00ff, 0xff00]);
  });

  it("lit les 34 PAL", () => {
    expect(pals).toHaveLength(34);
    for (const path of pals) expect(parsePal(readData(path)), path).toHaveLength(PALETTE_BYTES);
  });

  it("décode l'écran titre S05A", () => {
    const mcg = parseMcg(readData("S05/S05A/S05A.MCG"));
    expect(mcg.header).toBe(0x00ff);
    expect([...mcg.palette.subarray(0, 12)]).toEqual([0xff, 0x00, 0xff, 0x31, 0x21, 0x21, 0xc6, 0x73, 0x6b, 0x94, 0x42, 0x39]);
    expect([...mcg.pixels.subarray(0, 4)]).toEqual([0x8f, 0x8f, 0xfc, 0xfc]);
    expect([...mcg.pixels.subarray(32000, 32004)]).toEqual([0xca, 0xca, 0xca, 0xca]);
    expect([...mcg.pixels.subarray(63984, 63988)]).toEqual([0xae, 0xae, 0xae, 0xae]);
  });

  it("S38A001D est le seul MCG d'en-tête 0xff00", () => {
    expect(parseMcg(readData("S38/S38A/S38A001D.MCG")).header).toBe(0xff00);
  });
});
