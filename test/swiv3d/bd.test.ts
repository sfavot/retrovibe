import { describe, expect, it } from "vitest";
import { parseBd } from "../../src/games/swiv3d/data/bd";
import { hasOriginalFiles, readOriginal } from "./helpers";

function u32s(...values: number[]): number[] {
  return values.flatMap((v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24]);
}

describe("conteneur BD (données synthétiques)", () => {
  // Deux ressources (3 et 2 octets), puis le répertoire : 2 entrées + l'entrée finale (count = 3).
  const bytes = Uint8Array.from([1, 2, 3, 4, 5, ...u32s(0, 3, 100, 3, 2, 205, 3, 0xdead, 0)]);

  it("lit les entrées et les ressources par identifiant", () => {
    const bd = parseBd(bytes);
    expect(bd.entries).toEqual([
      { id: 100, offset: 0, size: 3 },
      { id: 205, offset: 3, size: 2 },
    ]);
    expect(bd.footer).toBe(0xdead);
    expect([...bd.get(205)]).toEqual([4, 5]);
    expect(bd.has(1)).toBe(false);
    expect(() => bd.get(1)).toThrow(/absente/);
  });

  it("refuse une ressource qui déborde sur le répertoire", () => {
    const bad = Uint8Array.from([1, 2, ...u32s(0, 9, 7, 2, 0, 0)]);
    expect(() => parseBd(bad)).toThrow(/hors du fichier/);
  });
});

describe.skipIf(!hasOriginalFiles)("conteneurs BD de SWIV 3D (fichiers du jeu)", () => {
  it.each([
    ["SOUNDS.BD", 26],
    ["GLOBAL.BD", 28],
    ["TERRAN00.SLV", 169],
    ["DEMO.SLV", 169],
  ])("%s : %i ressources contiguës jusqu'au répertoire", (name, count) => {
    const bytes = readOriginal(name);
    const { entries } = parseBd(bytes, name);
    expect(entries).toHaveLength(count);
    expect(entries[0].offset).toBe(0);
    for (let i = 1; i < entries.length; i++) expect(entries[i].offset).toBe(entries[i - 1].offset + entries[i - 1].size);
    const last = entries[entries.length - 1];
    expect(last.offset + last.size).toBe(bytes.length - 12 * (count + 1));
  });
});
