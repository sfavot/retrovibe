import { describe, expect, it } from "vitest";
import { parseAlg } from "../../../src/games/drascula/data/alg";
import { byExtension, encodeRle, hasOriginalFiles, listOriginal, readOriginal, sampleImage } from "../helpers";

function buildAlg(pixels: Uint8Array, header = new Uint8Array(128)): Uint8Array {
  const palette = Uint8Array.from({ length: 768 }, (_, i) => i % 256);
  return Uint8Array.from([...header, ...encodeRle(pixels), 0x0c, ...palette]);
}

describe("parseAlg (données synthétiques)", () => {
  it("lit l'image, la palette de fin de fichier et l'octet excédentaire", () => {
    const image = sampleImage(7);
    const alg = parseAlg(buildAlg(image));
    expect(alg.pixels).toEqual(image);
    expect(alg.palette).toHaveLength(768);
    expect(alg.palette[767]).toBe(767 % 256);
    expect(alg.slack).toBe(1);
    expect(alg.hasPcxHeader).toBe(false);
  });

  it("reconnaît un en-tête PCX sans le lire", () => {
    const header = new Uint8Array(128);
    header.set([0x0a, 0x05, 0x01, 0x08]);
    expect(parseAlg(buildAlg(sampleImage(), header)).hasPcxHeader).toBe(true);
  });

  it("refuse un fichier trop court ou dont les données sont tronquées", () => {
    expect(() => parseAlg(new Uint8Array(500))).toThrow(/trop court/);
    const bytes = new Uint8Array(128 + 10 + 768);
    expect(() => parseAlg(bytes)).toThrow(/RLE tronqué/);
  });
});

describe.skipIf(!hasOriginalFiles)("images .ALG du jeu", () => {
  const names = listOriginal(byExtension("ALG"));
  const images = names.map((name) => ({ name, alg: parseAlg(readOriginal(name)) }));

  it("décode les 225 fichiers, jusqu'au 64 000e pixel", () => {
    expect(names).toHaveLength(225);
    for (const { name, alg } of images) {
      expect(alg.pixels, name).toHaveLength(64000);
      expect(alg.palette, name).toHaveLength(768);
    }
  });

  it("laisse exactement un octet (0x0C) entre les données et la palette", () => {
    for (const { name, alg } of images) expect(alg.slack, name).toBe(1);
    for (const name of names) {
      const bytes = readOriginal(name);
      expect(bytes[bytes.length - 769], name).toBe(0x0c);
    }
  });

  it("a un en-tête nul dans 215 fichiers et un en-tête PCX dans 10", () => {
    const zero = images.filter(({ name }) => readOriginal(name).subarray(0, 128).every((byte) => byte === 0));
    expect(zero).toHaveLength(215);
    expect(images.filter(({ alg }) => alg.hasPcxHeader)).toHaveLength(10);
    // PCX : version 5, codage RLE, 8 bits par pixel, 320 x 200.
    for (const { name, alg } of images.filter(({ alg }) => alg.hasPcxHeader)) {
      const header = new DataView(readOriginal(name).buffer, readOriginal(name).byteOffset, 128);
      expect([header.getUint16(8, true), header.getUint16(10, true)], name).toEqual([319, 199]);
      expect(alg.pixels, name).toHaveLength(64000);
    }
  });

  it("a une palette sur 8 bits (valeurs jusqu'à 255, pas seulement 0 à 63)", () => {
    const max = Math.max(...images.map(({ alg }) => Math.max(...alg.palette)));
    expect(max).toBe(255);
    expect(images.some(({ alg }) => alg.palette.some((value) => value > 63))).toBe(true);
  });

  it("donne des images qui ne sont pas unies, sauf 28.ALG", () => {
    const flat = images.filter(({ alg }) => new Set(alg.pixels).size === 1).map(({ name }) => name);
    expect(flat).toEqual(["28.ALG"]);
  });
});
