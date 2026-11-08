import { describe, expect, it } from "vitest";
import { decodePcx } from "../../../src/games/fotaq/data/pcx";
import { dataFiles, hasOriginalFiles, readOriginal } from "../helpers";

/** PCX synthétique : version 5, 8 bits, un plan, palette 256 couleurs ; `rle` est la suite d'octets codés. */
function makePcx(width: number, height: number, bytesPerLine: number, rle: number[], paletteBase = 7): Uint8Array {
  const header = new Uint8Array(128);
  const view = new DataView(header.buffer);
  header[0] = 0x0a;
  header[1] = 5;
  header[2] = 1;
  header[3] = 8;
  view.setUint16(8, width - 1, true);
  view.setUint16(10, height - 1, true);
  header[65] = 1;
  view.setUint16(66, bytesPerLine, true);
  const palette = Uint8Array.from({ length: 768 }, (_, i) => (i + paletteBase) & 0xff);
  return Uint8Array.from([...header, ...rle, 0x0c, ...palette]);
}

describe("decodePcx (données synthétiques)", () => {
  it("décode des octets isolés et des répétitions, et retire le remplissage de fin de ligne", () => {
    // 3 x 2, 4 octets par ligne : ligne 1 = 1,2,2 + 9 (remplissage), ligne 2 = 0xC0 isolé, 5, 5 + 9.
    const pcx = decodePcx(makePcx(3, 2, 4, [1, 0xc2, 2, 9, 0xc1, 0xc0, 0xc2, 5, 9]));
    expect([pcx.width, pcx.height]).toEqual([3, 2]);
    expect([...pcx.pixels]).toEqual([1, 2, 2, 0xc0, 5, 5]);
    expect(pcx.palette).toHaveLength(768);
    expect(pcx.palette[0]).toBe(7);
  });

  it("refuse une signature, une version ou une palette absentes", () => {
    const good = makePcx(2, 1, 2, [4, 5]);
    expect(() => decodePcx(good.subarray(0, 50))).toThrow(/trop court/);
    expect(() => decodePcx(Uint8Array.from(good, (b, i) => (i === 0 ? 0 : b)))).toThrow(/signature/);
    expect(() => decodePcx(Uint8Array.from(good, (b, i) => (i === 1 ? 3 : b)))).toThrow(/version/);
    expect(() => decodePcx(Uint8Array.from(good, (b, i) => (i === good.length - 769 ? 0 : b)))).toThrow(/palette absente/);
  });

  it("refuse des données tronquées ou en trop avant la palette", () => {
    expect(() => decodePcx(makePcx(4, 2, 4, [1, 2, 3, 4, 5]))).toThrow(/tronquées/);
    expect(() => decodePcx(makePcx(2, 1, 2, [1, 2, 3]))).toThrow(/avant la palette/);
  });
});

describe.skipIf(!hasOriginalFiles)("images PCX du jeu", () => {
  const names = dataFiles("PCX");
  const images = new Map(names.map((name) => [name, decodePcx(readOriginal(name))]));

  it("décode les 128 fichiers jusqu'à la palette", () => {
    expect(names).toHaveLength(128);
    for (const [name, image] of images) {
      expect(image.pixels, name).toHaveLength(image.width * image.height);
      expect(image.palette, name).toHaveLength(768);
    }
  });

  it("relève les dimensions annoncées : 67 en 320x200, 40 en 320x150, 11 en 640x200, 4 en 640x150, 4 en 320x256, 1 en 480x200, 1 en 320x40", () => {
    const counts = new Map<string, number>();
    for (const image of images.values()) {
      const key = `${image.width}x${image.height}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(Object.fromEntries([...counts].sort())).toEqual({
      "320x150": 40,
      "320x200": 67,
      "320x256": 4,
      "320x40": 1,
      "480x200": 1,
      "640x150": 4,
      "640x200": 11,
    });
  });

  it("lit le décor B1 en 640x200 avec une palette en 8 bits", () => {
    const b1 = images.get("B1.PCX")!;
    expect([b1.width, b1.height]).toEqual([640, 200]);
    // La palette est en 8 bits (0 à 255) et non en 6 bits : une valeur dépasse 63.
    expect(Math.max(...b1.palette)).toBeGreaterThan(63);
  });

  it("lit le panneau en 320x40", () => {
    const panel = images.get("PANEL.PCX")!;
    expect([panel.width, panel.height]).toEqual([320, 40]);
  });
});
