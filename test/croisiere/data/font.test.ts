import { describe, expect, it } from "vitest";
import { glyphPixels, parseFont } from "../../../src/games/croisiere/data/font";
import { FONT_CHARACTER_TABLE, NO_GLYPH } from "../../../src/games/croisiere/data/tables";
import { CruiseVolumes } from "../../../src/games/croisiere/data/volumes";
import { originalFiles } from "../../support/original";

const original = originalFiles("croisiere", "VOL.CNF");
const hasOriginalFiles = original.has && ["D1", "D2", "D3", "D4", "D5", "SYSTEM.FNT"].every((name) => original.list((n) => n === name).length === 1);

/** FNT minimal : 2 glyphes (un de 2 lignes sur 3 colonnes, un vide), espacements −1. */
function tinyFont(): Uint8Array {
  const out = new Uint8Array(4 + 14 + 24 + 8);
  const view = new DataView(out.buffer);
  out.set([0x46, 0x4e, 0x54, 0]);
  view.setUint32(4, out.length - 4);
  view.setUint32(8, 14 + 24); // décalage des glyphes
  view.setInt16(12, 2);
  view.setInt16(14, -1);
  view.setInt16(16, -1);
  const entry = (i: number, offset: number, h: number, h2: number, w: number) => {
    const at = 18 + 12 * i;
    view.setUint32(at, offset);
    view.setInt16(at + 6, h);
    view.setInt16(at + 8, h2);
    view.setInt16(at + 10, w);
  };
  entry(0, 0, 2, 1, 3);
  entry(1, 8, 0, 0, 4);
  const glyphs = 4 + 14 + 24;
  view.setUint16(glyphs, 0b1010000000000000); // masque ligne 0 : pixels 0 et 2
  view.setUint16(glyphs + 2, 0b1110000000000000); // masque ligne 1 : pixels 0, 1, 2
  view.setUint16(glyphs + 4, 0b1000000000000000); // couleur ligne 0 : pixel 0 en index 2
  view.setUint16(glyphs + 6, 0b0100000000000000); // couleur ligne 1 : pixel 1 en index 2
  return out;
}

describe("police FNT (synthétique)", () => {
  it("lit l'en-tête, les métriques et les glyphes à deux plans", () => {
    const font = parseFont(tinyFont());
    expect([font.hSpacing, font.vSpacing, font.lineHeight, font.glyphs.length]).toEqual([-1, -1, 2, 2]);
    const g = font.glyphs[0]!;
    expect([g.charHeight, g.height2, g.charWidth]).toEqual([2, 1, 3]);
    expect(Array.from(glyphPixels(g))).toEqual([2, 0, 1, 1, 2, 1]);
    expect(glyphPixels(font.glyphs[1]!)).toHaveLength(0);
  });

  it("refuse une signature fausse, des descripteurs ou des glyphes hors du fichier", () => {
    expect(() => parseFont(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/FNT/);
    expect(() => parseFont(tinyFont().subarray(0, 30))).toThrow(/descripteurs/);
    expect(() => parseFont(tinyFont().subarray(0, 4 + 14 + 24 + 4))).toThrow(/glyphe 0/);
  });
});

describe("table des caractères français", () => {
  it("mappe l'ASCII 0x21..0x7D sur les glyphes 0..92 et les accents sur 93..118", () => {
    expect(FONT_CHARACTER_TABLE).toHaveLength(256);
    expect(FONT_CHARACTER_TABLE[0x21]).toBe(0);
    expect(FONT_CHARACTER_TABLE[0x41]).toBe(32);
    expect(FONT_CHARACTER_TABLE[0x7d]).toBe(92);
    const glyph = (c: string) => FONT_CHARACTER_TABLE[c.charCodeAt(0)];
    expect([..."àäéèêëîïôöùûÅÄÊËÎÏÖØÛÜçßæâ"].map(glyph)).toEqual([...Array(26)].map((_, i) => 93 + i));
    expect(Array.from(FONT_CHARACTER_TABLE).filter((g) => g !== NO_GLYPH)).toHaveLength(93 + 26);
  });

  it("ne dessine ni l'espace, ni la plupart des majuscules accentuées, ni œ", () => {
    for (const byte of [0x20, 0x7e, 0x7f, 0xc0, 0xc9, 0xc8, 0xc7, 0x8c, 0x9c, 0x92, 0xab]) expect(FONT_CHARACTER_TABLE[byte]).toBe(NO_GLYPH);
  });
});

describe.skipIf(!hasOriginalFiles)("police FNT (fichiers originaux)", () => {
  it("SYSTEM.FNT : 120 glyphes, espacements −1, hauteur de ligne 13, largeurs connues", () => {
    const font = parseFont(original.read("SYSTEM.FNT"));
    expect([font.glyphs.length, font.hSpacing, font.vSpacing, font.lineHeight]).toEqual([120, -1, -1, 13]);
    expect(font.glyphs.slice(0, 12).map((g) => g.charWidth)).toEqual([3, 5, 7, 6, 8, 8, 4, 6, 6, 8, 7, 4]);
    expect(font.glyphs[32]!.charWidth).toBe(6); // « A »
    expect(font.glyphs.every((g) => g.charWidth <= 16)).toBe(true);
    // « A » : 6 × 11, forme reconnaissable
    expect(Array.from(glyphPixels(font.glyphs[32]!)).join("")).toBe("001100012210121121121121121121122221121121121121121121121121010010");
  });

  it("MED.FNT (volumes) a la même structure", () => {
    const volumes = CruiseVolumes.open((name) => original.read(name));
    const font = parseFont(volumes.readFile("MED.FNT"));
    expect([font.glyphs.length, font.hSpacing, font.lineHeight]).toEqual([120, 0, 12]);
    expect(font.glyphs.slice(0, 5).map((g) => g.charWidth)).toEqual([3, 7, 9, 7, 9]);
  });
});
