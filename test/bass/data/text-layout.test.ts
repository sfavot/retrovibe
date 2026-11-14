import { describe, expect, it } from "vitest";
import { FONT_HEADER_SIZE, SkyFont } from "../../../src/games/bass/data/font";
import { FONT_MAIN, Language } from "../../../src/games/bass/data/ids";
import { DATA_FILE_HEADER_SIZE, parseDataFileHeader } from "../../../src/games/bass/data/header";
import { SkyTexts } from "../../../src/games/bass/data/text";
import { DIALOG_TEXT_WIDTH, MAX_TEXT_LINES, TextAlign, changeTextSpriteColor, layoutText, renderText } from "../../../src/games/bass/data/text-layout";
import { hasOriginalFiles, skyDisk } from "./helpers";

/** Police synthétique : 96 glyphes de 5 pixels de large (`rawWidth` 4), pixel de gauche en couleur, le reste en contour. */
function syntheticFont(fontNumber = 0): SkyFont {
  const data = new Uint8Array(FONT_HEADER_SIZE + 96 * 48);
  data.fill(4, 0, 96);
  for (let glyph = 0; glyph < 96; glyph++) {
    for (let row = 0; row < 12; row++) {
      const at = FONT_HEADER_SIZE + glyph * 48 + row * 4;
      data.set([0x80, 0x00, 0xf8, 0x00], at);
    }
  }
  return new SkyFont(data, fontNumber);
}

describe("mise en page (police synthétique)", () => {
  const font = syntheticFont();

  it("coupe aux espaces", () => {
    const layout = layoutText("AB CD EF", font, 20);
    expect(layout.lines).toEqual(["AB", "CD", "EF"]);
    expect(layout.lineWidths).toEqual([8, 8, 8]);
    expect(layout.lastLineWidth).toBe(8);
    expect(layout.height).toBe(36);
    expect(layout.width).toBe(20);
  });

  it("coupe au caractère quand la ligne n'a pas d'espace", () => {
    const layout = layoutText("ABCDEFGH", font, 20);
    expect(layout.lines).toEqual(["ABCD", "EFGH"]);
    expect(layout.lineWidths).toEqual([16, 16]);
  });

  it("garde une ligne qui tient et refuse plus de 10 lignes", () => {
    expect(layoutText("ABC", font, 128).lines).toEqual(["ABC"]);
    expect(layoutText("", font, 128).lines).toEqual([""]);
    expect(() => layoutText("A ".repeat(MAX_TEXT_LINES + 1), font, 8)).toThrow(RangeError);
    expect(layoutText("A ".repeat(MAX_TEXT_LINES - 1) + "A", font, 8).lines).toHaveLength(MAX_TEXT_LINES);
  });

  it("s'arrête au premier code de contrôle", () => {
    expect(layoutText("AB\tCD", font, 128).lines).toEqual(["AB"]);
  });

  it("dessine un sprite de texte aligné", () => {
    const left = renderText("A", font, TextAlign.left, 20, 241);
    const header = parseDataFileHeader(left.data);
    expect([header.width, header.height, header.spriteSize, header.offsetX, header.offsetY]).toEqual([20, 12, 240, 0, 0]);
    expect(left.data).toHaveLength(DATA_FILE_HEADER_SIZE + 240 + 4);
    const px = (r: ReturnType<typeof renderText>, x: number, y: number) => r.data[DATA_FILE_HEADER_SIZE + y * 20 + x];
    expect([px(left, 0, 0), px(left, 1, 0), px(left, 5, 0)]).toEqual([241, 240, 0]);
    const center = renderText("A", font, TextAlign.center, 20, 241);
    expect(px(center, 8, 0)).toBe(241); // (20 - 4) >> 1
    const right = renderText("A", font, TextAlign.right, 20, 241);
    expect(px(right, 15, 0)).toBe(241); // 20 - 4 - 1
    changeTextSpriteColor(left.data, 200);
    expect([px(left, 0, 0), px(left, 1, 0)]).toEqual([200, 240]);
  });

  it("compte les codes >= 0x80 comme des espaces pour la police des liens", () => {
    const link = syntheticFont(1);
    // Avec spacing 1 chaque glyphe compte 5 ; « A<0x80>B » : la coupure se fait sur le code 0x80 devenu espace.
    expect(layoutText("AAA\x80BBB", link, 20).lines).toEqual(["AAA", "BBB"]);
  });
});

describe.skipIf(!hasOriginalFiles)("mise en page des vrais textes", () => {
  const disk = skyDisk();
  const font = new SkyFont(disk.load(FONT_MAIN), 0);
  const texts = new SkyTexts(disk, Language.french);

  it("tient dans 128 pixels pour les dialogues de la section 2", () => {
    const sample = [5, 429, 926].map((rank) => texts.getText(0x2000 | rank));
    for (const text of sample) {
      const layout = layoutText(text, font, DIALOG_TEXT_WIDTH);
      expect(layout.lines.join(" ")).toBe(text);
      expect(layout.lastLineWidth).toBeLessThan(DIALOG_TEXT_WIDTH);
    }
    expect(layoutText(sample[0]!, font, DIALOG_TEXT_WIDTH).lines.length).toBeGreaterThan(1);
  });

  it("met en page toutes les lignes des sections de dialogue en 128 pixels sans erreur", () => {
    let failures = 0;
    for (const section of [2, 3, 4, 5]) {
      for (let rank = 0; rank < texts.lineCount(section); rank++) {
        try {
          layoutText(texts.getText((section << 12) | rank), font, DIALOG_TEXT_WIDTH);
        } catch {
          failures++;
        }
      }
    }
    expect(failures).toBe(0);
  });
});
