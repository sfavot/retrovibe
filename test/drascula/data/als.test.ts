import { describe, expect, it } from "vitest";
import { ALS_SAMPLE_RATE, alsSamples } from "../../../src/games/drascula/data/als";
import { byExtension, hasOriginalFiles, listOriginal, readOriginal } from "../helpers";

describe("alsSamples (données synthétiques)", () => {
  it("retire les 32 octets de silence de chaque bout", () => {
    const bytes = Uint8Array.from({ length: 100 }, (_, i) => i);
    const samples = alsSamples(bytes, "5.als");
    expect(samples).toHaveLength(36);
    expect(samples[0]).toBe(32);
    expect(samples[35]).toBe(67);
    expect(samples.buffer).toBe(bytes.buffer);
  });

  it("coupe les grands silences de 3.als, à partir de l'octet 73 959", () => {
    const bytes = Uint8Array.from({ length: 145166 }, (_, i) => i & 0xff);
    const samples = alsSamples(bytes, "3.ALS");
    expect(samples.byteOffset).toBe(73959);
    expect(samples).toHaveLength(145166 - 64 - 26306 - 73959);
    // Un autre nom, ou une autre taille, reste traité comme les autres fichiers.
    expect(alsSamples(bytes, "4.als")).toHaveLength(145166 - 64);
    expect(alsSamples(bytes.subarray(0, 145000), "3.als")).toHaveLength(145000 - 64);
  });

  it("refuse un fichier plus court que ses deux marges", () => {
    expect(() => alsSamples(new Uint8Array(63))).toThrow(/trop court/);
  });

  it("joue à 11 025 Hz", () => {
    expect(ALS_SAMPLE_RATE).toBe(11025);
  });
});

describe.skipIf(!hasOriginalFiles)("voix et sons .ALS du jeu", () => {
  const names = listOriginal(byExtension("ALS"));

  it("compte 783 fichiers, de 3 872 à 169 246 octets", () => {
    expect(names).toHaveLength(783);
    const sizes = names.map((name) => readOriginal(name).length);
    expect(Math.min(...sizes)).toBe(3872);
    expect(Math.max(...sizes)).toBe(169246);
    expect([...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)]).toBe(32208);
  });

  it("commence par 32 octets de silence exact (0x80) dans 707 fichiers et finit ainsi dans 714 ; les autres s'en écartent peu", () => {
    let head = 0;
    let tail = 0;
    for (const name of names) {
      const bytes = readOriginal(name);
      if (bytes.subarray(0, 32).every((byte) => byte === 0x80)) head++;
      if (bytes.subarray(bytes.length - 32).every((byte) => byte === 0x80)) tail++;
    }
    expect([head, tail]).toEqual([707, 714]);
    // 1.ALS, qui a servi à l'étude du format, a ses deux marges exactes.
    const first = readOriginal("1.ALS");
    expect(first.subarray(0, 32).every((byte) => byte === 0x80)).toBe(true);
    expect(first.subarray(first.length - 32).every((byte) => byte === 0x80)).toBe(true);
  });

  it("rend les échantillons sans les marges, en une vue du fichier", () => {
    for (const name of names) {
      const bytes = readOriginal(name);
      const samples = alsSamples(bytes, name);
      if (name === "3.ALS") continue;
      expect(samples.length, name).toBe(bytes.length - 64);
    }
  });

  it("3.ALS : le silence initial mesuré est exactement le décalage de départ du contournement", () => {
    const bytes = readOriginal("3.ALS");
    expect(bytes).toHaveLength(145166);
    let silence = 0;
    while (bytes[silence] === 0x80) silence++;
    expect(silence).toBe(73959);
    // Le silence final dépasse de peu les 26 306 octets ignorés (26 336 octets mesurés).
    let tail = 0;
    while (bytes[bytes.length - 1 - tail] === 0x80) tail++;
    expect(tail).toBeGreaterThanOrEqual(26306);
    const samples = alsSamples(bytes, "3.ALS");
    expect(samples).toHaveLength(118796 - 73959);
    expect(samples[0]).not.toBe(0x80);
    expect(samples.byteOffset).toBe(73959);
  });
});
