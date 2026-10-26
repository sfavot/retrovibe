import { describe, expect, it } from "vitest";
import { parseBd } from "../../src/games/swiv3d/data/bd";
import { parseMissions } from "../../src/games/swiv3d/data/missions";
import { hasOriginalFiles, readOriginal } from "./helpers";

describe.skipIf(!hasOriginalFiles)("script des missions de GLOBAL.BD (fichier du jeu)", () => {
  const script = parseMissions(parseBd(readOriginal("GLOBAL.BD"), "GLOBAL.BD"));

  it("décrit 17 missions, dont les quatre niveaux livrés", () => {
    expect(script.elements).toHaveLength(189);
    expect(script.missions).toHaveLength(17);
    expect(script.missions.slice(0, 4).map((m) => m.level)).toEqual(["TERRAN00", "TERRAN01", "TERRAN02", "TERRAN03"]);
    expect(script.missions.map((m) => m.index)).toEqual(Array.from({ length: 17 }, (_, i) => i));
    expect(script.missions[16]!.level).toBe("MARS05");
  });

  it("lit les vidéos, pistes, couleurs et variables", () => {
    const first = script.missions[0]!;
    expect(first.videos).toEqual(["BR_TER0"]);
    expect(first.tracks).toEqual([3, 9, 2, 0, 0, 0]);
    expect(first.color).toEqual([100, 100, 120]);
    expect(first.elements[5]).toEqual({ kind: "variable", operation: "set", variable: 1, value: 496 });
    expect(script.missions[1]!.elements).toContainEqual({ kind: "variable", operation: "max", variable: 1, value: 248 });
    expect(script.missions.map((m) => m.videos).flat()).toContain("END_TER");
    expect(script.missions[16]!.videos).toEqual(["OUTRO"]);
  });

  it("sépare la chaîne jouée du reste, accessible par le menu", () => {
    expect(script.elements[script.chainEnd]).toEqual({ kind: "end" });
    expect(script.elements[script.chainEnd - 1]).toEqual({ kind: "complete" });
    expect(script.chainEnd).toBe(46);
  });
});
