import { describe, expect, it } from "vitest";
import { NUM_FONT_CHARS, fontCharacterEntry, readFont } from "../../../src/games/voyageurs/data/font";
import { MSG_E_CIRCUMFLEX_BYTE, decodeMessageText, readMsg } from "../../../src/games/voyageurs/data/msg";
import { BUNDLE_NAMES, bundle, extensionOf, hasOriginalFiles, readOriginal } from "./helpers";

const be16 = (...values: number[]): number[] => values.flatMap((v) => [v >> 8, v & 0xff]);

describe("MSG (synthétiques)", () => {
  it("découpe aux octets nuls, garde les octets d'origine et passe 0x97 en ê", () => {
    const data = Uint8Array.of(...be16(3, 3, 4, 2), 0x4f, 0x75, 0, 0x97, 0x6d, 0x65, 0, 0x41, 0);
    const messages = readMsg(data);
    expect(messages.map((m) => m.text)).toEqual(["Ou", "ême", "A"]);
    expect([...messages[1]!.raw]).toEqual([0x97, 0x6d, 0x65]);
  });

  it("rend une chaîne vide pour un message hors du fichier, et décode CP437 (é à ç è)", () => {
    const messages = readMsg(Uint8Array.of(...be16(2, 3, 3), 0x82, 0x85, 0));
    expect(messages[0]!.text).toBe("éà");
    expect(messages[1]!.text).toBe("");
    expect(decodeMessageText(Uint8Array.of(0x87, 0x8a, MSG_E_CIRCUMFLEX_BYTE, 0x7c))).toBe("çèê|");
    expect(() => readMsg(Uint8Array.of(...be16(3, 1)))).toThrow(RangeError);
  });
});

describe("table de largeurs de la police", () => {
  it("donne glyphe et largeur par code, comme fontParamTable_standard", () => {
    expect(NUM_FONT_CHARS).toBe(256);
    expect(fontCharacterEntry(0x41)).toEqual({ glyph: 0, width: 6 }); // A
    expect(fontCharacterEntry(0x5a)).toEqual({ glyph: 25, width: 6 }); // Z
    expect(fontCharacterEntry(0x61)).toEqual({ glyph: 26, width: 6 }); // a
    expect(fontCharacterEntry(0x69)).toEqual({ glyph: 34, width: 4 }); // i
    expect(fontCharacterEntry(0x30)).toEqual({ glyph: 52, width: 6 }); // 0
    expect(fontCharacterEntry(0x21)).toEqual({ glyph: 63, width: 1 }); // !
    expect(fontCharacterEntry(0x3f)).toEqual({ glyph: 75, width: 6 }); // ?
    expect(fontCharacterEntry(0x82)).toEqual({ glyph: 70, width: 6 }); // é
    expect(fontCharacterEntry(0x85)).toEqual({ glyph: 72, width: 6 }); // à
    expect(fontCharacterEntry(0x87)).toEqual({ glyph: 73, width: 5 }); // ç
    expect(fontCharacterEntry(0x88)).toEqual({ glyph: 77, width: 6 }); // ê
    expect(fontCharacterEntry(0x8a)).toEqual({ glyph: 71, width: 6 }); // è
    expect(fontCharacterEntry(0x97)).toEqual({ glyph: 77, width: 6 }); // ê (patch français)
    expect(fontCharacterEntry(0x20)).toEqual({ glyph: 0, width: 0 });
    expect(fontCharacterEntry(0x100)).toEqual({ glyph: 0, width: 0 });
  });

  it("refuse un fichier de police de mauvaise taille", () => {
    expect(() => readFont(Uint8Array.of(...be16(8, 16), 0))).toThrow(RangeError);
    expect(() => readFont(Uint8Array.of(...be16(0, 0)))).toThrow(RangeError);
  });
});

describe.skipIf(!hasOriginalFiles)("textes et police (fichiers d'origine)", () => {
  it("lit TEXTE.DAT : 78 glyphes de 16 x 8, dont des pixels allumés pour chaque glyphe de lettre", () => {
    const font = readFont(readOriginal("TEXTE.DAT"));
    expect(font.glyphs).toHaveLength(78);
    for (const glyph of font.glyphs) {
      expect(glyph.pixels).toHaveLength(16 * 8);
      expect(glyph.mask).toHaveLength(16 * 8);
    }
    for (let glyph = 0; glyph < 52; glyph++) expect(font.glyphs[glyph]!.mask.some((m) => m === 0), `glyphe ${glyph}`).toBe(true);
    // la largeur utile ne dépasse jamais les 16 colonnes du glyphe, et le glyphe y est dessiné
    for (let code = 0; code < NUM_FONT_CHARS; code++) {
      const { glyph, width } = fontCharacterEntry(code);
      expect(glyph).toBeLessThan(78);
      expect(width).toBeLessThanOrEqual(16);
    }
  });

  it("lit les 7 MSG : 1029 messages, 640 non vides", () => {
    const counts: Record<string, number> = {};
    let total = 0;
    let nonEmpty = 0;
    for (const name of BUNDLE_NAMES) {
      const b = bundle(name);
      for (const [index, entry] of b.entries.entries()) {
        if (extensionOf(entry.name) !== "MSG") continue;
        const messages = readMsg(b.read(index));
        counts[entry.name] = messages.length;
        total += messages.length;
        nonEmpty += messages.filter((m) => m.raw.length > 0 && m.text.trim() !== "").length;
      }
    }
    expect(counts).toEqual({ "PART01A.MSG": 255, "TOTO.MSG": 255, "PART02A.MSG": 174, "PART02B.MSG": 49, "PART03.MSG": 183, "PART04.MSG": 71, "PART04B.MSG": 42 });
    expect(total).toBe(1029);
    expect(nonEmpty).toBe(640);
  });

  it("restitue des lignes françaises accentuées", () => {
    const part01 = readMsg(bundle("PART01").read("PART01A.MSG"));
    expect(part01[3]!.text.trimEnd()).toBe("La liste des invectives dont Ed vous abreuve serait trop longue à citer ici.");
    expect(part01[35]!.text.trimEnd()).toBe("Vous la ramassez.");
    expect(part01[99]!.text).toContain("Vous êtes dans le passage secret , fébrile de curiosité .");
    const part02 = readMsg(bundle("PART02").read("PART02A.MSG"));
    expect(part02[138]!.text.trimEnd()).toBe("Vous pénétrez dans le passage secrêt ...");
    expect(part02[138]!.raw).toContain(MSG_E_CIRCUMFLEX_BYTE);
    expect(part02[42]!.text.trimEnd()).toBe("Au pied de l'arbre , vous trouvez une PIECE en argent !");
    const part02b = readMsg(bundle("PART02").read("PART02B.MSG"));
    expect(part02b[28]!.text).toContain("Hélas les Crughons aussi se sont emparés de cette invention");
    const part03 = readMsg(bundle("PART03").read("PART03.MSG"));
    expect(part03[171]!.text.trimEnd()).toBe('Vous l\'interrompez :|" JE VAIS AVEC ELLE ! "');
    expect(part03[75]!.text).toContain("245 écus");
    const part04 = readMsg(bundle("PART04").read("PART04.MSG"));
    expect(part04[52]!.text.trimEnd()).toBe("UN ESPION ! HALTE ! PLUS UN GESTE OU TU ES MORT , TERRIEN !");
  });

  it("n'emploie, hors ASCII, que les octets 0x82, 0x85, 0x87, 0x8a et 0x97", () => {
    const high = new Set<number>();
    for (const name of BUNDLE_NAMES) {
      const b = bundle(name);
      for (const [index, entry] of b.entries.entries()) {
        if (extensionOf(entry.name) !== "MSG") continue;
        for (const message of readMsg(b.read(index))) for (const byte of message.raw) if (byte >= 0x80) high.add(byte);
      }
    }
    expect([...high].sort((a, b) => a - b)).toEqual([0x82, 0x85, 0x87, 0x8a, 0x97]);
  });
});
