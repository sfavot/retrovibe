import { describe, expect, it } from "vitest";
import { MIN_FOCUS_FONT_PX, textEntryLayout } from "../../../src/games/gk1/ui/text-entry";

/** Champ du nom dans la fenêtre « Sauvegarder » du jeu, sur l'écran de 320 × 200. */
const NAME_FIELD = { left: 37, top: 69, right: 198, bottom: 81 };

describe("champ de saisie posé sur celui du jeu", () => {
  it("téléphone tenu droit : la police reste à 16 px (pas de zoom de Safari), le champ réduit couvre celui du jeu", () => {
    // Canvas de 359 × 224 à (8, 268) dans une page de 375 px de large ; son parent commence en (8, 268).
    const layout = textEntryLayout({ left: 8, top: 268, width: 359, height: 224 }, { left: 8, top: 268 }, NAME_FIELD);
    expect(layout.fontSize).toBe(MIN_FOCUS_FONT_PX);
    expect(layout.scale).toBeCloseTo(12 / 16);
    // À l'écran (taille × réduction) : exactement le rectangle du champ du jeu.
    expect(layout.width * layout.scale).toBeCloseTo((161 * 359) / 320);
    expect(layout.height * layout.scale).toBeCloseTo((12 * 224) / 200);
    expect(layout.left).toBeCloseTo((37 * 359) / 320);
    expect(layout.top).toBeCloseTo((69 * 224) / 200);
  });

  it("grand écran : pas de réduction, le texte suit la hauteur du champ", () => {
    // Canvas de 960 × 600, centré dans un parent plus large.
    const layout = textEntryLayout({ left: 69, top: 16, width: 960, height: 600 }, { left: 40, top: 16 }, NAME_FIELD);
    expect(layout.scale).toBe(1);
    expect(layout.fontSize).toBeCloseTo(36 * 0.7);
    expect([layout.left, layout.top, layout.width, layout.height]).toEqual([29 + 37 * 3, 69 * 3, 161 * 3, 36]);
  });

  it("la police ne descend jamais sous 16 px, quelle que soit la taille du canvas", () => {
    for (const width of [160, 320, 359, 480, 616, 640, 960, 1280]) {
      const layout = textEntryLayout({ left: 0, top: 0, width, height: (width * 200) / 320 }, { left: 0, top: 0 }, NAME_FIELD);
      expect(layout.fontSize).toBeGreaterThanOrEqual(MIN_FOCUS_FONT_PX);
      expect(layout.fontSize * layout.scale).toBeGreaterThanOrEqual(12);
      expect(layout.width * layout.scale).toBeCloseTo((161 * width) / 320);
    }
  });
});
