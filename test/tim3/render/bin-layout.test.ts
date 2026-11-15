import { describe, expect, it } from "vitest";
import { BIN_CLIP, BIN_VIEW, binLayout, binScrollStep, type RenderAssets } from "../../../src/games/tim3/render";
import type { Part } from "../../../src/games/tim3/engine/part";

/** Icônes factices : type → largeur × hauteur. */
const SIZES: Record<number, [number, number]> = { 1: [40, 50], 2: [20, 30], 3: [56, 60] };
const assets = { binIcon: (t: number) => (SIZES[t] ? { width: SIZES[t]![0], height: SIZES[t]![1] } : null) } as unknown as RenderAssets;
const parts = (...types: number[]) => types.map((type) => ({ type }) as Part);
const BIN = parts(1, 1, 2, 3, 3, 3, 2, 1);

describe("mise en page du bac (417264)", () => {
  it("cases empilées depuis (8, 8), + 16 avec le nombre ; colonne suivante quand y + h + 8 ≥ 247 ; icônes centrées dans la colonne", () => {
    const l = binLayout(assets, BIN, 0);
    expect(l.total).toBe(5);
    expect(l.columns).toEqual([8, 80]);
    // Contenu : 8 + 72 + 56 = 136, fenêtre de 80.
    expect(l.maxScroll).toBe(56);
    expect(l.slots.map((s) => [s.type, s.parts.length, s.iconX - BIN_VIEW.x, s.iconY - BIN_VIEW.y])).toEqual([
      [1, 2, 24, 8],
      [2, 1, 34, 74],
      [3, 3, 16, 120],
      [2, 1, 34, 196],
    ]);
    // Zone de prise : colonne entière (72) × icône + 16, rognée à l'intérieur du cadre.
    expect(l.slots[0]).toMatchObject({ x: BIN_VIEW.x + 8, y: BIN_VIEW.y + 8, width: BIN_CLIP.x + BIN_CLIP.width - BIN_VIEW.x - 8, height: 66 });
  });

  it("sans nombre (Labo) : + 4 seulement, colonnes plus étroites", () => {
    const l = binLayout(assets, BIN, 0, false);
    expect(l.columns).toEqual([8, 68]);
    expect(l.maxScroll).toBe(112 - 80);
    expect(l.slots.map((s) => s.iconY - BIN_VIEW.y)).toContain(160);
  });

  it("défilement : borné à [0, contenu − 80], une flèche cale la colonne voisine à la marge", () => {
    const l0 = binLayout(assets, BIN, 0);
    expect(binScrollStep(l0, -1)).toBe(0);
    const right = binScrollStep(l0, 1);
    expect(right).toBe(56);
    const l1 = binLayout(assets, BIN, right);
    // La première colonne dépasse encore de 20 pixels à gauche ; la seconde est rognée au cadre (636).
    expect(l1.slots.map((s) => [s.type, s.iconX - BIN_VIEW.x, s.x - BIN_VIEW.x, s.width])).toEqual([
      [1, -32, 4, 20],
      [2, -22, 4, 20],
      [3, -40, 4, 20],
      [2, -22, 4, 20],
      [1, 32, 24, 52],
    ]);
    expect(binScrollStep(l1, 1)).toBe(56);
    expect(binScrollStep(l1, -1)).toBe(0);
    expect(binLayout(assets, BIN, 999).scroll).toBe(56);
    expect(binLayout(assets, BIN, -5).scroll).toBe(0);
  });

  it("une case qui se vide disparaît et les suivantes remontent ; un type sans icône n'a pas de case", () => {
    const l = binLayout(assets, parts(1, 2, 3), 0);
    const without = binLayout(assets, parts(1, 3, 9), 0);
    expect(without.slots.map((s) => [s.type, s.iconY - BIN_VIEW.y])).toEqual([
      [1, 8],
      [3, 74],
    ]);
    expect(l.slots).toHaveLength(3);
  });
});
