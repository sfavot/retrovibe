import { describe, expect, it } from "vitest";
import {
  readCountedArchive,
  readSceneArchive,
} from "../../src/games/armaeth/data/vga-archive";
import { hasOriginalFiles, listOriginal, readOriginal } from "./helpers";

function u16(v: number): number[] {
  return [v & 0xff, v >> 8];
}
function u32(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24];
}

describe("archives VGA (données synthétiques)", () => {
  it("lit une archive à compteur", () => {
    const bytes = Uint8Array.from([
      ...u16(2),
      ...u16(7),
      ...u32(22),
      ...u32(2),
      ...u16(9),
      ...u32(24),
      ...u32(1),
      1,
      2,
      3,
    ]);
    const archive = readCountedArchive(bytes);
    expect(archive.entries).toEqual([
      { id: 7, offset: 22, size: 2 },
      { id: 9, offset: 24, size: 1 },
    ]);
    expect([...archive.bytes(7)]).toEqual([1, 2]);
    expect(() => archive.bytes(8)).toThrow(/absente/);
  });

  it("ignore les emplacements vides d'une archive de scènes", () => {
    const table = [...u16(101), ...u32(50), ...u32(3)];
    const bytes = Uint8Array.from([
      ...new Array(10).fill(0),
      ...table,
      ...new Array(30).fill(0),
      5,
      6,
      7,
    ]);
    const archive = readSceneArchive(bytes);
    expect(archive.entries).toEqual([{ id: 101, offset: 50, size: 3 }]);
    expect([...archive.bytes(101)]).toEqual([5, 6, 7]);
  });

  it("refuse une ressource qui sort du fichier", () => {
    const bytes = Uint8Array.from([
      ...u16(1),
      ...u16(1),
      ...u32(12),
      ...u32(5),
      0,
    ]);
    expect(() => readCountedArchive(bytes)).toThrow(/Archive VGA invalide/);
    expect(() => readSceneArchive(new Uint8Array(10))).toThrow(
      /Archive VGA invalide/,
    );
  });
});

describe.skipIf(!hasOriginalFiles)("archives VGA d'Armaeth", () => {
  const sprites = listOriginal((n) => /^A1F(OBJ|ANM|DEC|INT)\.VGA$/.test(n));
  const scenes = listOriginal((n) => /^A1F0\d[A-E]\.VGA$/.test(n));

  it("trouve les 4 archives de sprites et les 15 archives de scènes", () => {
    expect(sprites).toHaveLength(4);
    expect(scenes).toHaveLength(15);
  });

  it.each(sprites)(
    "%s : le premier offset suit la table et les ressources couvrent le fichier",
    (name) => {
      const data = readOriginal(name);
      const { entries } = readCountedArchive(data);
      expect(entries[0].offset).toBe(2 + 10 * entries.length);
      for (let i = 1; i < entries.length; i++)
        expect(entries[i].offset).toBe(
          entries[i - 1].offset + entries[i - 1].size,
        );
      const last = entries[entries.length - 1];
      expect(last.offset + last.size).toBe(data.length);
    },
  );

  it("compte les ressources sprites : INT 30, DEC 20, OBJ 92, ANM 47", () => {
    const counts = Object.fromEntries(
      sprites.map((n) => [
        n,
        readCountedArchive(readOriginal(n)).entries.length,
      ]),
    );
    expect(counts).toEqual({
      "A1FANM.VGA": 47,
      "A1FDEC.VGA": 20,
      "A1FINT.VGA": 30,
      "A1FOBJ.VGA": 92,
    });
  });

  it.each(scenes)(
    "%s : les emplacements non vides se suivent dès l'octet 50 jusqu'à la fin du fichier",
    (name) => {
      const data = readOriginal(name);
      const { entries } = readSceneArchive(data);
      expect(entries[0].offset).toBe(50);
      for (let i = 1; i < entries.length; i++)
        expect(entries[i].offset).toBe(
          entries[i - 1].offset + entries[i - 1].size,
        );
      const last = entries[entries.length - 1];
      expect(last.offset + last.size).toBe(data.length);
    },
  );

  it("retrouve les ids de scènes connus (60 ressources, de 0 à 315)", () => {
    const ids = scenes.flatMap((n) =>
      readSceneArchive(readOriginal(n)).entries.map((e) => e.id),
    );
    expect(ids).toHaveLength(60);
    expect(new Set(ids).size).toBe(60);
    expect(ids.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(Math.max(...ids)).toBe(315);
  });
});
