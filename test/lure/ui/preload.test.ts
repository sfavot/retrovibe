import { describe, expect, it } from "vitest";
import { GameFiles } from "../../../src/data/game-files";
import { FileStore } from "../../../src/ui/file-store";
import { MissingFilesError } from "../../../src/ui/files";
import { DAT_FILE_NAME, DISK_FILE_NAMES } from "../../../src/games/lure/data/container";
import { baseFiles, loadLureFiles, lureFilesFrom } from "../../../src/games/lure/ui/preload";
import { hasOriginalFiles } from "../data/helpers";
import { originalFiles } from "../../support/original";

const original = originalFiles("lure", DAT_FILE_NAME);
const entries = (sizes: Record<string, number>) => Object.entries(sizes).map(([path, size]) => ({ path, size }));
const complete = { "DISK1.VGA": 10, "DISK2.VGA": 20, "DISK3.VGA": 30, "DISK4.VGA": 40, "LURE-FR.DAT": 5, "LICENSE-LURE.txt": 1, "MANUEL.pdf": 1000, "COVER.png": 2 };
const bytes = (path: string) => new TextEncoder().encode(path);

describe("baseFiles", () => {
  it("les quatre disques et LURE-FR.DAT ; ni le manuel, ni la licence, ni la jaquette", () => {
    expect(baseFiles(new GameFiles(entries(complete)))).toEqual(["DISK1.VGA", "DISK2.VGA", "DISK3.VGA", "DISK4.VGA", "LURE-FR.DAT"]);
  });

  it("casse indifférente", () => {
    const files = new GameFiles(entries({ "disk1.vga": 1, "Disk2.VGA": 1, "DISK3.VGA": 1, "DISK4.VGA": 1, "lure-fr.dat": 1 }));
    expect(baseFiles(files)).toHaveLength(5);
  });

  it("fichiers manquants : MissingFilesError qui les nomme", () => {
    const { "DISK3.VGA": _d3, "LURE-FR.DAT": _dat, ...rest } = complete;
    expect(() => baseFiles(new GameFiles(entries(rest)))).toThrow(MissingFilesError);
    expect(() => baseFiles(new GameFiles(entries(rest)))).toThrow("DISK3.VGA, LURE-FR.DAT");
    expect(() => baseFiles(new GameFiles([]))).toThrow(MissingFilesError);
  });

  it.skipIf(!hasOriginalFiles)("sur les vrais fichiers : 2,5 à 3 Mo au départ, sans le manuel", () => {
    const files = new GameFiles(original.manifest() ?? []);
    const total = baseFiles(files).reduce((sum, path) => sum + (files.size(path) ?? 0), 0);
    expect(total).toBeGreaterThan(2_500_000);
    expect(total).toBeLessThan(3_000_000);
    expect(files.has("MANUEL.pdf")).toBe(true);
  });
});

describe("loadLureFiles", () => {
  it("charge tout, rend les disques dans l'ordre et le bloc de données, avec la progression", async () => {
    const files = new GameFiles(entries(complete));
    const requested: string[] = [];
    const progress: number[] = [];
    const result = await loadLureFiles(
      files,
      async (path) => (requested.push(path), bytes(path)),
      (fraction) => progress.push(fraction),
    );
    expect(requested.sort()).toEqual([...DISK_FILE_NAMES, DAT_FILE_NAME]);
    expect(result.disks.map((disk) => new TextDecoder().decode(disk))).toEqual([...DISK_FILE_NAMES]);
    expect(new TextDecoder().decode(result.dat)).toBe(DAT_FILE_NAME);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
  });

  it("un fichier absent du manifeste : MissingFilesError, rien n'est demandé", async () => {
    const files = new GameFiles(entries({ "DISK1.VGA": 1 }));
    let calls = 0;
    await expect(loadLureFiles(files, async () => (calls++, new Uint8Array(1)))).rejects.toThrow(MissingFilesError);
    expect(calls).toBe(0);
  });

  it("un fichier en 404 : l'erreur du chargeur remonte", async () => {
    const files = new GameFiles(entries(complete));
    await expect(
      loadLureFiles(files, async (path) => {
        if (path === "DISK2.VGA") throw new MissingFilesError("DISK2.VGA : HTTP 404");
        return bytes(path);
      }),
    ).rejects.toThrow("HTTP 404");
  });
});

describe("lureFilesFrom", () => {
  it("un fichier absent de la mémoire lève une erreur", () => {
    expect(() => lureFilesFrom(new FileStore())).toThrow("introuvable");
  });
});
