import { describe, expect, it } from "vitest";
import { ImdDecoder, usedPaletteIndices } from "../../src/games/lost-in-time/data/imd";
import { hasOriginalFiles, ITK_FILES, loadArchive } from "./helpers";

describe.skipIf(!hasOriginalFiles)("IMD", () => {
  it("décode toutes les images de tous les films des ITK", () => {
    let movies = 0;
    let frames = 0;
    for (const file of ITK_FILES) {
      const archive = loadArchive(file);
      for (const entry of archive.entries) {
        if (!entry.name.toUpperCase().endsWith(".IMD")) continue;
        const decoder = new ImdDecoder(archive.extract(entry));
        // Plafond : un saut arrière pourrait sinon boucler.
        const limit = decoder.header.frameCount * 4 + 16;
        let calls = 0;
        while (calls++ < limit && decoder.decodeNextFrame()) frames++;
        movies++;
      }
    }
    expect(movies).toBeGreaterThan(0);
    expect(frames).toBeGreaterThan(movies);
  });
});

describe("usedPaletteIndices", () => {
  it("retourne null pour un film illisible (aucune restriction)", () => {
    expect(usedPaletteIndices(new Uint8Array(4))).toBeNull(); // film illisible
  });

  describe.skipIf(!hasOriginalFiles)("films du jeu", () => {
    it("MAGNA n'utilise que des index >= 128 (sa plage 16..127 est du filler)", () => {
      const archive = loadArchive("PARTIE3.ITK");
      const used = usedPaletteIndices(archive.get("MAGNA.IMD")!)!;
      expect(used.subarray(16, 128).every((v) => v === 0)).toBe(true);
      expect(used.subarray(128).some((v) => v === 1)).toBe(true);
    });

    it("un film plein écran couvre les index de sa palette de personnage", () => {
      const archive = loadArchive("PARTIE3.ITK");
      const used = usedPaletteIndices(archive.get("PARLYA.IMD")!)!;
      expect(used.subarray(16, 128).some((v) => v === 1)).toBe(true);
    });
  });
});
