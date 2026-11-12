import { describe, expect, it } from "vitest";
import { LureFont } from "../../../src/games/lure/data/font";
import { Surface } from "../../../src/games/lure/render/surface";
import { drawString, textWidth, wordWrap } from "../../../src/games/lure/render/text";
import { hasOriginalFiles } from "../data/helpers";
import { lureData } from "../data/catalog-helper";

/** Police de 3 glyphes (codes 32, 33, 34) : espace vide, barre pleine de 3 colonnes, point en bas à droite. */
function tinyFont(): LureFont {
  const bytes = new Uint8Array(24);
  bytes.fill(0xe0, 8, 16); // glyphe 33 : colonnes 0 à 2 allumées sur 8 lignes
  bytes[16 + 7] = 0x01; // glyphe 34 : un point en (7, 7)
  return new LureFont(bytes);
}

describe("texte", () => {
  it("mode proportionnel : avance = colonne la plus à droite + 1 (largeur du dessin) + 2, espace = 4", () => {
    const font = tinyFont();
    expect(font.advance(32, true)).toBe(4);
    expect(textWidth(font, "!!")).toBe(2 * (2 + 2));
    expect(textWidth(font, "\"")).toBe(7 + 2);
  });

  it("dessine opaque (fond à 0) ou transparent, en proportionnel ou en police fixe", () => {
    const font = tinyFont();
    const s = new Surface(40, 8);
    s.data.fill(9);
    drawString(font, s, 1, 0, "!!", true, 5);
    // deux barres de 3 colonnes à 4 pixels d'écart
    expect([...s.data.subarray(0, 12)]).toEqual([9, 5, 5, 5, 9, 5, 5, 5, 9, 9, 9, 9]);
    const opaque = new Surface(40, 8);
    opaque.data.fill(9);
    drawString(font, opaque, 0, 0, "!", false, 5, false);
    expect([...opaque.data.subarray(0, 9)]).toEqual([5, 5, 5, 0, 0, 0, 0, 0, 9]);
  });

  it("coupe aux espaces et aux retours à la ligne, comme `Surface::wordWrap`", () => {
    const font = tinyFont();
    // chaque « ! » mesure 4, une espace 4 : trois mots de 2 barres (8 px) + espace font 12 + 8 ; largeur 20 → un mot par ligne si > 20
    expect(wordWrap(font, "!! !!", 100)).toEqual(["!! !!"]);
    expect(wordWrap(font, "!! !! !!", 16)).toEqual(["!!", "!!", "!!"]);
    expect(wordWrap(font, "!!\n!!", 100)).toEqual(["!!", "!!"]);
    expect(wordWrap(font, "", 100)).toEqual([""]);
  });
});

describe.skipIf(!hasOriginalFiles)("police du jeu : chaque caractère des textes a un glyphe", () => {
  it("tous les textes, les noms et les textes de l'interface n'utilisent que des codes dessinables", () => {
    const data = lureData();
    const missing = new Set<number>();
    const check = (text: string): void => {
      for (let i = 0; i < text.length; i++) if (!data.font.has(text.charCodeAt(i)) && text.charCodeAt(i) !== 10) missing.add(text.charCodeAt(i));
    };
    for (const ranges of [[0, 400], [2000, 3278], [4000, 4126]] as const) {
      for (let id = ranges[0]; id < ranges[1]; id++) {
        const decoded = data.texts.decode(id);
        if (!decoded) continue;
        for (const part of decoded.parts) if (part.kind === "text") check(part.value);
      }
    }
    for (let i = 0; i < data.texts.nameCount; i++) check(String.fromCharCode(...data.texts.nameCodes(i)));
    for (const ui of data.uiStrings) check(ui);
    expect([...missing]).toEqual([]);
  });
});
