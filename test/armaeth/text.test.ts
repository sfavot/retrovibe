import { describe, expect, it } from "vitest";
import { parseGph, type GphFont } from "../../src/games/armaeth/data/font";
import { Surface } from "../../src/games/armaeth/render/surface";
import { drawText, measureText, textBytes } from "../../src/games/armaeth/render/text";
import { hasOriginalFiles, readOriginal } from "./helpers";

/**
 * Police synthétique : cellule 5 x 7, 256 mots d'offsets. Code 0 : blanc de largeur 2 ; `A` (65) : largeur 3,
 * lignes 1 à 2, `0b111` puis `0b101` ; `B` (66) : largeur 2, ligne 0, `0b01` (un seul pixel, à droite).
 */
function fakeFont(): GphFont {
  const data = [0x00, 0x00 /* code 0 : ligne 0, vide */, 0x12, 0b111, 0b101, 0x00, 0b01];
  const offsets = new Uint16Array(256);
  offsets[0] = (2 << 12) | 0;
  offsets[65] = (3 << 12) | 2;
  offsets[66] = (2 << 12) | 5;
  const bytes = new Uint8Array(6 + 512 + data.length);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 5, true);
  view.setUint16(2, 7, true);
  view.setUint16(4, data.length, true);
  offsets.forEach((v, i) => view.setUint16(6 + 2 * i, v, true));
  bytes.set(data, 6 + 512);
  return parseGph(bytes);
}

const row = (s: Surface, y: number, from: number, count: number) => [...s.pixels.subarray(y * s.width + from, y * s.width + from + count)];

describe("drawText (police synthétique)", () => {
  const font = fakeFont();

  it("dessine l'encre bit 0 à gauche, à partir de la première ligne du glyphe", () => {
    const s = new Surface(12, 6);
    const end = drawText(s, font, 1, 0, "A", { color: 9 });
    expect(row(s, 0, 0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(row(s, 1, 0, 6)).toEqual([0, 9, 9, 9, 0, 0]);
    expect(row(s, 2, 0, 6)).toEqual([0, 9, 0, 9, 0, 0]);
    expect(end).toBe(4);
  });

  it("ombre à droite de l'encre, écrasée par l'encre suivante", () => {
    const s = new Surface(12, 6);
    drawText(s, font, 1, 0, "A", { color: 9, shadow: 4 });
    expect(row(s, 1, 0, 6)).toEqual([0, 9, 9, 9, 4, 0]);
    expect(row(s, 2, 0, 6)).toEqual([0, 9, 4, 9, 4, 0]);
  });

  it("avance de largeur + espacement et rend la fin sans l'espacement final", () => {
    const s = new Surface(20, 6);
    const end = drawText(s, font, 0, 0, "AA", { color: 9, spacing: 2 });
    expect(row(s, 1, 0, 8)).toEqual([9, 9, 9, 0, 0, 9, 9, 9]);
    expect(end).toBe(8);
    expect(measureText(font, "AA", 2)).toBe(8);
  });

  it("un code sans glyphe prend celui du code 0 (blanc de largeur 2)", () => {
    const s = new Surface(12, 6);
    const end = drawText(s, font, 0, 0, textBytes("~A"), { color: 9 });
    expect(row(s, 1, 0, 6)).toEqual([0, 0, 9, 9, 9, 0]);
    expect(end).toBe(5);
  });

  it("rogne aux bords de la page et accepte un texte vide", () => {
    const s = new Surface(4, 3);
    drawText(s, font, 2, 0, "A", { color: 9 });
    expect(row(s, 1, 0, 4)).toEqual([0, 0, 9, 9]);
    drawText(s, font, -1, 0, "A", { color: 7 });
    expect(row(s, 1, 0, 4)).toEqual([7, 7, 9, 9]);
    expect(drawText(s, font, 3, 0, "", { color: 1 })).toBe(3);
  });

  it("mesure comme le moteur", () => {
    expect(measureText(font, "")).toBe(0);
    expect(measureText(font, "AB", 1)).toBe(3 + 1 + 2);
  });
});

describe.skipIf(!hasOriginalFiles)("drawText (police du jeu)", () => {
  const font = parseGph(readOriginal("A1FGPH.SYS"));

  it("le bitmap d'un glyphe correspond à ce qui est dessiné", () => {
    const s = new Surface(20, 10);
    drawText(s, font, 2, 1, "E", { color: 1 });
    const glyph = font.glyph(69);
    const bitmap = font.bitmap(69);
    for (let y = 0; y < font.cellHeight; y++)
      for (let x = 0; x < glyph.width; x++)
        expect(s.pixels[(1 + y) * 20 + 2 + x]).toBe(bitmap[y * glyph.width + x]);
    expect(measureText(font, "Killian", 1)).toBeGreaterThan(20);
  });
});
