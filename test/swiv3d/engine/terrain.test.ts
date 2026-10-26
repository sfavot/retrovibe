import { describe, expect, it } from "vitest";
import { Terrain } from "../../../src/games/swiv3d/engine/terrain";
import { hasOriginalFiles, loadLevel } from "./helpers";

describe("terrain (synthétique)", () => {
  const map = new Uint8Array(512 * 512);
  map[0] = 10; // (0,0)
  map[1] = 20; // (1,0)
  map[512] = 30; // (0,1)
  map[513] = 50; // (1,1)
  const t = new Terrain(map);

  it("renvoie octet × 0x400 aux coins", () => {
    expect(t.height(0, 0)).toBe(10 * 0x400);
    expect(t.height(1 << 14, 0)).toBe(20 * 0x400);
  });

  it("interpole bilinéairement sur 8 bits", () => {
    // mi-chemin en x (fraction 128 = 0x80 << 6 = 0x2000) puis en z
    expect(t.height(0x2000, 0)).toBe(15 * 0x400);
    expect(t.height(0, 0x2000)).toBe(20 * 0x400);
    expect(t.height(0x2000, 0x2000)).toBe(((15 + 40) / 2) * 0x400);
  });

  it("replie les cellules modulo 512 (tore)", () => {
    expect(t.height(512 << 14, 0)).toBe(t.height(0, 0));
    expect(t.height(-1 << 14, 0)).toBe(map[511]! * 0x400);
    expect(t.height(0, 512 << 14)).toBe(t.height(0, 0));
  });
});

describe.skipIf(!hasOriginalFiles)("terrain (TERRAN00)", () => {
  const { level } = loadLevel("TERRAN00");
  const t = Terrain.fromLevel(level);

  it("lit la carte du bloc 100 aux cellules connues", () => {
    for (const [cx, cz] of [
      [0, 0],
      [100, 200],
      [511, 511],
      [256, 3],
      [12159 >> 6, 29373 >> 6],
    ] as const) {
      expect(t.height(cx << 14, cz << 14)).toBe(
        level.heightmap[cz * 512 + cx]! * 0x400,
      );
      expect(t.cell(cx, cz)).toBe(level.heightmap[cz * 512 + cx]);
    }
  });

  it("est périodique de 2^23 en Q8 (32 768 unités)", () => {
    for (const [x, z] of [
      [123456, 654321],
      [7_000_000, 100],
      [5, 8_000_000],
    ] as const)
      expect(t.height(x + (1 << 23), z)).toBe(t.height(x, z));
    expect(t.height(100, 200 + (1 << 23))).toBe(t.height(100, 200));
    expect(t.height(-5_000, -9_000)).toBe(
      t.height((1 << 23) - 5_000, (1 << 23) - 9_000),
    );
  });

  it("reste entre les hauteurs extrêmes de la carte", () => {
    for (let i = 0; i < 200; i++) {
      const h = t.height(i * 41_113, i * 97_241);
      expect(h).toBeGreaterThanOrEqual(28 * 0x400);
      expect(h).toBeLessThanOrEqual(255 * 0x400);
    }
  });
});
