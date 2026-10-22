import { describe, expect, it } from "vitest";
import { parseFont } from "../../src/games/lost-in-time/data/font";
import { parseLic } from "../../src/games/lost-in-time/data/lic";
import { parseSnd } from "../../src/games/lost-in-time/data/snd";
import { createSurface } from "../../src/games/lost-in-time/data/surface";
import { hasOriginalFiles, loadArchive, readOriginal } from "./helpers";

describe.skipIf(!hasOriginalFiles)("LOST.LIC", () => {
  it("liste les pistes", () => {
    const tracks = parseLic(readOriginal("LOST.LIC"));
    expect(tracks).toHaveLength(348);
    expect(tracks[0]).toEqual({ name: "FIN8", startSector: 2, endSector: 5954 });
  });
});

describe.skipIf(!hasOriginalFiles)("polices et sons", () => {
  const archive = loadArchive("INTRO.STK");

  it("lit toutes les polices .LET", () => {
    const names = archive.entries.filter((e) => e.name.endsWith(".LET"));
    expect(names.length).toBeGreaterThan(0);
    for (const entry of names) {
      const font = parseFont(archive.extract(entry));
      const surface = createSurface(64, 32);
      font.drawString(surface, new TextEncoder().encode("Lost in Time"), 0, 0, 1, null);
      expect(surface.pixels.some((p) => p === 1), entry.name).toBe(true);
    }
  });

  it("lit tous les sons .SND", () => {
    const names = archive.entries.filter((e) => e.name.endsWith(".SND"));
    expect(names).toHaveLength(14);
    for (const entry of names) {
      const sound = parseSnd(archive.extract(entry));
      expect(sound.data.length, entry.name).toBeGreaterThan(0);
      expect(sound.frequency).toBeGreaterThanOrEqual(4700);
    }
  });
});
