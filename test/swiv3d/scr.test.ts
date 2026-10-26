import { describe, expect, it } from "vitest";
import { parseScr } from "../../src/games/swiv3d/data/scr";
import { hasOriginalFiles, readOriginal } from "./helpers";

const text = (s: string) => new TextEncoder().encode(s);

describe("parseScr", () => {
  it("lit six entiers et deux lettres, quel que soit l'espacement", () => {
    expect(parseScr(text("22 2 270 367 24 9 b l\r\n\n200 0 5 313 10 10   g l"))).toEqual([
      { values: [22, 2, 270, 367, 24, 9], codes: ["b", "l"] },
      { values: [200, 0, 5, 313, 10, 10], codes: ["g", "l"] },
    ]);
  });

  it("refuse une ligne mal formée", () => {
    expect(() => parseScr(text("1 2 3"))).toThrow(/ligne 1/);
    expect(() => parseScr(text("1 2 3 4 5 x b l"))).toThrow(/invalide/);
  });
});

describe.skipIf(!hasOriginalFiles)("fichiers .SCR de SWIV 3D (fichiers du jeu)", () => {
  const files = [0, 1, 2, 3].map((n) => parseScr(readOriginal(`ANIMS/BR_TER${n}.SCR`)));

  it("compte 6, 6, 6 et 5 lignes", () => {
    expect(files.map((f) => f.length)).toEqual([6, 6, 6, 5]);
  });

  it("commence chaque fichier par la ligne « 200 0 … g »", () => {
    expect(files[0]![0]).toEqual({ values: [200, 0, 108, 367, 295, 370], codes: ["g", "r"] });
    expect(files[1]![0]).toEqual({ values: [200, 0, 5, 313, 10, 10], codes: ["g", "l"] });
    expect(files[2]![0]).toEqual({ values: [200, 0, 5, 306, 10, 10], codes: ["g", "l"] });
    expect(files[3]![0]).toEqual({ values: [200, 0, 5, 258, 10, 10], codes: ["g", "l"] });
    expect(files[0]![1]).toEqual({ values: [22, 2, 270, 367, 24, 9], codes: ["b", "l"] });
  });
});
