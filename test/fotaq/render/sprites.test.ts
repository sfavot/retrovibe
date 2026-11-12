import { describe, expect, it } from "vitest";
import { type Image, type Surface, blitMasked, blitOpaque, drawBob, fillRect, overpackFrame, shrinkFrame } from "../../../src/games/fotaq/render/sprites";

const surface = (width = 16, height = 12): Surface => ({ pixels: new Uint8Array(width * height), width, height });
/** Image de `width` x `height` dont le pixel (x, y) vaut `1 + x + y * width` (jamais 0). */
const ramp = (width: number, height: number): Image => ({ width, height, pixels: Uint8Array.from({ length: width * height }, (_, i) => 1 + i) });
const at = (s: Surface, x: number, y: number): number => s.pixels[y * s.width + x];
const BOX = { x1: 0, y1: 0, x2: 15, y2: 11 };

describe("copie masquée et retournée (Display::blit)", () => {
  it("l'indice 0 est transparent", () => {
    const dst = surface();
    dst.pixels.fill(7);
    blitMasked(dst, 2, 3, Uint8Array.from([1, 0, 2, 0, 0, 3]), 0, 3, 3, 2, false);
    expect([at(dst, 2, 3), at(dst, 3, 3), at(dst, 4, 3)]).toEqual([1, 7, 2]);
    expect([at(dst, 2, 4), at(dst, 3, 4), at(dst, 4, 4)]).toEqual([7, 7, 3]);
  });

  it("retournée : le premier pixel de la source va à droite", () => {
    const dst = surface();
    blitMasked(dst, 5, 0, Uint8Array.from([1, 2, 3]), 0, 3, 3, 1, true);
    expect([at(dst, 3, 0), at(dst, 4, 0), at(dst, 5, 0)]).toEqual([3, 2, 1]);
  });

  it("rogne aux limites du plan sans erreur", () => {
    const dst = surface();
    blitMasked(dst, -2, -1, ramp(4, 3).pixels, 0, 4, 4, 3, false);
    expect(at(dst, 0, 0)).toBe(1 + 2 + 4);
    blitMasked(dst, 14, 10, ramp(4, 4).pixels, 0, 4, 4, 4, false);
    expect(at(dst, 15, 11)).toBe(1 + 1 + 4);
  });

  it("copie opaque et remplissage", () => {
    const dst = surface();
    blitOpaque(dst, 1, 1, { width: 2, height: 2, pixels: Uint8Array.from([0, 5, 6, 0]) });
    expect([at(dst, 1, 1), at(dst, 2, 1), at(dst, 1, 2)]).toEqual([0, 5, 6]);
    fillRect(dst, 10, 8, 3, 2, 9);
    expect([at(dst, 10, 8), at(dst, 12, 9), at(dst, 13, 9)]).toEqual([9, 9, 0]);
  });
});

describe("réduction d'une image (Graphics::shrinkFrame)", () => {
  it("taille arrondie `(dimension * pourcentage + 50) / 100`, pixel pris à `i * 100 / pourcentage`", () => {
    const small = shrinkFrame(ramp(10, 8), 50)!;
    expect([small.width, small.height]).toEqual([5, 4]);
    // x = 0..4 prennent les colonnes 0, 2, 4, 6, 8 ; y = 0..3 prennent les lignes 0, 2, 4, 6.
    expect(Array.from(small.pixels.subarray(0, 5))).toEqual([1, 3, 5, 7, 9]);
    expect(small.pixels[5]).toBe(1 + 2 * 10);
    const odd = shrinkFrame(ramp(7, 7), 60)!;
    expect([odd.width, odd.height]).toEqual([Math.trunc((7 * 60 + 50) / 100), Math.trunc((7 * 60 + 50) / 100)]);
    expect(odd.width).toBe(4);
    // Colonnes 0, 1 (100 / 60), 3 (200 / 60), 5 (300 / 60).
    expect(Array.from(odd.pixels.subarray(0, 4))).toEqual([1, 2, 4, 6]);
  });

  it("une image qui disparaît ne donne rien", () => {
    expect(shrinkFrame(ramp(2, 2), 10)).toBeNull();
  });
});

describe("dessin d'un bob (Graphics::drawBob)", () => {
  it("copie l'image à sa position, sans la retourner", () => {
    const dst = surface();
    drawBob(dst, ramp(3, 2), false, 100, BOX, 4, 5);
    expect([at(dst, 4, 5), at(dst, 6, 5), at(dst, 4, 6), at(dst, 6, 6)]).toEqual([1, 3, 4, 6]);
    expect(at(dst, 3, 5)).toBe(0);
  });

  it("retournée : `x` reste le coin gauche de la zone couverte", () => {
    const dst = surface();
    drawBob(dst, ramp(3, 1), true, 100, BOX, 4, 5);
    expect([at(dst, 4, 5), at(dst, 5, 5), at(dst, 6, 5)]).toEqual([3, 2, 1]);
  });

  it("découpée par la boîte : bords gauche, haut, droit et bas, image normale et retournée", () => {
    const image = ramp(4, 4);
    for (const flip of [false, true]) {
      const dst = surface();
      drawBob(dst, image, flip, 100, { x1: 2, y1: 2, x2: 9, y2: 7 }, 0, 0);
      // Seuls les pixels de la boîte sont écrits.
      for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) if (x < 2 || y < 2) expect(at(dst, x, y), `${flip} ${x},${y}`).toBe(0);
      expect(at(dst, 2, 2)).toBe(flip ? 1 + (3 - 2) + 2 * 4 : 1 + 2 + 2 * 4);
      expect(at(dst, 3, 3)).toBe(flip ? 1 + (3 - 3) + 3 * 4 : 1 + 3 + 3 * 4);
    }
    const right = surface();
    drawBob(right, image, false, 100, { x1: 0, y1: 0, x2: 9, y2: 7 }, 8, 6);
    expect(at(right, 9, 7)).toBe(1 + 1 + 1 * 4);
    expect(at(right, 10, 7)).toBe(0);
    expect(at(right, 8, 8)).toBe(0);
    const outside = surface();
    drawBob(outside, image, false, 100, { x1: 0, y1: 0, x2: 9, y2: 7 }, 20, 20);
    expect(outside.pixels.every((v) => v === 0)).toBe(true);
  });

  it("réduite : l'image réduite est dessinée au même coin", () => {
    const dst = surface();
    drawBob(dst, ramp(4, 4), false, 50, BOX, 1, 1);
    expect([at(dst, 1, 1), at(dst, 2, 1), at(dst, 1, 2), at(dst, 2, 2)]).toEqual([1, 3, 9, 11]);
    expect(at(dst, 3, 1)).toBe(0);
  });

  it("une échelle nulle ou une image vide ne dessine rien", () => {
    const dst = surface();
    drawBob(dst, ramp(4, 4), false, 0, BOX, 1, 1);
    drawBob(dst, { width: 0, height: 0, pixels: new Uint8Array(0) }, false, 100, BOX, 1, 1);
    expect(dst.pixels.every((v) => v === 0)).toBe(true);
  });
});

describe("surimpression d'une image (BankManager::overpack)", () => {
  it("la source est copiée sur le début des pixels de la destination, sans changer sa taille", () => {
    const base = { ...ramp(4, 3), hotspotX: 1, hotspotY: 2 };
    const over = { ...ramp(4, 1), pixels: Uint8Array.from([90, 91, 92, 93]), hotspotX: 0, hotspotY: 0 };
    const result = overpackFrame(base, over);
    expect(Array.from(result.pixels.slice(0, 8))).toEqual([90, 91, 92, 93, 5, 6, 7, 8]);
    expect([result.width, result.height, result.hotspotX, result.hotspotY]).toEqual([4, 3, 1, 2]);
    // L'image de base n'est pas touchée.
    expect(base.pixels[0]).toBe(1);
  });

  it("l'image de base n'est pas touchée non plus quand ses pixels sont une vue d'un Buffer (fichiers lus par Node : `slice` partage la mémoire)", () => {
    // Les banques analysées gardent une vue du fichier ; sous Node, le fichier est un Buffer, dont `slice` ne copie pas.
    const file = Buffer.from(Array.from({ length: 12 }, (_, i) => 1 + i));
    const base = { width: 4, height: 3, pixels: file.subarray(0, 12), hotspotX: 0, hotspotY: 0 };
    const over = { width: 4, height: 1, pixels: Uint8Array.from([90, 91, 92, 93]), hotspotX: 0, hotspotY: 0 };
    expect(Array.from(overpackFrame(base, over).pixels.subarray(0, 5))).toEqual([90, 91, 92, 93, 5]);
    expect(Array.from(file.subarray(0, 5))).toEqual([1, 2, 3, 4, 5]);
  });

  it("une source plus large ou plus haute que la destination la remplace (`unpack`)", () => {
    const base = { ...ramp(4, 3), hotspotX: 0, hotspotY: 0 };
    const wide = { ...ramp(6, 2), hotspotX: 3, hotspotY: 3 };
    expect(overpackFrame(base, wide)).toBe(wide);
    const tall = { ...ramp(2, 5), hotspotX: 0, hotspotY: 0 };
    expect(overpackFrame(base, tall)).toBe(tall);
  });
});
