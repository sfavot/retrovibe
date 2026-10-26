import { describe, expect, it } from "vitest";
import { parseBd } from "../../src/games/swiv3d/data/bd";
import { decodeRleSprite, GLYPH_COUNT, parseFont, parseRleSprites, renderText, TRANSPARENT } from "../../src/games/swiv3d/data/font";
import { parseStrings } from "../../src/games/swiv3d/data/strings";
import { hasOriginalFiles, readOriginal } from "./helpers";

describe("sprites RLE à 4 plans (données synthétiques)", () => {
  // Plan 0 : saute 1 octet, banque 0x70, 2 pixels de teinte 0xa, puis saute 80 octets (une ligne), 1 pixel de teinte 3 ; plans 1 à 3 vides.
  const block = Uint8Array.from([4, 0, 0, 0, 0x81, 0x07, 0x2a, 0x80, 0x4d, 0x00, 0x13, 0xff, 0xff, 0xff, 0xff]);

  it("décode les plans, la banque, les sauts courts et longs", () => {
    const sprite = decodeRleSprite(block, 4);
    // Pixels du plan 0 : colonnes 4 et 8 de la ligne 0 (adresses 1 et 2), puis, après le saut de 0x4d octets, la colonne 0 de la ligne 1 (adresse 80).
    expect(sprite).toMatchObject({ x: 0, y: 0, width: 9, height: 2 });
    expect([sprite.rows[0], sprite.rows[4], sprite.rows[8]]).toEqual([TRANSPARENT, 0x7a, 0x7a]);
    expect(sprite.rows[9]).toBe(0x73);
    expect(sprite.rows[10]).toBe(TRANSPARENT);
  });

  it("lit la table d'offsets d'un bloc", () => {
    expect(parseRleSprites(block)).toHaveLength(1);
  });
});

describe.skipIf(!hasOriginalFiles)("police de GLOBAL.BD (fichier du jeu)", () => {
  const bd = parseBd(readOriginal("GLOBAL.BD"), "GLOBAL.BD");
  const font = parseFont(bd);

  it("contient 384 glyphes aux formes et avances connues", () => {
    expect(font.glyphs).toHaveLength(GLYPH_COUNT);
    expect(font.glyphs[65]).toMatchObject({ x: 0, y: 4, width: 13, height: 13, advance: 11 });
    expect(font.glyphs[0x82]).toMatchObject({ width: 11, height: 13, advance: 9 });
    expect(font.glyphs[32]).toMatchObject({ width: 0, height: 0, advance: 6 });
    expect(font.glyphs.every((g) => g.rows.length === g.width * g.height)).toBe(true);
  });

  it("applique la page de glyphes aux caractères 128-255", () => {
    expect(font.glyphIndex(65)).toBe(65);
    expect(font.glyphIndex(0x7f)).toBe(0);
    expect(font.glyphIndex(0x82, 0)).toBe(0x82);
    expect(font.glyphIndex(0x82, 1)).toBe(0x102);
  });

  it("mesure et dessine un texte français accentué", () => {
    const strings = parseStrings(bd);
    const text = strings.getBytes(1, 1, 15)!; // « Crédits »
    const width = font.measure(text);
    expect(width).toBe(Array.from(text, (c) => font.glyphs[c]!.advance).reduce((a, b) => a + b));
    const image = renderText(font, text);
    expect(image.width).toBeGreaterThanOrEqual(width);
    expect(image.rows.some((row) => row !== TRANSPARENT)).toBe(true);
  });
});
