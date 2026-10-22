import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GameFiles, extensionOf, type GameFileEntry } from "../../src/games/teleportaschtroumpf/data/files";

const manifestPath = resolve(import.meta.dirname, "../../original/teleportaschtroumpf/files.json");

const synthetic = new GameFiles([
  { path: "DATA/S36/S36E/S36A000S.HY8", size: 3 },
  { path: "DATA/S22/S22A/S22A001D.MCG", size: 1 },
  { path: "DATA/S36/S36A/S36A000S.HY8", size: 2 },
  { path: "DATA/S20/S20H/S20H", size: 4 },
  { path: "DATA/DESCRIPT.ION", size: 5 },
]);

describe("GameFiles (synthétique)", () => {
  it("résout sans tenir compte de la casse", () => {
    expect(synthetic.resolve("s22a001d.mcg")).toBe("DATA/S22/S22A/S22A001D.MCG");
    expect(synthetic.resolve("S22A001D.mcg")).toBe("DATA/S22/S22A/S22A001D.MCG");
    expect(synthetic.resolve("descript.ion")).toBe("DATA/DESCRIPT.ION");
    expect(synthetic.resolve("s20h")).toBe("DATA/S20/S20H/S20H");
  });

  it("renvoie undefined pour un nom inconnu", () => {
    expect(synthetic.resolve("nope.mcg")).toBeUndefined();
  });

  it("départage les homonymes avec l'indice de dossier", () => {
    expect(synthetic.resolve("s36a000s.hy8")).toBe("DATA/S36/S36A/S36A000S.HY8");
    expect(synthetic.resolve("s36a000s.hy8", "s36e")).toBe("DATA/S36/S36E/S36A000S.HY8");
    expect(synthetic.resolve("s36a000s.hy8", "zzz")).toBe("DATA/S36/S36A/S36A000S.HY8");
    expect(synthetic.resolveAll("S36A000S.HY8")).toHaveLength(2);
  });

  it("liste, filtre et regroupe les scènes", () => {
    expect(synthetic.list()[0]).toBe("DATA/DESCRIPT.ION");
    expect(synthetic.list((p) => extensionOf(p) === "HY8")).toHaveLength(2);
    expect(synthetic.scenes().map((s) => s.id)).toEqual(["s20", "s22", "s36"]);
    expect(synthetic.size("DATA/DESCRIPT.ION")).toBe(5);
  });
});

describe.skipIf(!existsSync(manifestPath))("GameFiles (manifeste réel)", () => {
  const entries = (existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : []) as GameFileEntry[];
  const files = new GameFiles(entries);

  it("résout un nom en minuscules vers son chemin rangé", () => {
    expect(files.resolve("s22a001d.mcg")).toBe("DATA/S22/S22A/S22A001D.MCG");
  });

  it("résout chaque fichier par son nom (le chemin renvoyé porte bien ce nom)", () => {
    for (const { path } of entries) {
      const found = files.resolve(path.slice(path.lastIndexOf("/") + 1).toLowerCase());
      expect(found?.split("/").pop()?.toLowerCase()).toBe(path.split("/").pop()?.toLowerCase());
    }
  });

  it("contient les scènes de DATA", () => {
    expect(files.scenes().length).toBeGreaterThan(30);
  });
});
