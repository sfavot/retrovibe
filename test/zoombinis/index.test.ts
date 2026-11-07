import { describe, expect, it } from "vitest";
import { copy } from "../../src/games/zoombinis/copy";
import { zoombinis } from "../../src/games/zoombinis/index";

// Pas de DOM dans l'environnement de test : on vérifie la définition du jeu (carte d'accueil) et la copy, pas l'écran de présentation.
describe("Zoombinis : définition du jeu", () => {
  it("décrit la carte d'accueil avec la jaquette 640 × 480", () => {
    expect(zoombinis.id).toBe("zoombinis");
    expect(zoombinis.title).toBe(copy.title);
    expect(zoombinis.description).toBe(copy.description);
    expect(zoombinis.cover).toMatch(/zoombinis\/COVER\.png$/);
    expect(zoombinis.coverSize).toEqual([640, 480]);
    expect(zoombinis.coverAlt).toBe(copy.coverAlt);
  });

  it("a une copy complète pour le shell", () => {
    for (const key of ["canvasLabel", "sound", "loading", "loadError", "runtimeError", "missingFiles"] as const) {
      expect(copy[key].length).toBeGreaterThan(0);
    }
    expect(copy.controls.length).toBeGreaterThan(0);
  });
});
