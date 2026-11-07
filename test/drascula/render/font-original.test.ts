import { describe, expect, it } from "vitest";
import { parseAlg } from "../../../src/games/drascula/data/alg";
import { parseDat } from "../../../src/games/drascula/data/dat";
import { FONT_SHEET, GameFont } from "../../../src/games/drascula/render/font";
import { hasOriginalFiles, readOriginal } from "../helpers";

/**
 * La police du jeu d'origine : « Il y a longtemps… » (histoire de l'ivrogne, chapitre 2) s'affiche « ¡L Y A LONGTEMPS… » parce que le
 * glyphe du « I » de `95.ALG` est un point suivi d'un trait, le même dessin que « ¡ ». Ce n'est pas un défaut du portage : la table de
 * `drascula.dat` et la feuille sont celles de ScummVM, qui dessine pareil. Tous les « I » du jeu ont cette forme.
 */
describe.skipIf(!hasOriginalFiles)("police d'origine", () => {
  const dat = parseDat(readOriginal("drascula.dat"), { languages: ["en", "es", "de", "fr", "it"] });
  const font = new GameFont(dat.charMaps);
  const sheet = parseAlg(readOriginal(FONT_SHEET)).pixels;

  it("« I » et « i » ont le même glyphe, à la colonne 78 de la rangée des lettres", () => {
    expect(font.glyphOrigin("I".charCodeAt(0))).toEqual({ x: 78, y: 158 });
    expect(font.glyphOrigin("i".charCodeAt(0))).toEqual({ x: 78, y: 158 });
  });

  it("ce glyphe est un point, un vide, puis un trait de trois lignes (aucune barre en haut ni en bas, comme « i » ou « ¡ »)", () => {
    const ink = (row: number) => [...Array(8).keys()].filter((x) => sheet[(158 + row) * 320 + 78 + x] === 254);
    expect(ink(0)).toEqual(ink(2));
    expect(ink(1)).toEqual([]);
    for (let row = 2; row < 5; row++) expect(ink(row), `rangée ${row}`).toEqual(ink(2));
    expect(ink(5)).toEqual([]);
    expect(ink(0).length).toBeLessThanOrEqual(2);
  });
});
