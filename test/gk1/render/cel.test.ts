import { describe, expect, it } from "vitest";
import { PALETTE_COLORS, type Palette } from "../../../src/games/gk1/data/palette";
import { type Cel, drawCel, readCelPixel } from "../../../src/games/gk1/render/cel";
import { GamePalette } from "../../../src/games/gk1/render/palette";
import { clipRect, isEmptyRect, makeRect, rectContains } from "../../../src/games/gk1/render/rect";

const SKIP = 9;

function cel(width: number, rows: number[][], extra: Partial<Cel> = {}): Cel {
  return { width, height: rows.length, originX: 0, originY: 0, skipColor: SKIP, mirrored: false, hasRemap: false, pixels: Uint8Array.from(rows.flat()), palette: undefined, ...extra };
}

/** Dessine dans une cible de 8×4 remplie de 0 et rend ses lignes. */
function draw(source: Cel, x: number, y: number, mirrored = false, scaleX = 128, scaleY = 128, clip = makeRect(0, 0, 8, 4)): number[][] {
  const target = new Uint8Array(8 * 4);
  drawCel(target, 8, source, clip, x, y, mirrored, scaleX, scaleY);
  return [0, 1, 2, 3].map((row) => [...target.subarray(row * 8, row * 8 + 8)]);
}

function palette(colors: Record<number, [number, number, number]>): Palette {
  const used = new Uint8Array(PALETTE_COLORS);
  const rgb = new Uint8Array(PALETTE_COLORS * 3);
  for (const [index, color] of Object.entries(colors)) {
    used[Number(index)] = 1;
    rgb.set(color, 3 * Number(index));
  }
  return { start: 0, count: PALETTE_COLORS, sharedUsed: false, version: 0, used, rgb, byteLength: 0 };
}

describe("dessin d'un cel", () => {
  const image = cel(3, [
    [1, 2, 3],
    [4, SKIP, 6],
  ]);

  it("pose le cel, saute la couleur transparente et respecte le rectangle de découpe", () => {
    expect(draw(image, 2, 1)).toEqual([
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 2, 3, 0, 0, 0],
      [0, 0, 4, 0, 6, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
    ]);
    // Débordement à gauche et en haut : seule la partie dans la cible est écrite.
    expect(draw(image, -1, -1)[0].slice(0, 3)).toEqual([0, 6, 0]);
    expect(draw(image, 2, 1, false, 128, 128, makeRect(3, 1, 4, 3))).toEqual([
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 2, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
    ]);
  });

  it("retourne le cel horizontalement", () => {
    expect(draw(image, 2, 1, true).slice(1, 3)).toEqual([
      [0, 0, 3, 2, 1, 0, 0, 0],
      [0, 0, 6, 0, 4, 0, 0, 0],
    ]);
  });

  it("agrandit et réduit : le pixel cible x lit la colonne ⌊x × 128 / échelle⌋ − ⌊gauche × 128 / échelle⌋", () => {
    const line = cel(4, [[1, 2, 3, 4]]);
    expect(draw(line, 0, 0, false, 256, 128, makeRect(0, 0, 8, 1))[0]).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(draw(line, 0, 0, true, 256, 128, makeRect(0, 0, 8, 1))[0]).toEqual([4, 4, 3, 3, 2, 2, 1, 1]);
    expect(draw(line, 0, 0, false, 64, 128, makeRect(0, 0, 2, 1))[0].slice(0, 3)).toEqual([1, 3, 0]);
    // Grille attachée à l'écran : posé en 1, le cel réduit de moitié montre les colonnes ⌊1 × 2⌋ − ⌊1 × 2⌋ = 0 puis 2.
    expect(draw(line, 1, 0, false, 64, 128, makeRect(1, 0, 3, 1))[0].slice(0, 4)).toEqual([0, 1, 3, 0]);
    // En hauteur aussi.
    const column = cel(1, [[1], [2]]);
    expect(draw(column, 0, 0, false, 128, 256).map((row) => row[0])).toEqual([1, 1, 2, 2]);
  });

  it("un cel aux couleurs de remplacement ne dessine rien à partir de 236", () => {
    const remap = cel(4, [[5, 236, 254, 255]], { hasRemap: true });
    expect(draw(remap, 0, 0)[0].slice(0, 4)).toEqual([5, 0, 0, 0]);
    expect(draw(cel(4, [[5, 236, 254, 255]]), 0, 0)[0].slice(0, 4)).toEqual([5, 236, 254, 255]);
  });

  it("lit un pixel, à l'endroit ou retourné", () => {
    expect(readCelPixel(image, 0, 1, false)).toBe(4);
    expect(readCelPixel(image, 0, 1, true)).toBe(6);
    expect(readCelPixel(image, 1, 1, false)).toBe(SKIP);
    expect(readCelPixel(image, 3, 0, false)).toBeUndefined();
    expect(readCelPixel(image, 0, -1, false)).toBeUndefined();
  });
});

describe("rectangles", () => {
  it("bords droit et bas exclus", () => {
    expect(clipRect(makeRect(-5, 2, 10, 8), makeRect(0, 0, 4, 4))).toEqual(makeRect(0, 2, 4, 4));
    expect(isEmptyRect(clipRect(makeRect(4, 0, 8, 4), makeRect(0, 0, 4, 4)))).toBe(true);
    expect(rectContains(makeRect(0, 0, 4, 4), makeRect(1, 1, 4, 4))).toBe(true);
    expect(rectContains(makeRect(0, 0, 4, 4), makeRect(1, 1, 5, 4))).toBe(false);
  });
});

describe("palette du jeu", () => {
  it("ne fusionne que les couleurs utilisées, et montre toujours la couleur 255 en blanc", () => {
    const game = new GamePalette();
    game.submit(palette({ 1: [10, 20, 30], 2: [40, 50, 60], 255: [1, 2, 3] }));
    game.submit(palette({ 2: [70, 80, 90] }));
    expect(game.update()).toBe(true);
    expect([...game.screen.subarray(3, 9)]).toEqual([10, 20, 30, 70, 80, 90]);
    expect([...game.screen.subarray(765)]).toEqual([255, 255, 255]);
    expect([...game.rgb.subarray(765)]).toEqual([1, 2, 3]);
    expect(game.update()).toBe(false);
  });

  it("fond une plage de couleurs, bornes comprises, et sature à 255", () => {
    const game = new GamePalette();
    game.submit(palette({ 1: [100, 200, 30], 2: [100, 200, 30], 3: [100, 200, 30], 4: [100, 200, 30] }));
    game.setFade(50, 2, 3);
    game.setFade(150, 4, 4);
    game.setFade(0, 9, 8);
    game.update();
    expect([...game.screen.subarray(3, 15)]).toEqual([100, 200, 30, 50, 100, 15, 50, 100, 15, 150, 255, 45]);
    game.fadeOff();
    game.update();
    expect([...game.screen.subarray(6, 9)]).toEqual([100, 200, 30]);
  });

  it("trouve la couleur la plus proche parmi 0 à 235, le plus petit indice à égalité", () => {
    const game = new GamePalette();
    game.submit(palette({ 0: [0, 0, 0], 5: [200, 0, 0], 6: [200, 0, 0], 100: [0, 0, 250], 240: [10, 250, 10] }));
    game.update();
    expect(game.findColor(210, 5, 0)).toBe(5);
    expect(game.findColor(0, 0, 255)).toBe(100);
    // La couleur 240 conviendrait mieux, mais c'est une couleur de remplacement.
    expect(game.findColor(10, 250, 10)).not.toBe(240);
    expect(game.findColor(0, 0, 0)).toBe(0);
  });
});
