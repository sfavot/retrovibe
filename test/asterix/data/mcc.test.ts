import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseMcc } from "../../../src/games/asterix/data/mcc";
import { hasOriginalFiles, listOriginal, readOriginal, withSuffix } from "../helpers";

const sha1 = (bytes: Uint8Array) => createHash("sha1").update(bytes).digest("hex");

/** MCC de synthèse : palette `i mod 256`, puis les séries données. */
function build(runs: [color: number, length: number][]): Uint8Array {
  const bytes = new Uint8Array(768 + runs.length * 2);
  for (let i = 0; i < 768; i++) bytes[i] = i & 0xff;
  runs.forEach(([color, length], i) => bytes.set([color, length], 768 + i * 2));
  return bytes;
}

/** Séries de 255 pixels d'une couleur jusqu'à `count` pixels. */
const flat = (color: number, count: number): [number, number][] => {
  const runs: [number, number][] = [];
  for (let left = count; left > 0; left -= 255) runs.push([color, Math.min(255, left)]);
  return runs;
};

describe("parseMcc (sans fichier)", () => {
  it("décode la palette et les séries, une longueur nulle n'écrivant rien", () => {
    const mcc = parseMcc(build([[5, 3], [9, 0], [6, 2], ...flat(1, 64000 - 5)]));
    expect(mcc.palette.length).toBe(768);
    expect(mcc.palette[300]).toBe(300 & 0xff);
    expect([...mcc.pixels.subarray(0, 7)]).toEqual([5, 5, 5, 6, 6, 1, 1]);
    expect(mcc.pixels[63999]).toBe(1);
    expect(mcc.overflow).toBe(0);
  });

  it("coupe la dernière série à la fin de l'image", () => {
    const mcc = parseMcc(build([...flat(2, 63990), [3, 24]]));
    expect(mcc.overflow).toBe(14);
    expect([...mcc.pixels.subarray(63988)]).toEqual([2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
  });

  it("refuse des séries trop courtes, ou des octets après la fin de l'image", () => {
    expect(() => parseMcc(build(flat(1, 63999)))).toThrow("séries épuisées après 63999 pixels");
    expect(() => parseMcc(build([...flat(1, 64000), [1, 1]]))).toThrow("2 octets après la fin");
    expect(() => parseMcc(new Uint8Array(100))).toThrow("trop court");
  });
});

describe.skipIf(!hasOriginalFiles)("parseMcc (original/asterix)", () => {
  it("décode les 80 MCC jusqu'au dernier octet ; seul M49DA005 déborde, de 14 pixels", () => {
    const files = listOriginal(withSuffix(".MCC"));
    expect(files.length).toBe(80);
    const overflowing: Record<string, number> = {};
    const small: string[] = [];
    for (const path of files) {
      const bytes = readOriginal(path);
      const mcc = parseMcc(bytes);
      if (mcc.overflow) overflowing[path] = mcc.overflow;
      if (bytes.length === 1280) {
        // Aplats : 64 000 pixels d'une seule couleur en 256 séries.
        small.push(path);
        expect(new Set(mcc.pixels).size, path).toBe(1);
      }
    }
    expect(overflowing).toEqual({ "MDF/49/M49DA005.MCC": 14 });
    expect(small.length).toBe(3);
  });

  it("donne les pixels attendus sur un échantillon", () => {
    // SHA-1 des 64 000 pixels, calculés à part par un décodeur Python de trois lignes (séries dépliées, puis coupées).
    const expected = {
      "MDF/40/M40DA000.MCC": "9f091c51d5f9b7b15eda40ab4a571f959647e052",
      "MDF/49/M49DA005.MCC": "c8990a69046f77407fc39a4b7d9c0d5721db480f",
    };
    for (const [path, hash] of Object.entries(expected)) expect(sha1(parseMcc(readOriginal(path)).pixels), path).toBe(hash);
  });
});
