import { describe, expect, it } from "vitest";
import { forceFactor } from "../../src/games/yoda/score";

const base = { seconds: 0, worldSize: 1, visitedSectors: 10, totalSectors: 10, difficulty: 100, solvedPuzzles: 5, totalPuzzles: 5, bonus: 0 };

describe("Force Factor", () => {
  it("vaut 1000 pour une partie parfaite et rapide", () => {
    expect(forceFactor(base)).toBe(1000);
  });

  it("retire 20 points par minute de retard sur 5 minutes par taille de monde", () => {
    expect(forceFactor({ ...base, seconds: 7 * 60, bonus: 0 })).toBe(1000 - 40);
    expect(forceFactor({ ...base, seconds: 60 * 60 })).toBe(800);
  });

  it("borne chaque composante et ajoute le tirage sous 1000", () => {
    const worst = { seconds: 3600, worldSize: 1, visitedSectors: 0, totalSectors: 10, difficulty: 0, solvedPuzzles: 0, totalPuzzles: 5, bonus: 8 };
    expect(forceFactor(worst)).toBe(0 + 10 + 40 + 30 + 8);
  });
});
