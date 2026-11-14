import { describe, expect, it } from "vitest";
import { Language, textFile } from "../../../src/games/bass/data/ids";
import { SkyTexts, decodeSectionLine, patchedMessage, sectionLineCount, textIndex, textSection } from "../../../src/games/bass/data/text";
import { HUFFMAN_372 } from "../../../src/games/bass/data/tables/huffman-372";
import { MCODE_NAMES } from "../../../src/games/bass/data/tables/mcode-names";
import { MUSIC_LIST, SFX_DEFS } from "../../../src/games/bass/data/tables/sfx-list";
import { SCRIPT_VAR_NAMES } from "../../../src/games/bass/data/tables/script-var-names";
import { SPEECH_CONVERT } from "../../../src/games/bass/data/tables/speech-convert";
import { PATCHED_MESSAGES } from "../../../src/games/bass/data/tables/text-patches";
import { hasOriginalFiles, skyDisk } from "./helpers";

/** Lignes décodées par section française (comptes de `formats.md` § 5, vérifiés). */
const FRENCH_LINE_COUNTS = [567, 485, 1304, 923, 1141, 532, 121, 121];

describe("tables générées", () => {
  it("ont les tailles de la source de ScummVM", () => {
    expect(HUFFMAN_372.length % 3).toBe(0);
    expect(HUFFMAN_372.length / 3).toBeGreaterThan(200);
    expect(SPEECH_CONVERT).toEqual([0, 600, 1100, 2430, 3380, 4530, 5080, 5230]);
    expect(MCODE_NAMES).toHaveLength(115);
    expect(MCODE_NAMES[0]).toBe("fnCacheChip");
    expect(MCODE_NAMES.at(-1)).toBe("fnPrintf");
    expect(SCRIPT_VAR_NAMES).toHaveLength(837);
    expect(SCRIPT_VAR_NAMES.slice(0, 2)).toEqual(["result", "screen"]);
    expect(MUSIC_LIST).toHaveLength(139);
    expect(MUSIC_LIST.every((i) => i < SFX_DEFS.length)).toBe(true);
    // fx_null : son 0, pièce 200 (jamais atteinte), puis « toutes les pièces » à volume nul.
    expect(SFX_DEFS.some((d) => d[0] === 0 && d[1] === 0 && d[2] === 200)).toBe(true);
    expect(PATCHED_MESSAGES).toHaveLength(8);
    expect(PATCHED_MESSAGES[Language.french]).toEqual([[28686, "Volume de musique"]]);
  });

  it("applique les rustines de texte par langue", () => {
    expect(patchedMessage(Language.french, 28686)).toBe("Volume de musique");
    expect(patchedMessage(Language.english, 28686)).toBeUndefined();
    expect(patchedMessage(Language.italian, 28724)).toBe("Testo e Parlato");
  });
});

describe("numéros de texte", () => {
  it("séparent la section et le rang", () => {
    expect(textSection(0x7000 | 5)).toBe(7);
    expect(textIndex(0x7000 | 5)).toBe(5);
    expect(textSection(300)).toBe(0);
  });
});

describe.skipIf(!hasOriginalFiles)("textes français sur les vrais fichiers", () => {
  const texts = new SkyTexts(skyDisk(), Language.french);

  it("décode toutes les lignes des 8 sections", () => {
    for (let section = 0; section < 8; section++) {
      expect(texts.lineCount(section), `section ${section}`).toBe(FRENCH_LINE_COUNTS[section]);
      for (let rank = 0; rank < texts.lineCount(section); rank++) {
        const line = texts.getText((section << 12) | rank);
        expect(line.includes("\0")).toBe(false);
      }
    }
  });

  it("décode des chaînes connues", () => {
    expect(texts.getText(0x2005)).toBe("Vous permettez que je jette un coup d'oeil?");
    const english = new SkyTexts(skyDisk(), Language.english);
    expect(english.getText(0x2005)).toBe("Mind if I look around?");
  });

  it("donne le texte 28686 français (rustine identique à l'original)", () => {
    expect(texts.getText(28686)).toBe("Volume de musique");
    // En français la rustine est identique au texte d'origine (aucun effet visible) ; en anglais le texte 28686 est « Music Volume ».
    expect(decodeSectionLine(texts.section(7), 28686 & 0xfff)).toBe("Volume de musique");
  });

  it("refuse une ligne hors de la section", () => {
    expect(() => texts.getText(FRENCH_LINE_COUNTS[0]!)).toThrow(RangeError);
    expect(() => texts.section(8)).toThrow(RangeError);
    expect(sectionLineCount(skyDisk().load(textFile(Language.french, 6)))).toBe(121);
  });
});
