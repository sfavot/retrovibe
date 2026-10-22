import { describe, expect, it } from "vitest";
import { LETTER_SPACING, SPACE_WIDTH, measureText, parsePfn } from "../../src/games/teleportaschtroumpf/data/font";
import { hasOriginalFiles, listData, readData, withExtension } from "./helpers";

const rows = (bitmap: Uint8Array, width: number) => {
  const out: string[] = [];
  for (let i = 0; i < bitmap.length; i += width) out.push([...bitmap.subarray(i, i + width)].join(""));
  return out;
};

describe("PFN : données invalides", () => {
  it("refuse un en-tête incomplet", () => {
    expect(() => parsePfn(new Uint8Array(7))).toThrow(/PFN invalide/);
  });

  it("refuse une police tronquée", () => {
    // 1 ligne de 1 octet, table annoncée à l'offset 9 mais fichier coupé avant.
    expect(() => parsePfn(Uint8Array.of(0x20, 0, 1, 1, 0, 0, 0, 9))).toThrow(/PFN invalide/);
    // Table d'un nombre impair d'octets.
    expect(() => parsePfn(Uint8Array.of(0x20, 0, 1, 1, 0, 0, 0, 9, 0xff, 0x80, 0x00, 0x00))).toThrow(/PFN invalide/);
  });

  it("refuse un glyphe hors de la bande", () => {
    expect(() => parsePfn(Uint8Array.of(0x20, 0, 1, 1, 0, 0, 0, 9, 0xff, 0x80, 0x00))).not.toThrow();
    expect(() => parsePfn(Uint8Array.of(0x20, 0, 1, 1, 0, 0, 0, 9, 0xff, 0x90, 0x00))).toThrow(/hors de la bande/);
  });

  it("décode une police minimale et mesure un texte", () => {
    // Hauteur 2, 1 octet par ligne ; 0x20 : largeur 0 ; 0x21 : largeur 3 à l'abscisse 0 ; 0x22 : largeur 2 à l'abscisse 3.
    const bytes = Uint8Array.of(0x20, 0, 2, 1, 0, 0, 0, 10, 0xe8, 0x00, 0x00, 0x00, 0x30, 0x00, 0x20, 0x03);
    const font = parsePfn(bytes);
    expect(font.height).toBe(2);
    expect(font.glyphs.get(0x20)).toEqual({ width: 0, bitmap: new Uint8Array(0) });
    expect(rows(font.glyphs.get(0x21)!.bitmap, 3)).toEqual(["111", "000"]);
    expect(rows(font.glyphs.get(0x22)!.bitmap, 2)).toEqual(["01", "00"]);
    expect(measureText(font, Uint8Array.of(0x20, 0x21, 0, 0x21))).toBe(SPACE_WIDTH + LETTER_SPACING + 3 + LETTER_SPACING);
  });
});

describe.skipIf(!hasOriginalFiles)("PFN des fichiers originaux", () => {
  const paths = listData(withExtension("PFN"));

  it("décode les 9 polices", () => {
    expect(paths).toHaveLength(9);
    for (const path of paths) {
      const font = parsePfn(readData(path));
      for (const glyph of font.glyphs.values()) {
        expect(glyph.bitmap, path).toHaveLength(glyph.width * font.height);
        expect(glyph.width, path).toBeLessThanOrEqual(15);
      }
    }
  });

  it("donne hauteur, premier code et nombre de glyphes de chaque police", () => {
    const summary = Object.fromEntries(
      paths.map((path) => {
        const font = parsePfn(readData(path));
        return [path.split("/").pop(), [font.height, font.firstChar, font.glyphs.size]];
      }),
    );
    expect(summary).toEqual({
      "S40A001F.PFN": [12, 1, 253],
      "S40A002F.PFN": [10, 32, 223],
      "S40A003F.PFN": [10, 32, 223],
      "S40A004F.PFN": [12, 1, 253],
      "S52D0.PFN": [12, 1, 253],
      "S52D001F.PFN": [16, 32, 223],
      "S52D1.PFN": [10, 32, 223],
      "S52D2.PFN": [10, 32, 223],
      "S52D3.PFN": [12, 1, 253],
    });
  });

  it("décode « I » et « - » de S52D2", () => {
    const font = parsePfn(readData("S52/S52D/S52D2.PFN"));
    const i = font.glyphs.get(0x49)!;
    expect(i.width).toBe(4);
    expect(rows(i.bitmap, 4)).toEqual(["0000", "0000", "0111", "0010", "0010", "0010", "0010", "0010", "0111", "0000"]);
    const dash = font.glyphs.get(0x2d)!;
    expect(dash.width).toBe(3);
    expect(rows(dash.bitmap, 3)).toEqual(["000", "000", "000", "000", "000", "011", "000", "000", "000", "000"]);
  });

  it("mesure un texte CP437 avec largeur + 1 par caractère", () => {
    const font = parsePfn(readData("S52/S52D/S52D2.PFN"));
    const text = Uint8Array.of(0x49, 0x2d, 0x49);
    expect(measureText(font, text)).toBe(4 + 1 + 3 + 1 + 4 + 1);
  });
});
