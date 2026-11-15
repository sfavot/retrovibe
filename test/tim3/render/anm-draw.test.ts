import { describe, expect, it } from "vitest";
import { FLIP_X, FLIP_Y, Surface, drawAnmImage, imageCount, imageFrame, stateStart } from "../../../src/games/tim3/render";
import { FakeAssets, anm, bitmapCmd, frame, image, rows } from "./support";

const SPRITE = image([[1, 2, 3], [4, 5, 6]]);
const assets = (...frames: ReturnType<typeof image>[]) => new FakeAssets({ frames }, new Map());

describe("drawAnmImage", () => {
  it("place l'image à l'origine plus son décalage dans l'animation", () => {
    const a = anm(8, 8, [frame(2, 1, 3, 2, [bitmapCmd(0)])]);
    const s = new Surface(8, 5);
    expect(drawAnmImage(s, assets(SPRITE), a, 0, 1, 1)).toBe(true);
    expect(rows(s, 0, 0, 8, 5)).toEqual(["00000000", "00000000", "00012300", "00045600", "00000000"]);
  });

  it("suit la séquence : l'image 0 est la première entrée de la séquence", () => {
    const a = anm(3, 2, [frame(0, 0, 3, 2, [bitmapCmd(0)]), frame(0, 0, 3, 2, [])], [], [1, 0]);
    expect(imageCount(a)).toBe(2);
    expect(imageFrame(a, 0)).toBe(a.frames[1]);
    const s = new Surface(3, 2);
    drawAnmImage(s, assets(SPRITE), a, 1, 0, 0);
    expect(rows(s, 0, 0, 3, 2)).toEqual(["123", "456"]);
    expect(drawAnmImage(s, assets(SPRITE), a, 2, 0, 0)).toBe(false);
  });

  it("retourne en X : symétrise le rectangle dans l'animation et les commandes dans l'image", () => {
    // Animation de 8 de large, image {x 1, l 4} : retournée, elle part en 8 − 1 − 4 = 3 ; le bitmap (l 3) en x 1 passe en 4 − 1 − 3 = 0.
    const a = anm(8, 2, [frame(1, 0, 4, 2, [bitmapCmd(0, 1, 0)])]);
    const plain = new Surface(8, 2);
    drawAnmImage(plain, assets(SPRITE), a, 0, 0, 0);
    expect(rows(plain, 0, 0, 8, 2)).toEqual(["00123000", "00456000"]);
    const flipped = new Surface(8, 2);
    drawAnmImage(flipped, assets(SPRITE), a, 0, 0, 0, FLIP_X);
    expect(rows(flipped, 0, 0, 8, 2)).toEqual(["00032100", "00065400"]);
  });

  it("retourne en Y", () => {
    const a = anm(3, 4, [frame(0, 0, 3, 3, [bitmapCmd(0, 0, 0)])]);
    const s = new Surface(3, 4);
    drawAnmImage(s, assets(SPRITE), a, 0, 0, 0, FLIP_Y);
    // Image {y 0, h 3} dans 4 de haut : retournée, elle part en 4 − 0 − 3 = 1 ; le bitmap (2 lignes) y part en 3 − 0 − 2 = 1, à l'envers.
    expect(rows(s, 0, 0, 3, 4)).toEqual(["000", "000", "456", "123"]);
  });

  it("le retournement d'une commande ne change que ses pixels : bit 1 horizontal, bit 0 vertical", () => {
    const a = anm(3, 2, [frame(0, 0, 3, 2, [bitmapCmd(0, 0, 0, 2)]), frame(0, 0, 3, 2, [bitmapCmd(0, 0, 0, 1)]), frame(0, 0, 3, 2, [bitmapCmd(0, 0, 0, 3)])]);
    const draw = (i: number) => {
      const s = new Surface(3, 2);
      drawAnmImage(s, assets(SPRITE), a, i, 0, 0);
      return rows(s, 0, 0, 3, 2);
    };
    expect(draw(0)).toEqual(["321", "654"]);
    expect(draw(1)).toEqual(["456", "123"]);
    expect(draw(2)).toEqual(["654", "321"]);
  });

  it("combine le retournement de la pièce et celui de la commande (XOR)", () => {
    const a = anm(3, 2, [frame(0, 0, 3, 2, [bitmapCmd(0, 0, 0, 2)])]);
    const s = new Surface(3, 2);
    drawAnmImage(s, assets(SPRITE), a, 0, 0, 0, FLIP_X);
    expect(rows(s, 0, 0, 3, 2)).toEqual(["123", "456"]);
  });

  it("dessine rectangle plein, contour et ligne dans les couleurs logiques", () => {
    const a = anm(6, 4, [
      frame(0, 0, 6, 4, [
        { op: "rect", x: 0, y: 0, width: 3, height: 3, color: 3, fill: 0x8000 | 4 },
        { op: "rect", x: 3, y: 0, width: 3, height: 3, color: 5, fill: 5 },
        { op: "line", x1: 0, y1: 3, x2: 5, y2: 3, color: -9 },
      ]),
    ]);
    const s = new Surface(6, 4);
    drawAnmImage(s, assets(), a, 0, 0, 0);
    // Plein : couleur 4 → 19 ; son contour : couleur 3 → 18 ; contour seul : 5 → 20 ; ligne : −9 → index 9.
    const at = (x: number, y: number) => s.pixels[y * 6 + x];
    expect([at(1, 1), at(0, 0), at(2, 2), at(3, 0), at(4, 1), at(5, 2), at(0, 3), at(5, 3)]).toEqual([19, 18, 18, 20, 0, 20, 9, 9]);
  });

  it("états : le numéro d'état qui commence à l'image i, 0 sinon, −1 hors limites", () => {
    const a = anm(1, 1, [frame(0, 0, 1, 1, []), frame(0, 0, 1, 1, []), frame(0, 0, 1, 1, [])], [{ first: 0, state: 2 }, { first: 2, state: 5 }]);
    expect([stateStart(a, 0), stateStart(a, 1), stateStart(a, 2), stateStart(a, 3), stateStart(a, -1)]).toEqual([2, 0, 5, -1, -1]);
  });
});
