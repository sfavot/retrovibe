import { describe, expect, it } from "vitest";
import { parseVoc, vocToFloat32 } from "../../src/games/teleportaschtroumpf/data/voc";
import { hasOriginalFiles, listData, readData, withExtension } from "./helpers";

function voc(...blocks: number[][]): Uint8Array {
  const header = [...new TextEncoder().encode("Creative Voice File\x1a"), 26, 0, 0x0a, 0x01, 0x29, 0x11];
  return Uint8Array.from([...header, ...blocks.flat(), 0]);
}

describe("parseVoc (données synthétiques)", () => {
  it("lit un bloc de données 8 bits et convertit en flottants", () => {
    const parsed = parseVoc(voc([1, 5, 0, 0, 0xcb, 0, 0x00, 0x80, 0xff]));
    expect(parsed.sampleRate).toBe(18868);
    expect([...parsed.samples]).toEqual([0x00, 0x80, 0xff]);
    expect([...vocToFloat32(parsed)]).toEqual([-1, 0, 127 / 128]);
  });

  it("remplace le silence par 0x80 et concatène les blocs", () => {
    const parsed = parseVoc(voc([1, 3, 0, 0, 0xcb, 0, 0x10], [3, 3, 0, 0, 1, 0, 0xcb], [2, 1, 0, 0, 0x20]));
    expect([...parsed.samples]).toEqual([0x10, 0x80, 0x80, 0x20]);
  });

  it("refuse un codec compressé et une signature invalide", () => {
    expect(() => parseVoc(voc([1, 3, 0, 0, 0xcb, 1, 0x10]))).toThrow(/codec 1/);
    expect(() => parseVoc(new Uint8Array(40))).toThrow(/signature/);
  });
});

describe.skipIf(!hasOriginalFiles)("VOC du jeu", () => {
  const files = listData(withExtension("VOC"));

  it("lit les 975 fichiers", () => {
    expect(files).toHaveLength(975);
    for (const file of files) {
      const parsed = parseVoc(readData(file));
      expect(parsed.samples.length, file).toBeGreaterThan(0);
      expect([11025, 18868, 19231], file).toContain(parsed.sampleRate);
    }
  });

  it("donne fréquence et durée d'un fichier précis", () => {
    const parsed = parseVoc(readData(files[0]));
    const raw = readData(files[0]);
    expect(parsed.sampleRate).toBe(Math.round(1_000_000 / (256 - raw[0x1a + 4])));
    expect(parsed.samples.length).toBe(raw.length - 0x1a - 4 - 2 - 1);
  });
});
