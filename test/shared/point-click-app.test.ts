import { describe, expect, it } from "vitest";
import { sumSizes } from "../../src/ui/point-click-app";

describe("sumSizes (progression du chargement)", () => {
  const sizes = new Map([
    ["A.BIN", 100],
    ["B.BIN", 50],
  ]);
  const files = { size: (path: string) => sizes.get(path) };

  it("additionne les tailles des fichiers demandés", () => {
    expect(sumSizes(files, ["A.BIN", "B.BIN"])).toBe(150);
  });

  it("compte un fichier inconnu pour zéro et une liste vide pour zéro", () => {
    expect(sumSizes(files, ["A.BIN", "ABSENT.BIN"])).toBe(100);
    expect(sumSizes(files, [])).toBe(0);
  });
});
