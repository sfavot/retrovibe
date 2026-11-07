import { describe, expect, it } from "vitest";
import { decodeOffsets, parseSsn, SsnDecoder } from "../../../src/games/drascula/data/bin-ssn";
import { byExtension, encodeRle, hasOriginalFiles, listOriginal, readOriginal, sampleImage } from "../helpers";

const u32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
const rleChunk = (pixels: Uint8Array) => {
  const data = encodeRle(pixels);
  return [0, 1, ...u32(data.length), ...data];
};
/** Série de décalages qui écrit `values` à `offset`. */
const offsetRun = (offset: number, values: number[]) => [offset & 0xff, offset >> 8, values.length, ...values];
const offsetChunk = (...runs: number[][]) => {
  const data = runs.flat();
  return [0, 2, ...u32(data.length), ...data];
};
const palette = Array.from({ length: 768 }, (_, i) => i % 64);

describe("decodeOffsets", () => {
  it("écrit chaque série à son décalage dans un tampon remis à zéro", () => {
    const image = decodeOffsets(Uint8Array.from([...offsetRun(5, [1, 2, 3]), ...offsetRun(63999, [9])]));
    expect(image).toHaveLength(64000);
    expect([...image.subarray(4, 9)]).toEqual([0, 1, 2, 3, 0]);
    expect(image[63999]).toBe(9);
  });

  it("accepte une série qui dépasse l'image (tampon de 64 256 octets) sans la garder", () => {
    const image = decodeOffsets(Uint8Array.from(offsetRun(64100, [1, 2, 3])));
    expect(image).toHaveLength(64000);
    expect(image.every((value) => value === 0)).toBe(true);
  });

  it("refuse une série tronquée ou hors du tampon", () => {
    expect(() => decodeOffsets(Uint8Array.of(1, 0))).toThrow(/tronquée/);
    expect(() => decodeOffsets(Uint8Array.of(1, 0, 5, 1, 2))).toThrow(/hors limites/);
    expect(() => decodeOffsets(Uint8Array.from(offsetRun(64255, [1, 2])))).toThrow(/hors limites/);
  });
});

describe("parseSsn et SsnDecoder (données synthétiques)", () => {
  const first = sampleImage(11);
  const second = sampleImage(12);
  const bytes = Uint8Array.from([4, ...palette, ...rleChunk(first), 6, 6, ...offsetChunk(offsetRun(0, [0xff, 0xf0])), 3]);

  it("découpe les blocs : palette, images, images vides, fin", () => {
    const file = parseSsn(bytes);
    expect(file.chunks.map((chunk) => chunk.kind)).toEqual(["palette", "image", "empty", "empty", "image"]);
    expect(file.bytesRead).toBe(bytes.length);
    expect(file.chunks[1]).toMatchObject({ kind: "image", compression: 1 });
    expect(file.chunks[4]).toMatchObject({ kind: "image", compression: 2 });
  });

  it("copie la première image puis combine les suivantes par XOR", () => {
    const decoder = new SsnDecoder(parseSsn(bytes));
    decoder.step();
    expect(decoder.palette).toEqual(Uint8Array.from(palette));
    expect(decoder.imagesShown).toBe(0);
    decoder.step();
    expect(decoder.screen).toEqual(first);
    decoder.step();
    decoder.step();
    expect(decoder.imagesShown).toBe(1);
    expect(decoder.screen).toEqual(first);
    decoder.step();
    expect(decoder.imagesShown).toBe(2);
    expect(decoder.screen[0]).toBe(first[0] ^ 0xff);
    expect(decoder.screen[1]).toBe(first[1] ^ 0xf0);
    expect(decoder.screen[2]).toBe(first[2]);
    expect(decoder.done).toBe(true);
    expect(decoder.step()).toBeNull();
  });

  it("refait une image par XOR de deux images RLE", () => {
    const stream = Uint8Array.from([...rleChunk(first), ...rleChunk(first.map((v, i) => v ^ second[i])), 3]);
    const decoder = new SsnDecoder(parseSsn(stream));
    while (decoder.step());
    expect(decoder.screen).toEqual(Uint8Array.from(second));
  });

  it("refuse un type de bloc inconnu, une compression inconnue, une troncature et l'absence de fin", () => {
    expect(() => parseSsn(Uint8Array.of(9))).toThrow(/type de bloc 9/);
    expect(() => parseSsn(Uint8Array.of(0, 7, 0, 0, 0, 0, 3))).toThrow(/compression 7/);
    expect(() => parseSsn(Uint8Array.of(0, 1, 100, 0, 0, 0, 1, 2))).toThrow(/image tronquée/);
    expect(() => parseSsn(Uint8Array.of(4, 1, 2, 3))).toThrow(/palette tronquée/);
    expect(() => parseSsn(Uint8Array.of(6, 6))).toThrow(/bloc de fin absent/);
  });
});

describe.skipIf(!hasOriginalFiles)("cinématiques .BIN au format SSN du jeu", () => {
  const SSN = ["CDR.BIN", "CRD.BIN", "INTRO.BIN", "LOGOALC.BIN", "LOGODDM.BIN", "QPC.BIN", "SCROLLB.BIN"];
  const tryParse = (name: string) => {
    try {
      const bytes = readOriginal(name);
      return parseSsn(bytes).bytesRead === bytes.length;
    } catch {
      return false;
    }
  };

  it("parcourt les 7 fichiers SSN jusqu'au dernier octet, et aucun des 26 autres", () => {
    const names = listOriginal(byExtension("BIN"));
    expect(names).toHaveLength(33);
    expect(names.filter(tryParse)).toEqual(SSN);
  });

  it("commence chaque flux par une palette 6 bits (valeurs de 0 à 63) puis des images", () => {
    for (const name of SSN) {
      const file = parseSsn(readOriginal(name));
      const first = file.chunks[0];
      expect(first.kind, name).toBe("palette");
      if (first.kind === "palette") expect(Math.max(...first.palette), name).toBeLessThanOrEqual(63);
      expect(file.chunks.filter((chunk) => chunk.kind === "palette"), name).toHaveLength(1);
    }
  });

  it("décode toutes les images de chaque fichier", () => {
    const shown: Record<string, number> = {};
    for (const name of SSN) {
      const decoder = new SsnDecoder(parseSsn(readOriginal(name)));
      while (decoder.step());
      shown[name] = decoder.imagesShown;
    }
    expect(shown).toEqual({ "CDR.BIN": 79, "CRD.BIN": 36, "INTRO.BIN": 542, "LOGOALC.BIN": 71, "LOGODDM.BIN": 47, "QPC.BIN": 9, "SCROLLB.BIN": 72 });
  });

  it("mélange les deux compressions : RLE pour quelques images, décalages pour les autres", () => {
    const counts = (name: string) => {
      const chunks = parseSsn(readOriginal(name)).chunks;
      const compression = (n: number) => chunks.filter((chunk) => chunk.kind === "image" && chunk.compression === n).length;
      return [compression(1), compression(2)];
    };
    expect(counts("INTRO.BIN")).toEqual([34, 508]);
    expect(counts("LOGODDM.BIN")).toEqual([0, 47]);
    expect(counts("QPC.BIN")).toEqual([3, 6]);
  });

  it("rend l'image attendue après combinaison (INTRO, image 300 : carte « Music: Emilio de Paz. », fond 0)", () => {
    const decoder = new SsnDecoder(parseSsn(readOriginal("INTRO.BIN")));
    while (decoder.step() && decoder.imagesShown < 300);
    expect(decoder.imagesShown).toBe(300);
    expect(decoder.screen[0]).toBe(0);
    // Somme pondérée de contrôle, calculée sur un rendu contrôlé à l'œil.
    const checksum = decoder.screen.reduce((sum, value, i) => (sum + value * ((i % 251) + 1)) % 1000003, 0);
    expect(checksum).toBe(336800);
  });
});
