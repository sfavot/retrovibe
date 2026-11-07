import { describe, expect, it } from "vitest";
import { decodeBin, sampleIndices } from "../../../src/games/drascula/ui/bin-frames";
import { byExtension, encodeRle, hasOriginalFiles, listOriginal, readOriginal, sampleImage } from "../helpers";

const u32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
const palette6 = (seed: number) => Array.from({ length: 768 }, (_, i) => (i + seed) % 64);
const rleChunk = (pixels: Uint8Array) => {
  const data = encodeRle(pixels);
  return [0, 1, ...u32(data.length), ...data];
};
const animateFrame = (pixels: Uint8Array, seed: number) => {
  const data = encodeRle(pixels);
  return [...u32(data.length), ...data, ...palette6(seed)];
};

describe("decodeBin (données synthétiques)", () => {
  const a = sampleImage(1);
  const b = sampleImage(2);
  const xor = b.map((value, i) => value ^ a[i]);

  it("SSN : première image copiée, suivantes en XOR, blocs vides répétés, palette en vigueur", () => {
    const ssn = Uint8Array.from([4, ...palette6(0), ...rleChunk(a), 6, ...rleChunk(xor), 3]);
    const result = decodeBin(ssn, "QPC.BIN");
    expect(result.format).toBe("SSN");
    expect(result.frames.map((frame) => frame.kind)).toEqual(["rle", "empty", "rle"]);
    expect(result.played).toBe(3);
    expect(result.bytesRead).toBe(ssn.length);
    expect(result.paletteChanges).toBe(0);
    expect([...result.frames[0].screen]).toEqual([...a]);
    expect(result.frames[1].screen).toBe(result.frames[0].screen);
    expect([...result.frames[2].screen]).toEqual([...b]);
    expect(result.frames[2].palette).toEqual(Uint8Array.from(palette6(0)));
  });

  it("SSN : une palette qui change en cours de route est comptée", () => {
    const ssn = Uint8Array.from([4, ...palette6(0), ...rleChunk(a), 4, ...palette6(5), ...rleChunk(xor), 3]);
    const result = decodeBin(ssn, "INTRO.BIN");
    expect(result.paletteChanges).toBe(1);
    expect(result.frames[1].palette?.[0]).toBe(5);
  });

  it("animate : N images lues, N - 1 jouées, la dernière marquée non jouée", () => {
    const animate = Uint8Array.from([...u32(3), ...animateFrame(a, 0), ...animateFrame(xor, 0), ...animateFrame(a, 7)]);
    const result = decodeBin(animate, "LEV.BIN");
    expect(result.format).toBe("animate");
    expect(result.frames.map((frame) => frame.kind)).toEqual(["animate", "animate", "unplayed"]);
    expect(result.played).toBe(2);
    expect(result.bytesRead).toBe(animate.length);
    expect(result.paletteChanges).toBe(1);
    expect([...result.frames[1].screen]).toEqual([...b]);
  });

  it("le format se déduit du nom, avec repli sur l'autre", () => {
    const animate = Uint8Array.from([...u32(1), ...animateFrame(a, 0)]);
    expect(decodeBin(animate, "INTRO.BIN").format).toBe("animate");
    expect(() => decodeBin(Uint8Array.of(9, 9, 9), "LEV.BIN")).toThrow();
  });
});

describe("sampleIndices", () => {
  it("répartit les indices de la première à la dernière image", () => {
    expect(sampleIndices(100, 5)).toEqual([0, 24, 49, 74, 99]);
    expect(sampleIndices(3, 24)).toEqual([0, 1, 2]);
    expect(sampleIndices(0, 24)).toEqual([]);
  });
});

describe.skipIf(!hasOriginalFiles)(".BIN du jeu", () => {
  it("QPC et LOGODDM : nombre d'images connu, sans reste", () => {
    const qpc = decodeBin(readOriginal("QPC.BIN"), "QPC.BIN");
    expect([qpc.format, qpc.frames.filter((f) => f.kind !== "empty").length, qpc.bytesRead]).toEqual(["SSN", 9, readOriginal("QPC.BIN").length]);
    expect(qpc.frames[0].palette).not.toBeNull();
    const logo = decodeBin(readOriginal("LOGODDM.BIN"), "LOGODDM.BIN");
    expect(logo.frames.filter((frame) => frame.kind !== "empty")).toHaveLength(47);
  });

  it("LEV : 7 images lues, 6 jouées ; seule la palette de la première s'applique", () => {
    const lev = decodeBin(readOriginal("LEV.BIN"), "LEV.BIN");
    expect(lev.frames).toHaveLength(7);
    expect(lev.played).toBe(6);
  });

  it("les 33 .BIN se décodent dans le format attendu", () => {
    const names = listOriginal(byExtension("BIN"));
    expect(names).toHaveLength(33);
    const formats = names.map((name) => decodeBin(readOriginal(name), name).format);
    expect(formats.filter((format) => format === "SSN")).toHaveLength(7);
  });
});
