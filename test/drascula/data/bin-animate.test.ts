import { describe, expect, it } from "vitest";
import { AnimateDecoder, parseAnimate, playedFrameCount } from "../../../src/games/drascula/data/bin-animate";
import { parseSsn } from "../../../src/games/drascula/data/bin-ssn";
import { byExtension, encodeRle, hasOriginalFiles, listOriginal, readOriginal, sampleImage } from "../helpers";

const u32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
const palette = (seed: number) => Array.from({ length: 768 }, (_, i) => (i + seed) % 64);
const frame = (pixels: Uint8Array, seed: number) => {
  const data = encodeRle(pixels);
  return [...u32(data.length), ...data, ...palette(seed)];
};

describe("parseAnimate et AnimateDecoder (données synthétiques)", () => {
  const a = sampleImage(21);
  const b = sampleImage(22);
  const c = sampleImage(23);
  const delta = (x: Uint8Array, y: Uint8Array) => x.map((v, i) => v ^ y[i]);
  const bytes = Uint8Array.from([...u32(3), ...frame(a, 1), ...frame(delta(a, b), 2), ...frame(delta(b, c), 3)]);

  it("lit le nombre d'images puis chaque image avec sa palette", () => {
    const file = parseAnimate(bytes);
    expect(file.frames).toHaveLength(3);
    expect(file.bytesRead).toBe(bytes.length);
    expect(file.frames[1].palette).toEqual(Uint8Array.from(palette(2)));
    expect(playedFrameCount(file)).toBe(2);
  });

  it("copie la première image, combine les suivantes par XOR et garde la palette de la première", () => {
    const decoder = new AnimateDecoder(parseAnimate(bytes));
    expect(decoder.step()).toBe(true);
    expect(decoder.screen).toEqual(a);
    expect(decoder.palette).toEqual(Uint8Array.from(palette(1)));
    decoder.step();
    expect(decoder.screen).toEqual(b);
    decoder.step();
    expect(decoder.screen).toEqual(c);
    expect(decoder.palette).toEqual(Uint8Array.from(palette(1)));
    expect(decoder.done).toBe(true);
    expect(decoder.step()).toBe(false);
  });

  it("refuse un fichier ou une image tronqués", () => {
    expect(() => parseAnimate(new Uint8Array(2))).toThrow(/trop court/);
    expect(() => parseAnimate(Uint8Array.from([...u32(2), ...frame(a, 1)]))).toThrow(/image 1 tronquée/);
    expect(() => parseAnimate(bytes.subarray(0, bytes.length - 10))).toThrow(/image 2 tronquée/);
  });
});

describe.skipIf(!hasOriginalFiles)("animations .BIN du jeu", () => {
  const ANIMATE = [
    "AG", "BEB", "BES", "BIO", "BJB", "CNF", "DET", "DRF", "FIN", "FREL", "FREL2", "FUM", "GAF", "HBP", "LEV", "LIB", "LIB2", "MAN", "RAP",
    "RAYO1", "RAYO2", "RCT", "SCR2", "SCR3", "ST", "UP",
  ].map((name) => `${name}.BIN`);
  const tryParse = (name: string) => {
    try {
      const bytes = readOriginal(name);
      return parseAnimate(bytes).bytesRead === bytes.length;
    } catch {
      return false;
    }
  };

  it("parcourt les 26 fichiers « animate » jusqu'au dernier octet, et aucun des 7 SSN", () => {
    const names = listOriginal(byExtension("BIN"));
    expect(names.filter(tryParse)).toEqual(ANIMATE);
    // Les deux partitions sont disjointes et couvrent les 33 fichiers.
    const ssn = names.filter((name) => {
      try {
        return parseSsn(readOriginal(name)).bytesRead === readOriginal(name).length;
      } catch {
        return false;
      }
    });
    expect(ssn.filter((name) => ANIMATE.includes(name))).toEqual([]);
    expect(ssn.length + ANIMATE.length).toBe(33);
  });

  it("annonce exactement le nombre d'images présentes, la dernière n'étant pas jouée", () => {
    const frames = (name: string) => parseAnimate(readOriginal(name)).frames.length;
    expect(frames("FIN.BIN")).toBe(150);
    expect(frames("LEV.BIN")).toBe(7);
    expect(frames("ST.BIN")).toBe(116);
    expect(frames("SCR2.BIN")).toBe(53);
    expect(playedFrameCount(parseAnimate(readOriginal("LEV.BIN")))).toBe(6);
  });

  it("a des palettes 6 bits (0 à 63) et des images qui se décodent toutes", () => {
    for (const name of ANIMATE) {
      const file = parseAnimate(readOriginal(name));
      for (const { palette } of file.frames) expect(Math.max(...palette), name).toBeLessThanOrEqual(63);
      const decoder = new AnimateDecoder(file);
      while (decoder.step());
      expect(decoder.decoded, name).toBe(file.frames.length);
    }
  });

  it("rend l'image attendue après combinaison (FIN, image 60 : la taverne)", () => {
    const decoder = new AnimateDecoder(parseAnimate(readOriginal("FIN.BIN")));
    while (decoder.decoded < 60) decoder.step();
    const checksum = decoder.screen.reduce((sum, value, i) => (sum + value * ((i % 251) + 1)) % 1000003, 0);
    expect(checksum).toBe(932037);
  });
});
