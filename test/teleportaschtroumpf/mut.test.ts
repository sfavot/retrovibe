import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MUT_TILE_HEIGHT, MUT_TILE_WIDTH, parseMut, parsePrc } from "../../src/games/teleportaschtroumpf/data/mut";
import { hasOriginalFiles, listData, readData, withExtension } from "./helpers";

const sha = (bytes: Uint8Array) => createHash("sha1").update(bytes).digest("hex");

describe("MUT / PRC : données invalides", () => {
  it("refuse un PRC de longueur impaire", () => {
    expect(() => parsePrc(new Uint8Array(5))).toThrow(/PRC invalide/);
  });

  it("lit un PRC vide ou court", () => {
    expect(parsePrc(new Uint8Array(0))).toEqual([]);
    expect(parsePrc(Uint8Array.of(6, 0, 1, 1))).toEqual([6, 257]);
  });

  it("lit un MUT vide", () => {
    expect(parseMut(new Uint8Array(0)).tiles).toEqual([]);
  });

  it("refuse un en-tête d'enregistrement tronqué", () => {
    expect(() => parseMut(Uint8Array.of(1, 0, 4, 0))).toThrow(/en-tête d'enregistrement tronqué/);
  });

  it("refuse un enregistrement dont la taille dépasse le fichier", () => {
    expect(() => parseMut(Uint8Array.of(1, 0, 100, 0, 0, 0, 4, 0, 0))).toThrow(/tronqué/);
  });

  it("refuse un enregistrement dont le contenu vidéo est tronqué", () => {
    expect(() => parseMut(Uint8Array.of(1, 0, 3, 0, 0, 0, 4, 0, 0))).toThrow();
  });
});

describe.skipIf(!hasOriginalFiles)("MUT / PRC des fichiers originaux", () => {
  const muts = listData(withExtension("MUT")).filter((path) => path.startsWith("S36/"));
  const prcs = listData(withExtension("PRC")).filter((path) => path.startsWith("S36/"));

  it("décode les 8 MUT, tronçons de 320x140", () => {
    expect(muts).toHaveLength(8);
    for (const path of muts) {
      const { tiles } = parseMut(readData(path));
      expect(tiles.length, path).toBeGreaterThanOrEqual(9);
      for (const tile of tiles) {
        expect(tile.pixels, path).toHaveLength(MUT_TILE_WIDTH * MUT_TILE_HEIGHT);
        expect(tile.flags, path).toBeGreaterThan(0);
      }
    }
  });

  it("chaque PRC ne référence que des tronçons de son MUT", () => {
    expect(prcs).toHaveLength(8);
    for (const prcPath of prcs) {
      const tiles = parseMut(readData(prcPath.replace(/\.PRC$/, ".MUT"))).tiles;
      const sequence = parsePrc(readData(prcPath));
      expect(sequence.length, prcPath).toBeGreaterThan(30);
      for (const index of sequence) expect(index, prcPath).toBeLessThan(tiles.length);
    }
  });

  it("S36E : 11 tronçons, masques et pixels exacts", () => {
    const { tiles } = parseMut(readData("S36/S36E/S36E.MUT"));
    expect(tiles.map((tile) => tile.flags)).toEqual([1, 1, 1, 4, 66, 136, 16, 36, 36, 20, 20]);
    expect(sha(tiles[0].pixels)).toBe("2f785b49a740a22f7a280b7a38ef59bed9646fe9");
    expect(sha(tiles[10].pixels)).toBe("0e85ff9434134792343036d11d931eeac92cbb87");
  });

  it("S36E : parcours de 59 tronçons", () => {
    const sequence = parsePrc(readData("S36/S36E/S36E.PRC"));
    expect(sequence).toHaveLength(59);
    expect(sequence.slice(0, 10)).toEqual([0, 6, 7, 4, 9, 5, 8, 3, 4, 10]);
    expect(sequence.slice(-5)).toEqual([8, 3, 3, 3, 3]);
  });

  it("S36G et S36K ont le même MUT et des PRC différents", () => {
    expect(readData("S36/S36G/S36G.MUT")).toEqual(readData("S36/S36K/S36K.MUT"));
    expect(parsePrc(readData("S36/S36G/S36G.PRC"))).not.toEqual(parsePrc(readData("S36/S36K/S36K.PRC")));
  });
});
