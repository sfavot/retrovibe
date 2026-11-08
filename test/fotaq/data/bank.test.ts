import { describe, expect, it } from "vitest";
import { parseBank } from "../../../src/games/fotaq/data/bank";
import { dataFiles, hasOriginalFiles, readOriginal } from "../helpers";

function u16(...values: number[]): number[] {
  return values.flatMap((v) => [v & 0xff, v >> 8]);
}

describe("parseBank (données synthétiques)", () => {
  it("lit les images, leur ancrage et leurs pixels", () => {
    const bank = parseBank(Uint8Array.from([...u16(2), ...u16(2, 1, 5, 6), 10, 20, ...u16(1, 1, 0, 0), 7]));
    expect(bank.frameCount).toBe(2);
    expect(bank.frame(1)).toMatchObject({ width: 2, height: 1, hotspotX: 5, hotspotY: 6 });
    expect([...bank.frame(1).pixels]).toEqual([10, 20]);
    expect([...bank.frame(2).pixels]).toEqual([7]);
  });

  it("numérote les images à partir de 1", () => {
    const bank = parseBank(Uint8Array.from([...u16(1), ...u16(1, 1, 0, 0), 9]));
    expect(() => bank.frame(0)).toThrow(RangeError);
    expect(() => bank.frame(2)).toThrow(RangeError);
  });

  it("accepte une image vide (largeur ou hauteur nulle)", () => {
    const bank = parseBank(Uint8Array.from([...u16(1), ...u16(0, 3, 1, 1)]));
    expect(bank.frame(1).pixels).toHaveLength(0);
  });

  it("refuse une banque tronquée ou suivie d'octets en trop", () => {
    expect(() => parseBank(Uint8Array.from([...u16(2), ...u16(2, 1, 5, 6), 10, 20]))).toThrow(/tronquée/);
    expect(() => parseBank(Uint8Array.from([...u16(1), ...u16(1, 1, 0, 0), 9, 9]))).toThrow(/après la dernière image/);
    expect(() => parseBank(Uint8Array.from([...u16(1), 1, 0]))).toThrow(/tronquée/);
    expect(() => parseBank(new Uint8Array(1))).toThrow(/trop court/);
  });
});

describe.skipIf(!hasOriginalFiles)("banques de sprites du jeu", () => {
  const names = ["BBK", "ACT", "SAM"].flatMap(dataFiles);
  const banks = new Map(names.map((name) => [name, parseBank(readOriginal(name))]));

  it("parcourt les 281 banques jusqu'au dernier octet : 131 BBK, 64 ACT, 86 SAM", () => {
    expect(names).toHaveLength(281);
    expect(dataFiles("BBK")).toHaveLength(131);
    expect(dataFiles("ACT")).toHaveLength(64);
    expect(dataFiles("SAM")).toHaveLength(86);
  });

  it("compte 5 266 images en tout", () => {
    let frames = 0;
    for (const bank of banks.values()) frames += bank.frameCount;
    expect(frames).toBe(5266);
  });

  it("donne à chaque image des pixels de la taille annoncée", () => {
    for (const [name, bank] of banks) {
      for (const frame of bank.frames) expect(frame.pixels.length, name).toBe(frame.width * frame.height);
    }
  });

  it("lit les banques de Joe : JOE_A.BBK et JOE_E.ACT", () => {
    expect(banks.get("JOE_A.BBK")!.frameCount).toBeGreaterThan(0);
    expect(banks.get("JOE_E.ACT")!.frameCount).toBeGreaterThan(0);
  });

  it("utilise l'indice 0 (transparent) dans les sprites", () => {
    // `Display::blit` masqué ne dessine pas l'indice 0 : les sprites en contiennent bien (fond des images).
    const joe = banks.get("JOE_A.BBK")!.frame(1);
    expect(joe.pixels.some((pixel) => pixel === 0)).toBe(true);
    expect(joe.pixels.some((pixel) => pixel !== 0)).toBe(true);
  });
});
