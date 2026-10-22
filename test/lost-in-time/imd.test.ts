import { describe, expect, it } from "vitest";
import { ImdDecoder } from "../../src/games/lost-in-time/data/imd";
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
