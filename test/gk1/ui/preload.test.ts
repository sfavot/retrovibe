import { describe, expect, it } from "vitest";
import { GameFiles } from "../../../src/data/game-files";
import { ResourceType } from "../../../src/games/gk1/data/ids";
import { baseFiles, cdFiles, loadResources, patchFiles } from "../../../src/games/gk1/ui/preload";
import { MissingFilesError } from "../../../src/ui/files";
import { original, PATCH_FILES } from "../data/real";

const entries = (sizes: Record<string, number>) => Object.entries(sizes).map(([path, size]) => ({ path, size }));
const complete = { "RESOURCE.MAP": 10, "RESOURCE.000": 1000, "PATCHES/316.SND": 2, "PATCHES/803.SND": 2, "ALT.MAP": 5, "RESOURCE.ALT": 500, "SEQ/1.SEQ": 300, "MANUEL.pdf": 400, "BD.pdf": 400, "COVER.webp": 3, "voices/210/1-0-0-1.mp3": 9, VERSION: 50 };

describe("baseFiles", () => {
  it("la map, le volume, puis les patchs ; ni la haute résolution, ni les cinématiques, ni les voix, ni les PDF", () => {
    expect(baseFiles(new GameFiles(entries(complete)))).toEqual(["RESOURCE.MAP", "RESOURCE.000", "PATCHES/316.SND", "PATCHES/803.SND"]);
  });

  it("sans patch : la map et le volume suffisent", () => {
    const files = new GameFiles(entries({ "resource.map": 1, "Resource.000": 1 }));
    expect(patchFiles(files)).toEqual([]);
    expect(baseFiles(files)).toEqual(["resource.map", "Resource.000"]);
  });

  it("VERSION, que les scripts ouvrent, est chargé à part s'il est là", () => {
    expect(cdFiles(new GameFiles(entries(complete)))).toEqual([{ name: "VERSION", path: "VERSION" }]);
    expect(cdFiles(new GameFiles(entries({ "resource.map": 1, "Resource.000": 1, version: 50 })))).toEqual([{ name: "VERSION", path: "version" }]);
    expect(cdFiles(new GameFiles(entries({ "RESOURCE.MAP": 1, "RESOURCE.000": 1 })))).toEqual([]);
  });

  it("fichiers manquants : MissingFilesError qui les nomme", () => {
    const { "RESOURCE.000": _volume, ...rest } = complete;
    expect(() => baseFiles(new GameFiles(entries(rest)))).toThrow(MissingFilesError);
    expect(() => baseFiles(new GameFiles(entries(rest)))).toThrow("RESOURCE.000");
    expect(() => baseFiles(new GameFiles([]))).toThrow("RESOURCE.MAP, RESOURCE.000");
  });

  it.skipIf(!original.has)("sur les vrais fichiers : 13 à 14 Mo au départ, les deux patchs compris", () => {
    const files = new GameFiles(original.manifest() ?? []);
    const paths = baseFiles(files);
    expect(paths.slice(2)).toEqual(PATCH_FILES);
    const total = paths.reduce((sum, path) => sum + (files.size(path) ?? 0), 0);
    expect(total).toBeGreaterThan(13_000_000);
    expect(total).toBeLessThan(14_000_000);
  });
});

describe("loadResources", () => {
  it("un fichier qui ne se charge pas : l'erreur remonte", async () => {
    const files = new GameFiles(entries(complete));
    await expect(loadResources(files, async (path) => Promise.reject(new MissingFilesError(path)))).rejects.toThrow(MissingFilesError);
  });

  it.skipIf(!original.has)("charge la map, le volume, les patchs et VERSION avec la progression, et rend l'index, patchs appliqués", async () => {
    const files = new GameFiles(original.manifest() ?? []);
    const requested: string[] = [];
    const progress: number[] = [];
    const { resources: index, cdFiles: provided } = await loadResources(
      files,
      async (path) => (requested.push(path), original.read(path)),
      (fraction) => progress.push(fraction),
    );
    expect(requested.sort()).toEqual(["PATCHES/316.SND", "PATCHES/803.SND", "RESOURCE.000", "RESOURCE.MAP", "VERSION"]);
    expect(new TextDecoder().decode(provided.get("VERSION"))).toBe("1.000.000\r\nGabriel Knight French CD\r\nMay 3, 1994\r\n");
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
    expect(index.info(ResourceType.Script, 0)).toMatchObject({ isPatch: false, source: "RESOURCE.000" });
    expect(index.info(ResourceType.Sound, 316)).toMatchObject({ isPatch: true, source: "PATCHES/316.SND" });
    expect(index.info(ResourceType.Sound, 803)).toMatchObject({ isPatch: true, source: "PATCHES/803.SND" });
  });
});
