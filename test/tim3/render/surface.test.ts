import { describe, expect, it } from "vitest";
import { Surface, mapColor, paletteLut } from "../../../src/games/tim3/render";
import { image, rows } from "./support";

describe("Surface", () => {
  it("copie une image sans ses pixels transparents (index 0)", () => {
    const s = new Surface(4, 3);
    s.clear(9);
    s.blit(image([[1, 0, 2], [0, 3, 0]]), 1, 1);
    expect(rows(s, 0, 0, 4, 3)).toEqual(["9999", "9192", "9939"]);
  });

  it("copie opaque : l'index 0 est écrit", () => {
    const s = new Surface(3, 1);
    s.clear(9);
    s.blit(image([[1, 0, 2]]), 0, 0, false, false, true);
    expect(rows(s, 0, 0, 3, 1)).toEqual(["102"]);
  });

  it("retourne l'image à gauche-droite (flipX) et haut-bas (flipY)", () => {
    const img = image([[1, 2, 3], [4, 5, 6]]);
    const a = new Surface(3, 2);
    a.blit(img, 0, 0, true, false);
    expect(rows(a, 0, 0, 3, 2)).toEqual(["321", "654"]);
    const b = new Surface(3, 2);
    b.blit(img, 0, 0, false, true);
    expect(rows(b, 0, 0, 3, 2)).toEqual(["456", "123"]);
    const c = new Surface(3, 2);
    c.blit(img, 0, 0, true, true);
    expect(rows(c, 0, 0, 3, 2)).toEqual(["654", "321"]);
  });

  it("respecte le rectangle de découpage, même pour une image retournée", () => {
    const s = new Surface(5, 1);
    s.setClip(1, 0, 3, 1);
    s.blit(image([[1, 2, 3, 4, 5]]), 0, 0, true);
    expect(rows(s, 0, 0, 5, 1)).toEqual(["04320"]);
  });

  it("trace les lignes de Bresenham extrémités comprises (dans les deux sens)", () => {
    const a = new Surface(5, 3);
    a.line(0, 0, 4, 2, 1);
    expect(rows(a, 0, 0, 5, 3)).toEqual(["10000", "01100", "00011"]);
    const b = new Surface(5, 3);
    b.line(4, 2, 0, 0, 1);
    expect([b.pixels[0], b.pixels[14]]).toEqual([1, 1]);
  });

  it("termine une ligne aux extrémités fractionnaires (pointeur d'un canvas mis à l'échelle)", () => {
    const s = new Surface(5, 3);
    s.line(0.4, 0.7, 4.6, 2.2, 1);
    expect(rows(s, 0, 0, 5, 3)).toEqual(["10000", "01100", "00011"]);
  });

  it("remplit et contourne un rectangle (bornes x + w exclues)", () => {
    const s = new Surface(5, 4);
    s.strokeRect(1, 0, 3, 3, 7);
    expect(rows(s, 0, 0, 5, 4)).toEqual(["07770", "07070", "07770", "00000"]);
    s.fillRect(0, 3, 2, 1, 4);
    expect(rows(s, 0, 3, 5, 1)).toEqual(["44000"]);
  });
});

describe("couleurs", () => {
  it("mapColor suit 413388 : négatif = index, 1 à 15 décalé de 15, 0 = 20", () => {
    expect([mapColor(-20), mapColor(3), mapColor(15), mapColor(16), mapColor(0x86), mapColor(0)]).toEqual([20, 18, 30, 16, 0x86, 20]);
    expect(mapColor(300)).toBe(-1);
  });

  it("paletteLut garde la transparence de l'index 0", () => {
    const rgba = new Uint8Array(256 * 4).fill(255);
    rgba[3] = 0;
    const lut = paletteLut(rgba);
    expect([lut[0]! >>> 24, lut[1]! >>> 24]).toEqual([0, 255]);
  });
});
