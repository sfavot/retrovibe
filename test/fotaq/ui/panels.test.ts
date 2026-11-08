import { describe, expect, it, vi } from "vitest";
import { fetchGameFiles } from "../../../src/games/fotaq/data/files";
import { PANELS } from "../../../src/games/fotaq/ui/panels";
import { family } from "../../../src/games/fotaq/ui/viewer-data";
import { hasOriginalFiles, readManifest } from "../helpers";

describe("chargement du manifeste", () => {
  it("fetchGameFiles lit files.json sous la base de la visionneuse", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ path: "B1.PCX", size: 5 }, { path: "AND1.DOG", size: 9 }])));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const files = await fetchGameFiles("/fotaq");
      expect(fetchMock).toHaveBeenCalledWith("/fotaq/files.json");
      expect(files.list()).toEqual(["AND1.DOG", "B1.PCX"]);
      expect(files.dialogs()).toEqual(["AND1"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("un manifeste absent est une erreur lisible", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    try {
      await expect(fetchGameFiles("/fotaq")).rejects.toThrow(/files\.json : HTTP 404/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("panneaux", () => {
  const wants = (path: string) => PANELS.some((panel) => panel.matches({ path, size: 1 }, new Uint8Array(1)));

  it("chaque famille de fichiers a un panneau, les autres tombent sur l'hexadécimal", () => {
    for (const path of ["B1.PCX", "JOE_A.BBK", "AMAZON.ACT", "T26A.SAM", "B1.MSK", "B1.LUM", "QUEEN.JAS", "QUEEN2.JAS", "AND1.DOG", "C21A.CUT", "CREDIT1.CRD", "DATA", "voices/020001P2.mp3", "AQ.RL", "AQBANK.MUS", "README-FOTAQ.txt"]) {
      expect(wants(path), path).toBe(true);
    }
    expect(wants("files.json")).toBe(false);
  });

  it("un seul panneau répond pour QUEEN.JAS et QUEEN2.JAS", () => {
    const matching = (path: string) => PANELS.filter((panel) => panel.matches({ path, size: 1 }, new Uint8Array(1)));
    expect(matching("QUEEN.JAS")).toHaveLength(1);
    expect(matching("QUEEN2.JAS")).toHaveLength(1);
    expect(matching("QUEEN.JAS")[0]).not.toBe(matching("QUEEN2.JAS")[0]);
  });
});

describe.skipIf(!hasOriginalFiles)("manifeste du jeu", () => {
  // `COVER.png` (jaquette de l'accueil, `scripts/fotaq-cover.mts`) n'est pas un fichier du jeu : la visionneuse ne l'ouvre pas.
  const manifest = readManifest().filter((entry) => entry.path !== "COVER.png");

  it("tous les fichiers du manifeste ont un panneau, sauf files.json et la jaquette", () => {
    expect(manifest).toHaveLength(7671);
    for (const entry of manifest) {
      expect(
        PANELS.some((panel) => panel.matches(entry, new Uint8Array(0))),
        entry.path,
      ).toBe(true);
      expect(family(entry.path), entry.path).not.toBe("");
    }
  });
});
