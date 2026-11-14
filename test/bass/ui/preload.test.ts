import { describe, expect, it } from "vitest";
import { GameFiles } from "../../../src/data/game-files";
import { FileStore } from "../../../src/ui/file-store";
import { MissingFilesError } from "../../../src/ui/files";
import { baseFiles, bassDataFrom, createVoiceFiles, loadBassData, voiceFile } from "../../../src/games/bass/ui/preload";
import { originalFiles } from "../../support/original";
import { hasOriginalFiles } from "../data/helpers";

const original = originalFiles("bass", "sky.dnr");
const entries = (sizes: Record<string, number>) => Object.entries(sizes).map(([path, size]) => ({ path, size }));
const complete = { "sky.dsk": 100, "sky.dnr": 20, "sky.cpt": 30, "README-BASS.txt": 5, "COVER.png": 2, "voices/50007.mp3": 9, "voices/50011.mp3": 8 };
const bytes = (path: string) => new TextEncoder().encode(path);

describe("baseFiles", () => {
  it("sky.dsk, sky.dnr et sky.cpt ; ni les voix, ni le README, ni la jaquette", () => {
    expect(baseFiles(new GameFiles(entries(complete)))).toEqual(["sky.dsk", "sky.dnr", "sky.cpt"]);
  });

  it("casse indifférente", () => {
    expect(baseFiles(new GameFiles(entries({ "SKY.DSK": 1, "Sky.Dnr": 1, "sky.CPT": 1 })))).toHaveLength(3);
  });

  it("fichiers manquants : MissingFilesError qui les nomme", () => {
    const { "sky.dnr": _dnr, "sky.cpt": _cpt, ...rest } = complete;
    expect(() => baseFiles(new GameFiles(entries(rest)))).toThrow(MissingFilesError);
    expect(() => baseFiles(new GameFiles(entries(rest)))).toThrow("sky.dnr, sky.cpt");
    expect(() => baseFiles(new GameFiles([]))).toThrow(MissingFilesError);
  });

  it.skipIf(!hasOriginalFiles)("sur les vrais fichiers : 13 à 14 Mo au départ, voix à part", () => {
    const files = new GameFiles(original.manifest() ?? []);
    const total = baseFiles(files).reduce((sum, path) => sum + (files.size(path) ?? 0), 0);
    expect(total).toBeGreaterThan(13_000_000);
    expect(total).toBeLessThan(14_500_000);
    expect(files.has(voiceFile(50007))).toBe(true);
    expect(files.has("README-BASS.txt")).toBe(true);
  });
});

describe("loadBassData", () => {
  it("un fichier absent du manifeste : MissingFilesError, rien n'est demandé", async () => {
    let calls = 0;
    await expect(loadBassData(new GameFiles(entries({ "sky.dsk": 1 })), async () => (calls++, new Uint8Array(1)))).rejects.toThrow(MissingFilesError);
    expect(calls).toBe(0);
  });

  it("charge les trois fichiers avec une progression de 0 à 1 ; un fichier illisible lève une erreur claire", async () => {
    const requested: string[] = [];
    const progress: number[] = [];
    await expect(
      loadBassData(
        new GameFiles(entries(complete)),
        async (path) => (requested.push(path), bytes(path)),
        (fraction) => progress.push(fraction),
      ),
    ).rejects.toThrow(/sky\.dnr invalide/);
    expect(requested.sort()).toEqual(["sky.cpt", "sky.dnr", "sky.dsk"]);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
  });

  it("un fichier en 404 : l'erreur du chargeur remonte", async () => {
    await expect(
      loadBassData(new GameFiles(entries(complete)), async (path) => {
        if (path === "sky.cpt") throw new MissingFilesError("sky.cpt : HTTP 404");
        return bytes(path);
      }),
    ).rejects.toThrow("HTTP 404");
  });

  it.skipIf(!hasOriginalFiles)("sur les vrais fichiers : le disque et les compacts s'ouvrent", async () => {
    const files = new GameFiles(original.manifest() ?? []);
    const data = await loadBassData(files, async (path) => new Uint8Array(original.read(path)));
    expect(data.disk.fileCount).toBeGreaterThan(1000);
    expect(data.cpt.raw.length).toBeGreaterThan(0);
  });
});

describe("bassDataFrom", () => {
  it("un fichier absent de la mémoire lève une erreur", () => {
    expect(() => bassDataFrom(new FileStore())).toThrow("introuvable");
  });
});

describe("createVoiceFiles : voix à la demande", () => {
  const files = new GameFiles(entries(complete));

  it("has suit la liste du manifeste (les répliques sans voix n'y sont pas)", () => {
    const voices = createVoiceFiles(files, async () => new Uint8Array());
    expect(voices.has(50007)).toBe(true);
    expect(voices.has(50011)).toBe(true);
    expect(voices.has(50012)).toBe(false);
  });

  it("load lit voices/<id>.mp3 sous le dossier du jeu, un fichier à la fois, sans garder les octets", async () => {
    const requested: string[] = [];
    const voices = createVoiceFiles(files, async (path) => (requested.push(path), bytes(path)));
    expect(new TextDecoder().decode(await voices.load(50007))).toBe("voices/50007.mp3");
    await voices.load(50007);
    expect(requested).toEqual(["voices/50007.mp3", "voices/50007.mp3"]);
  });

  it("une voix absente : promesse rejetée (la réplique se passe du son)", async () => {
    await expect(createVoiceFiles(files, async () => new Uint8Array()).load(50012)).rejects.toThrow("introuvable");
  });
});
