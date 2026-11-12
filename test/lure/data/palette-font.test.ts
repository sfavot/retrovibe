import { describe, expect, it } from "vitest";
import { catalogOf, lureData } from "./catalog-helper";
import { EXTENDED_CODES, gameCharToUnicode, gameTextToUnicode } from "../../../src/games/lure/data/charset";
import { Coverage } from "../../../src/games/lure/data/cursor";
import { DIALOG_FRAME_SIZE, DIALOG_FRAME_USED, TALK_DIALOG_FRAME_SIZE, TALK_DIALOG_FRAME_USED, TALK_DIALOG_WIDTH, expandDialogFrame, expandTalkDialogFrame } from "../../../src/games/lure/data/dialog-frame";
import { FONT_HEIGHT, LureFont } from "../../../src/games/lure/data/font";
import { composeRoomPalette, parsePalette, parsePaletteCollection } from "../../../src/games/lure/data/palette";
import { hasOriginalFiles } from "./helpers";

describe("palettes (données synthétiques)", () => {
  it("passe les composantes de 6 à 8 bits par (v << 2) + (v >> 4)", () => {
    const palette = parsePalette(Uint8Array.from([0, 63, 32, 1, 16, 48]));
    expect(palette.numEntries).toBe(2);
    expect([...palette.rgb]).toEqual([0, 255, 130, 4, 65, 195]);
  });

  it("refuse une taille qui n'est pas un multiple de 3 ou plus de 256 couleurs", () => {
    expect(() => parsePalette(new Uint8Array(10))).toThrow(/invalide/);
    expect(() => parsePalette(new Uint8Array(771))).toThrow(/invalide/);
  });

  it("compose la palette d'une pièce : jeu, puis calque de fond, puis sous-palette en 129 (60 couleurs) et en 220 (8 couleurs)", () => {
    const game = { numEntries: 256, rgb: new Uint8Array(768).fill(1) };
    const room = { numEntries: 220, rgb: new Uint8Array(660).fill(2) };
    const subset = { numEntries: 68, rgb: Uint8Array.from({ length: 204 }, (_, i) => 10 + Math.floor(i / 3)) };
    const out = composeRoomPalette(game, room, subset);
    expect(out.rgb[0]).toBe(2);
    expect(out.rgb[219 * 3]).toBe(2);
    expect(out.rgb[129 * 3]).toBe(10);
    expect(out.rgb[188 * 3]).toBe(10 + 59);
    expect(out.rgb[189 * 3]).toBe(2);
    expect(out.rgb[220 * 3]).toBe(10 + 60);
    expect(out.rgb[227 * 3]).toBe(10 + 67);
    expect(out.rgb[228 * 3]).toBe(1);
    expect(game.rgb[0]).toBe(1);
  });
});

describe("LureFont (données synthétiques)", () => {
  const glyphs = new Uint8Array(3 * FONT_HEIGHT);
  glyphs.set([0x80, 0x80, 0x80, 0x80, 0, 0x80, 0, 0], 8);
  glyphs.set([0xf0, 0, 0, 0, 0, 0, 0, 0x0f], 16);
  const font = new LureFont(glyphs);

  it("indexe les glyphes à partir du code 32 et mesure leur largeur", () => {
    expect(font.numGlyphs).toBe(3);
    expect(font.lastChar).toBe(34);
    expect(font.has(31)).toBe(false);
    expect(font.has(35)).toBe(false);
    expect([...font.glyph(33)!]).toEqual([0x80, 0x80, 0x80, 0x80, 0, 0x80, 0, 0]);
    expect(font.glyph(35)).toBeUndefined();
    expect(font.advance(32, true)).toBe(4); // glyphe vide : 2 + 2
    expect(font.advance(33, true)).toBe(4); // colonne 0 seulement : 2 + 2
    expect(font.advance(34, true)).toBe(9); // colonne 7 : 7 + 2
    expect(font.advance(34, false)).toBe(8);
    expect(() => font.advance(40, true)).toThrow(RangeError);
  });
});

describe("charset", () => {
  it("laisse l'ASCII et traduit les lettres accentuées du jeu", () => {
    expect(gameCharToUnicode(0x41)).toBe("A");
    expect(gameTextToUnicode("Ch\x80teau, Ext\x7frieure, Salle \x81 manger, Ce\x82ant, Vous \x83tes s\x89r (o/n)?")).toBe("Château, Extérieure, Salle à manger, Ceçant, Vous êtes sûr (o/n)?");
    expect(gameTextToUnicode("\x7ea t'apprendra")).toBe("Ça t'apprendra");
    expect(EXTENDED_CODES).toHaveLength(21);
  });
});

describe.skipIf(!hasOriginalFiles)("palettes, police et cadres du jeu", () => {
  it("la palette du jeu a 256 couleurs de 6 bits, la sous-palette 68, les palettes de pièce 220 (128 pour 0x9BFF)", () => {
    const d = lureData();
    expect(d.gamePalette.numEntries).toBe(256);
    expect(d.altPalette.numEntries).toBe(68);
    expect(Math.max(...d.resources.get(0x3f01))).toBeLessThanOrEqual(63);
    const palettes = catalogOf().filter((entry) => entry.kind === "palette");
    expect(palettes).toHaveLength(49);
    for (const entry of palettes) {
      const bytes = d.resources.get(entry.id);
      expect(Math.max(...bytes), `palette 0x${entry.id.toString(16)}`).toBeLessThanOrEqual(63);
      expect(parsePalette(bytes).numEntries).toBe(entry.id === 0x9bff ? 128 : 220);
    }
  });

  it("chaque écran de pièce a la palette (id & 0xFFE0) - 1 sur son disque", () => {
    const d = lureData();
    for (const room of d.rooms) {
      for (let i = 0; i < room.numLayers; i++) expect(d.resources.has((room.layers[i]! & 0xffe0) - 1), `pièce ${room.roomNumber} calque ${i}`).toBe(true);
    }
  });

  it("la collection de l'introduction (0x32) a 5 sous-palettes ; la palette française a déjà les gris que la correction de ScummVM impose", () => {
    const raw = lureData().resources.get(0x32);
    const fixed = parsePaletteCollection(raw, 0x32);
    expect(fixed).toHaveLength(5);
    expect(parsePaletteCollection(raw)).toEqual(fixed);
    expect([...fixed[0]!.rgb.subarray(0x22 * 3, 0x22 * 3 + 3)]).toEqual([0xe3, 0xe3, 0xe3]);
    expect([...fixed[0]!.rgb.subarray(0x28 * 3, 0x28 * 3 + 3)]).toEqual([0, 0, 0]);
    expect(() => parsePaletteCollection(new Uint8Array(100))).toThrow(/invalide/);
  });

  it("applique la correction de ScummVM à une collection dont la couleur 0x22 est blanche (autres langues)", () => {
    const white = new Uint8Array(192).fill(0);
    white.fill(63, 0x22 * 3, 0x22 * 3 + 3);
    expect([...parsePaletteCollection(white, 0x32)[0]!.rgb.subarray(0x22 * 3, 0x22 * 3 + 3)]).toEqual([0xe3, 0xe3, 0xe3]);
    expect([...parsePaletteCollection(white)[0]!.rgb.subarray(0x22 * 3, 0x22 * 3 + 3)]).toEqual([255, 255, 255]);
    expect([...parsePaletteCollection(white, 0x32)[0]!.rgb.subarray(0x24 * 3, 0x24 * 3 + 3)]).toEqual([0xc3, 0xc3, 0xc3]);
  });

  it("la police a 115 glyphes (codes 32 à 146) et le point d'exclamation attendu", () => {
    const { font } = lureData();
    expect(font.numGlyphs).toBe(115);
    expect(font.lastChar).toBe(0x92);
    expect([...font.glyph(0x21)!]).toEqual([0, 0x80, 0x80, 0x80, 0x80, 0, 0x80, 0]);
    expect(font.advance(0x20, true)).toBe(4);
  });

  it("la police a un glyphe pour chaque caractère de chaque texte (voir strings.test.ts) et les 21 lettres accentuées sont non vides", () => {
    const { font } = lureData();
    for (const code of EXTENDED_CODES) expect(font.glyph(code)!.some((row) => row !== 0), `code 0x${code.toString(16)}`).toBe(true);
  });

  it("lit les cadres de dialogue : 334 octets sur 336 et 43 sur 48, le reste étant du remplissage à zéro", () => {
    const d = lureData();
    expect(d.dialogFrame).toHaveLength(DIALOG_FRAME_SIZE);
    expect(d.talkDialogFrame).toHaveLength(TALK_DIALOG_FRAME_SIZE);
    const dialogCoverage = new Coverage(DIALOG_FRAME_SIZE);
    const dialog = expandDialogFrame(d.dialogFrame, 191, 60, dialogCoverage);
    expect(dialog).toHaveLength(191 * 60);
    expect(dialogCoverage.unread()).toEqual([[DIALOG_FRAME_USED, DIALOG_FRAME_SIZE]]);
    expect([...d.dialogFrame.subarray(DIALOG_FRAME_USED)]).toEqual([0, 0]);

    const talkCoverage = new Coverage(TALK_DIALOG_FRAME_SIZE);
    const talk = expandTalkDialogFrame(d.talkDialogFrame, 40, talkCoverage);
    expect(talk).toHaveLength(TALK_DIALOG_WIDTH * 40);
    expect(talkCoverage.unread()).toEqual([[TALK_DIALOG_FRAME_USED, TALK_DIALOG_FRAME_SIZE]]);
    expect([...d.talkDialogFrame.subarray(TALK_DIALOG_FRAME_USED)]).toEqual([0, 0, 0, 0, 0]);
  });

  it("la boîte de dialogue étend le coin gauche, une colonne centrale et le coin droit sur chaque ligne", () => {
    const d = lureData();
    const out = expandDialogFrame(d.dialogFrame, 40, 30);
    // première ligne : 7 octets du coin, 1 octet répété 24 fois (40 - 18 + 2), 9 octets du coin
    expect([...out.subarray(0, 7)]).toEqual([...d.dialogFrame.subarray(0, 7)]);
    expect(new Set(out.subarray(7, 7 + 24)).size).toBe(1);
    expect([...out.subarray(31, 40)]).toEqual([...d.dialogFrame.subarray(8, 17)]);
  });
});
