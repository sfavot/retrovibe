import { describe, expect, it } from "vitest";
import { GameFiles } from "../../src/games/mathemagique/data/files";
import { hasOriginalFiles, readManifest } from "./helpers";

const synthetic = new GameFiles([
  { path: "NIM.DAT", size: 10 },
  { path: "MPC/PVG.MHK", size: 20 },
  { path: "PATFILL.DAT", size: 30 },
]);

describe("GameFiles (données synthétiques)", () => {
  it("résout les noms sans tenir compte de la casse", () => {
    expect(synthetic.resolve("nim.DAT")).toBe("NIM.DAT");
    expect(synthetic.resolve("PatFill.DAT")).toBe("PATFILL.DAT");
    expect(synthetic.resolve("pvg.mhk")).toBe("MPC/PVG.MHK");
    expect(synthetic.resolve("mpc/PVG.mhk")).toBe("MPC/PVG.MHK");
    expect(synthetic.resolve("mpc\\pvg.mhk")).toBe("MPC/PVG.MHK");
    expect(synthetic.resolve("absent.dat")).toBeUndefined();
  });

  it("donne les tailles et filtre la liste triée", () => {
    expect(synthetic.size("NIM.DAT")).toBe(10);
    expect(synthetic.list()).toEqual(["MPC/PVG.MHK", "NIM.DAT", "PATFILL.DAT"]);
    expect(synthetic.list((path) => path.endsWith(".DAT"))).toEqual(["NIM.DAT", "PATFILL.DAT"]);
  });
});

describe.skipIf(!hasOriginalFiles)("files.json du jeu", () => {
  it("résout les noms demandés par l'EXE", () => {
    const files = new GameFiles(readManifest());
    expect(files.resolve("nim.DAT")).toBe("NIM.DAT");
    expect(files.resolve("PatFill.DAT")).toBe("PATFILL.DAT");
    expect(files.resolve("milkyway.dat")).toBe("MILKYWAY.DAT");
    expect(files.resolve("pvg.mhk")).toBe("MPC/PVG.MHK");
  });
});
