import { describe, expect, it } from "vitest";
import { Archive } from "../../src/games/lost-in-time/data/archive";
import { hasOriginalFiles, loadArchive } from "./helpers";

describe.skipIf(!hasOriginalFiles)("INTRO.STK", () => {
  it("décompresse toutes les entrées", () => {
    const archive = loadArchive("INTRO.STK");
    expect(archive.entries).toHaveLength(522);
    for (const entry of archive.entries) {
      const data = archive.extract(entry);
      expect(data.length, entry.name).toBeGreaterThan(0);
    }
  });

  it("trouve les fichiers sans tenir compte de la casse", () => {
    const archive = loadArchive("INTRO.STK");
    expect(archive.get("emam1000.tot")).toEqual(archive.get("EMAM1000.TOT"));
    expect(archive.get("absent.tot")).toBeUndefined();
  });
});

describe("Archive", () => {
  it("lit une entrée brute", () => {
    const file = new Uint8Array(2 + 22 + 3);
    file[0] = 1;
    file.set(new TextEncoder().encode("A.BIN"), 2);
    file[2 + 13] = 3; // taille
    file[2 + 17] = 24; // offset
    file.set([7, 8, 9], 24);
    expect(Array.from(new Archive(file).get("a.bin")!)).toEqual([7, 8, 9]);
  });
});
