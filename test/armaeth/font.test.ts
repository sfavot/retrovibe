import { describe, expect, it } from "vitest";
import { parseGph } from "../../src/games/armaeth/data/font";
import { hasOriginalFiles, readOriginal } from "./helpers";

describe("GPH : données invalides", () => {
  it("refuse une taille incohérente", () => {
    expect(() => parseGph(new Uint8Array(100))).toThrow(/GPH invalide/);
  });
});

describe.skipIf(!hasOriginalFiles)("police d'Armaeth (fichiers du jeu)", () => {
  const bytes = readOriginal("A1FGPH.SYS");
  const font = parseGph(bytes);

  it("lit l'en-tête 5 × 7 / 718 octets et consomme le fichier", () => {
    expect(bytes.length).toBe(1236);
    expect([font.cellWidth, font.cellHeight, font.data.length]).toEqual([5, 7, 718]);
    expect(font.offsets).toHaveLength(256);
    expect([...font.offsets].filter((w) => w !== 0)).toHaveLength(124);
  });

  it("dessine un A de 4 × 5 pixels", () => {
    const a = font.glyph(0x41);
    expect([a.width, a.firstRow, a.lastRow]).toEqual([4, 1, 5]);
    const rows = [];
    const bitmap = font.bitmap(0x41);
    for (let y = 0; y < 7; y++) rows.push([...bitmap.subarray(y * 4, y * 4 + 4)].join(""));
    expect(rows).toEqual(["0000", "0110", "1001", "1111", "1001", "1001", "0000"]);
  });

  it("les accents du français ont un glyphe propre, l'espace utilise le glyphe de repli", () => {
    for (const code of [0x82, 0x85, 0x88, 0x8a, 0x87, 0x93, 0x97]) {
      expect(font.offsets[code], code.toString(16)).not.toBe(0);
    }
    expect(font.offsets[0x20]).toBe(0);
    const space = font.glyph(0x20);
    expect(space.width).toBe(2);
    expect([...space.rows]).toEqual([0]);
  });

  it("mesure un texte", () => {
    const text = Uint8Array.from([..."AA"].map((c) => c.charCodeAt(0)));
    expect(font.measure(text)).toBe(8);
    expect(font.measure(text, 1)).toBe(9);
    expect(font.measure(new Uint8Array())).toBe(0);
  });
});
