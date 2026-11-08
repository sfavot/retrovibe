import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GameFiles } from "../../../src/games/drascula/data/files";
import { FileStore } from "../../../src/ui/file-store";
import { ChapterLoader, CHAPTER_VIDEOS, baseFiles, chapterVideos } from "../../../src/games/drascula/ui/preload";
import { hasOriginalFiles, readManifest } from "../helpers";

const SRC = join(import.meta.dirname, "../../../src/games/drascula");

/** Tous les fichiers `.ts` sous `dir`. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
  });
}

/** Noms de vidéos (`"xxx.bin"`) cités par les sources du dossier `dir`. */
function videoNames(dir: string): Set<string> {
  const names = new Set<string>();
  for (const file of sources(dir)) for (const match of readFileSync(file, "utf8").matchAll(/"([a-z0-9_]+\.bin)"/gi)) names.add(match[1].toLowerCase());
  return names;
}

const entries = (sizes: Record<string, number>) => Object.entries(sizes).map(([path, size]) => ({ path, size }));
const bytes = (path: string) => new TextEncoder().encode(path);

describe("vidéos par chapitre", () => {
  it("les cinématiques communes (cinematics/) sont dans le chapitre qui les joue", () => {
    const found = videoNames(join(SRC, "cinematics"));
    const all = new Set(Object.values(CHAPTER_VIDEOS).flat());
    for (const name of found) expect(all.has(name), name).toBe(true);
  });

  it.each([1, 2, 3, 4, 5, 6])("les vidéos des pièces du chapitre %i (engine/rooms/chapter-N/) sont préchargées avec lui", (chapter) => {
    const found = videoNames(join(SRC, `engine/rooms/chapter-${chapter}`));
    for (const name of found) expect(CHAPTER_VIDEOS[chapter], name).toContain(name);
  });

  it("l'introduction du jeu, le château du chapitre 4 et le chapitre 6 : les vidéos de `sequences.ts` sont dans leur chapitre", () => {
    const sequences = readFileSync(join(SRC, "cinematics/sequences.ts"), "utf8");
    // introduction (chapitre 1)
    for (const name of ["logoddm.bin", "logoalc.bin", "scrollb.bin", "scr2.bin", "scr3.bin", "intro.bin", "lib.bin", "lib2.bin", "frel.bin", "frel2.bin", "rayo1.bin", "rayo2.bin"]) {
      expect(sequences).toContain(`"${name}"`);
      expect(CHAPTER_VIDEOS[1]).toContain(name);
    }
    // chapitre 6 : manivelle, fumée, fin et générique
    for (const name of ["man.bin", "fum.bin", "fin.bin", "drf.bin", "qpc.bin", "crd.bin"]) {
      expect(sequences).toContain(`"${name}"`);
      expect(CHAPTER_VIDEOS[6]).toContain(name);
    }
  });

  it.skipIf(!hasOriginalFiles)("chaque vidéo listée existe dans les fichiers du jeu, et aucune n'est listée deux fois dans un chapitre", () => {
    const files = new GameFiles(readManifest());
    for (const chapter of Object.keys(CHAPTER_VIDEOS).map(Number)) {
      expect(chapterVideos(files, chapter)).toHaveLength(CHAPTER_VIDEOS[chapter].length);
      expect(new Set(CHAPTER_VIDEOS[chapter]).size).toBe(CHAPTER_VIDEOS[chapter].length);
    }
  });

  it.skipIf(!hasOriginalFiles)("toutes les vidéos du jeu sauf CDR.BIN (jamais lue) sont dans un chapitre", () => {
    const listed = new Set(Object.values(CHAPTER_VIDEOS).flat());
    const all = readManifest().filter((entry) => entry.path.toLowerCase().endsWith(".bin")).map((entry) => entry.path.toLowerCase());
    expect(all.filter((name) => !listed.has(name))).toEqual(["cdr.bin"]);
  });
});

describe("baseFiles", () => {
  it("drascula.dat, les fiches, les dialogues et toutes les images ; ni vidéos, ni voix, ni musique, ni jaquette", () => {
    const files = new GameFiles(entries({ "drascula.dat": 1, "14.ALD": 1, "OP_1.CAL": 1, "96.ALG": 1, "CIELO.ALG": 1, "LEV.BIN": 1, "5.ALS": 1, "track1.mp3": 1, "COVER.png": 1, "README-ALCACHOFA.txt": 1 }));
    expect(baseFiles(files).sort()).toEqual(["14.ALD", "96.ALG", "CIELO.ALG", "OP_1.CAL", "drascula.dat"].sort());
  });
});

describe("ChapterLoader", () => {
  const files = new GameFiles(entries({ "ST.BIN": 10, "UP.BIN": 10, "BIO.BIN": 10, "FREL.BIN": 10, "RAYO1.BIN": 10, "RAYO2.BIN": 10, "DET.BIN": 10 }));
  // les chapitres 1 et 6 ont des vidéos absentes du faux manifeste : on les remplace par un chargeur de test
  const make = (fetcher: (path: string) => Promise<Uint8Array>) => new ChapterLoader(new FileStore(), files, fetcher);

  it("un chapitre sans vidéo est prêt dès qu'on l'a demandé ; un chapitre au-delà du dernier l'est toujours", async () => {
    const loader = make(async (path) => bytes(path));
    expect(loader.ready(2)).toBe(false);
    await loader.ensure([2, 3]);
    expect(loader.ready(2)).toBe(true);
    expect(loader.ready(7)).toBe(true);
  });

  it("le moteur peut tourner dans un chapitre quand le sien et le suivant sont prêts", async () => {
    const loader = make(async (path) => bytes(path));
    await loader.prepare(2);
    expect(loader.runnable(2)).toBe(true);
    expect(loader.runnable(3)).toBe(false);
    await loader.prepare(3);
    expect(loader.runnable(3)).toBe(true);
    expect(ChapterLoader.needed(6)).toEqual([6]);
  });

  it("les vidéos d'un chapitre ne sont demandées qu'une fois, même demandées deux fois en même temps", async () => {
    const asked: string[] = [];
    const loader = make(async (path) => (asked.push(path), bytes(path)));
    await Promise.all([loader.prepare(3), loader.prepare(3), loader.prepare(4)]);
    // chapitres 3 + 4, puis 4 + 5 : chaque fichier une seule fois
    expect(asked.sort()).toEqual(["BIO.BIN", "DET.BIN", "FREL.BIN", "RAYO1.BIN", "RAYO2.BIN", "ST.BIN", "UP.BIN"]);
    expect(loader.runnable(3)).toBe(true);
    expect(loader.runnable(4)).toBe(true);
  });

  it("une vidéo déjà chargée par un autre chapitre n'est pas redemandée (frel, rayo1, rayo2 : chapitres 1 et 5)", async () => {
    const asked: string[] = [];
    const full = new GameFiles(entries(Object.fromEntries([...Object.values(CHAPTER_VIDEOS).flat()].map((name) => [name.toUpperCase(), 10]))));
    const loader = new ChapterLoader(new FileStore(), full, async (path) => (asked.push(path), bytes(path)));
    await loader.ensure([1]);
    asked.length = 0;
    await loader.ensure([5]);
    expect(asked).toEqual(["DET.BIN"]);
  });

  it("un échec ne rend pas le chapitre prêt, et on peut réessayer", async () => {
    let fail = true;
    const loader = make(async (path) => {
      if (fail) throw new Error("réseau");
      return bytes(path);
    });
    await expect(loader.prepare(4)).rejects.toThrow("réseau");
    expect(loader.ready(4)).toBe(false);
    fail = false;
    await loader.prepare(4);
    expect(loader.ready(4)).toBe(true);
  });
});
