import { describe, expect, it } from "vitest";
import { GameFiles, baseName } from "../../src/data/game-files";

const files = new GameFiles([
  { path: "DATA/S36/S36E/S36A000S.HY8", size: 3 },
  { path: "MPC/PVG.MHK", size: 1 },
  { path: "DATA/S36/S36A/S36A000S.HY8", size: 2 },
  { path: "NIM.DAT", size: 4 },
]);

describe("baseName", () => {
  it("garde le dernier segment, avec / ou \\", () => {
    expect(baseName("a/b/c.dat")).toBe("c.dat");
    expect(baseName("a\\b\\c.dat")).toBe("c.dat");
    expect(baseName("c.dat")).toBe("c.dat");
  });
});

describe("GameFiles", () => {
  it("résout sans tenir compte de la casse", () => {
    expect(files.resolve("nim.dat")).toBe("NIM.DAT");
    expect(files.resolve("Pvg.Mhk")).toBe("MPC/PVG.MHK");
  });

  it("accepte un chemin complet, avec / ou \\", () => {
    expect(files.resolve("mpc/pvg.mhk")).toBe("MPC/PVG.MHK");
    expect(files.resolve("mpc\\pvg.mhk")).toBe("MPC/PVG.MHK");
    expect(files.resolve("data/s36/s36e/s36a000s.hy8")).toBe("DATA/S36/S36E/S36A000S.HY8");
  });

  it("renvoie undefined pour un nom inconnu", () => {
    expect(files.resolve("nope.dat")).toBeUndefined();
    expect(files.has("nope.dat")).toBe(false);
    expect(files.has("NIM.dat")).toBe(true);
  });

  it("départage les homonymes avec l'indice de dossier", () => {
    expect(files.resolve("s36a000s.hy8")).toBe("DATA/S36/S36A/S36A000S.HY8");
    expect(files.resolve("s36a000s.hy8", "S36E")).toBe("DATA/S36/S36E/S36A000S.HY8");
    expect(files.resolve("s36a000s.hy8", "zzz")).toBe("DATA/S36/S36A/S36A000S.HY8");
  });

  it("resolveAll renvoie tous les homonymes triés", () => {
    expect(files.resolveAll("S36A000S.hy8")).toEqual(["DATA/S36/S36A/S36A000S.HY8", "DATA/S36/S36E/S36A000S.HY8"]);
    expect(files.resolveAll("nope")).toEqual([]);
  });

  it("donne la taille et liste avec filtre", () => {
    expect(files.size("NIM.DAT")).toBe(4);
    expect(files.size("nim.dat")).toBeUndefined();
    expect(files.list()[0]).toBe("DATA/S36/S36A/S36A000S.HY8");
    expect(files.list((p) => p.endsWith(".DAT"))).toEqual(["NIM.DAT"]);
  });
});
