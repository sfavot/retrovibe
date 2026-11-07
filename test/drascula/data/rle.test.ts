import { describe, expect, it } from "vitest";
import { decodeRle, SCREEN_PIXELS, xorInto } from "../../../src/games/drascula/data/rle";
import { encodeRle, sampleImage } from "../helpers";

describe("decodeRle", () => {
  it("lit des pixels isolés et des répétitions", () => {
    const stream = [1, 2, 0xc3, 7, 3];
    // Complété par des répétitions de 63 pixels de 9 jusqu'à 64 000 pixels.
    const filler = Array.from({ length: Math.ceil((SCREEN_PIXELS - 5) / 63) }, () => [0xff, 9]).flat();
    const { pixels, consumed } = decodeRle(Uint8Array.from([...stream, ...filler]));
    expect([...pixels.subarray(0, 6)]).toEqual([1, 2, 7, 7, 7, 3]);
    expect(pixels[SCREEN_PIXELS - 1]).toBe(9);
    expect(consumed).toBe(stream.length + filler.length);
  });

  it("code un pixel >= 0xC0 par une répétition de 1", () => {
    const image = new Uint8Array(SCREEN_PIXELS).fill(0xc5);
    image[10] = 0xff;
    const decoded = decodeRle(Uint8Array.from(encodeRle(image))).pixels;
    expect(decoded[9]).toBe(0xc5);
    expect(decoded[10]).toBe(0xff);
    expect(decoded).toEqual(image);
  });

  it("une répétition de 0 ne produit rien mais consomme sa valeur", () => {
    const stream = Uint8Array.from([0xc0, 99, 5, ...encodeRle(new Uint8Array(SCREEN_PIXELS - 1).fill(8))]);
    const { pixels } = decodeRle(stream);
    expect(pixels[0]).toBe(5);
    expect(pixels[1]).toBe(8);
  });

  it("s'arrête au 64 000e pixel, même au milieu d'une répétition", () => {
    const head = encodeRle(new Uint8Array(SCREEN_PIXELS - 2).fill(4));
    const stream = Uint8Array.from([...head, 0xc0 | 10, 6, 1, 2, 3]);
    const { pixels, consumed } = decodeRle(stream);
    expect(pixels[SCREEN_PIXELS - 3]).toBe(4);
    expect([pixels[SCREEN_PIXELS - 2], pixels[SCREEN_PIXELS - 1]]).toEqual([6, 6]);
    expect(consumed).toBe(head.length + 2);
  });

  it("commence à l'offset donné", () => {
    const encoded = encodeRle(sampleImage(3));
    const stream = Uint8Array.from([0xaa, 0xbb, 0xcc, ...encoded, 0x0c]);
    const { pixels, consumed } = decodeRle(stream, 3);
    expect(pixels).toEqual(sampleImage(3));
    expect(consumed).toBe(encoded.length);
  });

  it("refait l'image après un aller-retour", () => {
    for (const seed of [1, 2, 3, 4]) {
      const image = sampleImage(seed);
      expect(decodeRle(Uint8Array.from(encodeRle(image))).pixels).toEqual(image);
    }
  });

  it("refuse un flux trop court", () => {
    expect(() => decodeRle(Uint8Array.of(1, 2, 3))).toThrow(/RLE tronqué/);
    expect(() => decodeRle(Uint8Array.of(0xc5))).toThrow(/RLE tronqué/);
  });
});

describe("xorInto", () => {
  it("combine par OU exclusif et s'annule en le refaisant", () => {
    const a = sampleImage(5);
    const b = sampleImage(6);
    const screen = a.slice();
    xorInto(screen, b);
    expect(screen[100]).toBe(a[100] ^ b[100]);
    xorInto(screen, b);
    expect(screen).toEqual(a);
  });
});
