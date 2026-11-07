import { describe, expect, it, vi } from "vitest";
import { fetchGameFiles } from "../../../src/games/drascula/data/files";
import { PANELS, readAld } from "../../../src/games/drascula/ui/panels";
import { family } from "../../../src/games/drascula/ui/viewer-data";
import { byExtension, hasOriginalFiles, listOriginal, readManifest, readOriginal } from "../helpers";

describe("chargement du manifeste", () => {
  it("fetchGameFiles lit files.json sous la base de la visionneuse", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ path: "2.ALD", size: 5 }, { path: "1.ALG", size: 9 }])));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const files = await fetchGameFiles("/drascula");
      expect(fetchMock).toHaveBeenCalledWith("/drascula/files.json");
      expect(files.list()).toEqual(["1.ALG", "2.ALD"]);
      expect(files.rooms()).toEqual([2]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("un manifeste absent est une erreur lisible", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    try {
      await expect(fetchGameFiles("/drascula")).rejects.toThrow(/files\.json : HTTP 404/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("panneaux", () => {
  it("chaque famille de fichiers a un panneau, les autres tombent sur l'hexadécimal", () => {
    const wants = (path: string) => PANELS.some((panel) => panel.matches({ path, size: 1 }, new Uint8Array(1)));
    for (const path of ["1.ALG", "FIN.BIN", "14.ALD", "OP_1.CAL", "drascula.dat", "214.ALS", "track1.mp3", "README-ALCACHOFA.txt"]) {
      expect(wants(path), path).toBe(true);
    }
    expect(wants("files.json")).toBe(false);
    expect(wants("DOS4GW.EXE")).toBe(false);
  });
});

describe.skipIf(!hasOriginalFiles)("manifeste du jeu", () => {
  const manifest = readManifest();

  it("tous les fichiers du manifeste ont un panneau et un groupe nommé", () => {
    expect(manifest).toHaveLength(1147);
    for (const entry of manifest) {
      expect(
        PANELS.some((panel) => panel.matches(entry, new Uint8Array(0))),
        entry.path,
      ).toBe(true);
    }
    const dataGroup = manifest.filter((entry) => family(entry.path) === "Données et textes").map((entry) => entry.path);
    expect(dataGroup.sort()).toEqual(["README-ALCACHOFA-INT.txt", "README-ALCACHOFA.txt", "drascula-dat-LICENSE.txt", "drascula.dat"].sort());
  });

  it("les 57 fiches .ALD se lisent dans leur disposition de chapitre (2 pour 17 d'entre elles)", () => {
    const names = listOriginal(byExtension("ALD"));
    const chapters = names.map((name) => readAld(readOriginal(name)).chapter);
    expect(names).toHaveLength(57);
    expect(chapters.filter((chapter) => chapter === 2)).toHaveLength(17);
  });
});
