import { describe, expect, it } from "vitest";
import { FRENCH_DIVERTED_CODES, gameCharToUnicode, toUnicode } from "../../../src/games/bass/data/charset";
import { SkyFont } from "../../../src/games/bass/data/font";
import { FONT_CONTROL_PANEL, FONT_LINK, FONT_MAIN, Language } from "../../../src/games/bass/data/ids";
import { SkyTexts } from "../../../src/games/bass/data/text";
import { hasOriginalFiles, skyDisk } from "./helpers";

/** « Contrema_tre POTTS! … » (section 2). */
const TEXT_FOREMAN = 8617;

describe("charset", () => {
  it("traduit les codes détournés et laisse le reste", () => {
    expect(toUnicode("Temp+rature, =tre s>r, /a, ^a, o@, [, ], {, bo_te")).toBe("Température, être sûr, ça, Ça, oô, â, è, ï, boîte");
    expect(gameCharToUnicode(0x41)).toBe("A");
    expect(gameCharToUnicode(0x91)).toBe("à");
  });
});

describe.skipIf(!hasOriginalFiles)("polices sur les vrais fichiers", () => {
  const disk = skyDisk();
  const main = new SkyFont(disk.load(FONT_MAIN), 0);

  it("lit les trois polices", () => {
    expect(disk.load(FONT_MAIN)).toHaveLength(6128);
    expect(main.glyphCount).toBe(125);
    expect(main.charHeight).toBe(12);
    const control = new SkyFont(disk.load(FONT_CONTROL_PANEL), 2);
    const link = new SkyFont(disk.load(FONT_LINK), 1);
    expect(control.glyphCount).toBeGreaterThan(90);
    expect(link.charSpacing).toBe(1);
    expect(link.glyphCount).toBeGreaterThan(90);
  });

  it("dessine un glyphe avec contour 240 comme makeGameCharacter", () => {
    const pitch = 16;
    const buffer = new Uint8Array(pitch * 12);
    const next = main.draw(0x4f, buffer, 0, pitch, 241); // O
    expect(next).toBe(main.advance(0x4f));
    expect(buffer.includes(241)).toBe(true);
    expect(buffer.includes(240)).toBe(true);
    // Chaque pixel de la sortie correspond à l'art ASCII : `#` texte, `.` contour, ` ` transparent.
    const art = main.ascii(0x4f);
    art.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) expect(buffer[y * pitch + x]).toBe(row[x] === "#" ? 241 : row[x] === "." ? 240 : 0);
    });
    expect(() => main.draw(0x4f, new Uint8Array(4), 0, pitch, 241)).toThrow(RangeError);
    expect(() => main.rawWidth(0x20 + 125)).toThrow(RangeError);
  });

  it("a un glyphe non vide pour chaque code des textes français et une traduction Unicode", () => {
    const texts = new SkyTexts(disk, Language.french);
    const used = new Set<number>();
    for (let section = 0; section < 8; section++) {
      for (let rank = 0; rank < texts.lineCount(section); rank++) for (const ch of texts.getText((section << 12) | rank)) used.add(ch.charCodeAt(0));
    }
    // Codes de contrôle : la tabulation (9) termine des textes anglais laissés dans les fichiers, sans glyphe.
    const printable = [...used].filter((code) => code >= 0x20);
    expect([...used].filter((code) => code < 0x20)).toEqual([9]);
    for (const code of printable) {
      expect(code < 0x20 + main.glyphCount, `code ${code}`).toBe(true);
      if (code !== 0x20) expect(main.hasInk(code), `glyphe ${code}`).toBe(true);
      const char = gameCharToUnicode(code);
      expect(char, `code ${code}`).toHaveLength(1);
      // Aucun code non ASCII (>= 0x7F) ne reste sans traduction explicite.
      if (code >= 0x7f) expect(FRENCH_DIVERTED_CODES, `code ${code}`).toContain(code);
    }
  });

  it("décode des lignes françaises avec leurs accents", () => {
    const texts = new SkyTexts(disk, Language.french);
    expect(toUnicode(texts.getText(21))).toBe("Comment pouvez-vous être sûr que c'est à vous?");
    expect(toUnicode(texts.getText(12))).toBe("A quoi ça sert?");
    expect(toUnicode(texts.getText(91))).toBe("Qu'est-ce que c'est que ÇA?");
    expect(toUnicode(texts.getText(153))).toBe("Etat du Plasma: ionisé à 96%");
    expect(toUnicode(texts.getText(290))).toBe("Après l'embargo imposé récemment par");
    // 0x5F dessine un « î » (glyphe de la police 60150), relevé dans les répliques de la partie complète (vague K).
    expect(main.ascii(0x5f).slice(0, 5)).toEqual(["  .  ", " .#. ", ".#.#.", " ... ", ".##. "]);
    expect(toUnicode(texts.getText(TEXT_FOREMAN))).toBe("Contremaître POTTS! Pourquoi cette machine est-elle ARRETEE?");
  });
});
