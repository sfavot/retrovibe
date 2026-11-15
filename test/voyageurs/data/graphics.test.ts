import { describe, expect, it } from "vitest";
import { readNeoCollision } from "../../../src/games/voyageurs/data/neo";
import { planarPixelWidth, planarToIndexed } from "../../../src/games/voyageurs/data/planar";
import { component9To8, readStPalette, stPaletteToRgb } from "../../../src/games/voyageurs/data/palette";
import { SCREEN_SIZE, readPi1 } from "../../../src/games/voyageurs/data/pi1";
import { bundle, hasOriginalFiles, sha256 } from "./helpers";

describe("pixels planaires (synthétiques)", () => {
  it("assemble quatre plans de bits, pixel de gauche = bit 15", () => {
    // pixel 0 : plan 0 seul (1) ; pixel 1 : plans 1 et 3 (10) ; pixel 15 : tous les plans (15)
    const src = Uint8Array.of(0x80, 0x01, 0x40, 0x01, 0x00, 0x01, 0x40, 0x01);
    const out = planarToIndexed(src, 0, 8, 1);
    expect(out).toHaveLength(16);
    expect([out[0], out[1], out[2], out[15]]).toEqual([1, 10, 0, 15]);
  });

  it("tronque la largeur comme ScummVM et refuse une source trop courte", () => {
    expect(planarPixelWidth(160)).toBe(320);
    expect(planarPixelWidth(8)).toBe(16);
    expect(planarPixelWidth(12)).toBe(16);
    expect(planarToIndexed(new Uint8Array(16), 0, 12, 2)).toHaveLength(32);
    expect(() => planarToIndexed(new Uint8Array(15), 0, 8, 2)).toThrow(RangeError);
    expect(() => planarToIndexed(new Uint8Array(16), 9, 8, 1)).toThrow(RangeError);
  });
});

describe("palette ST 9 bits", () => {
  it("lit les mots 0x0RGB et convertit par c * 255 / 7 (quotient entier)", () => {
    const bytes = new Uint8Array(32);
    bytes.set([0x07, 0x77, 0x01, 0x23]);
    const palette = readStPalette(bytes);
    expect([...palette.subarray(0, 6)]).toEqual([7, 7, 7, 1, 2, 3]);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(component9To8)).toEqual([0, 36, 72, 109, 145, 182, 218, 255]);
    expect([...stPaletteToRgb(palette).subarray(0, 6)]).toEqual([255, 255, 255, 36, 72, 109]);
    expect(() => readStPalette(new Uint8Array(31))).toThrow(RangeError);
  });
});

/** sha256 des 192 000 octets RVB du PNG de référence `L1.PI1.png` (gratte-ciel de l'intro). */
const L1_RGB_SHA256 = "80c3a46cf53d6ca5d6a2a2a3704e0634a243c4a204eb164ef49951c091e61191";

describe.skipIf(!hasOriginalFiles)("PI1 et NEO (fichiers d'origine)", () => {
  it("décode L1.PI1 à l'identique de l'image de référence", () => {
    const image = readPi1(bundle("PART01").read("L1.PI1"));
    expect(image.resolution).toBe(0);
    expect(image.pixels).toHaveLength(SCREEN_SIZE);
    const palette = stPaletteToRgb(image.palette);
    const rgb = new Uint8Array(SCREEN_SIZE * 3);
    for (let i = 0; i < SCREEN_SIZE; i++) rgb.set(palette.subarray(image.pixels[i]! * 3, image.pixels[i]! * 3 + 3), i * 3);
    expect(sha256(rgb)).toBe(L1_RGB_SHA256);
  });

  it("lit les 56 fonds, en 16 couleurs, avec des palettes de composantes 0 à 7", () => {
    let count = 0;
    for (const name of ["PART01", "PART02", "PART03", "PART04", "PART04B"] as const) {
      const b = bundle(name);
      for (const [index, entry] of b.entries.entries()) {
        if (!entry.name.toUpperCase().endsWith(".PI1")) continue;
        const image = readPi1(b.read(index));
        expect(image.resolution, entry.name).toBe(0);
        expect(Math.max(...image.palette), entry.name).toBeLessThanOrEqual(7);
        expect(Math.max(...image.pixels), entry.name).toBeLessThanOrEqual(15);
        count++;
      }
    }
    expect(count).toBe(56);
  });

  it("lit la page de collision L1_MK.NEO : zones 0 et 3 seulement", () => {
    const collision = readNeoCollision(bundle("PART01").read("L1_MK.NEO"));
    const histogram = new Map<number, number>();
    for (const zone of collision) histogram.set(zone, (histogram.get(zone) ?? 0) + 1);
    expect(collision).toHaveLength(SCREEN_SIZE);
    expect(Object.fromEntries(histogram)).toEqual({ 0: 54900, 3: 9100 });
  });

  it("lit les 35 pages de collision", () => {
    let count = 0;
    for (const name of ["PART01", "PART02", "PART03", "PART04", "PART04B"] as const) {
      const b = bundle(name);
      for (const [index, entry] of b.entries.entries()) {
        if (!entry.name.toUpperCase().endsWith(".NEO")) continue;
        expect(readNeoCollision(b.read(index)), entry.name).toHaveLength(SCREEN_SIZE);
        count++;
      }
    }
    expect(count).toBe(35);
  });
});
