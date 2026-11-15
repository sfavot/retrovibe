import { describe, expect, it } from "vitest";
import { parseFont } from "../../../src/engine/coktel/data/font";
import { createSurface } from "../../../src/engine/coktel/data/surface";
import {
  entriesWithExt,
  entry,
  hasOriginalFiles,
  loadIntro,
  sha1,
} from "../helpers";

/** `Font::Font` et `Font::drawLetterRaw` (`video.cpp:45-150`), réécrits sans passer par `font.ts`. */
function referenceGlyph(data: Uint8Array, c: number): number[][] {
  const width = data[0] & 0x7f;
  const height = data[1];
  const start = data[2];
  const rowBytes = Math.floor((width - 1) / 8) + 1;
  const rows: number[][] = [];
  let src = 4 + (c - start) * rowBytes * height;
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    let left = width;
    for (let k = 0; k < rowBytes; k++) {
      let bits = data[src++];
      for (let j = 0; j < Math.min(8, left); j++) {
        row.push(bits & 0x80 ? 1 : 0);
        bits = (bits << 1) & 0xff;
      }
      left -= 8;
    }
    rows.push(row);
  }
  return rows;
}

describe.skipIf(!hasOriginalFiles)("polices .LET de Ween", () => {
  const names = () => entriesWithExt(".LET");

  it("sont sept polices à chasse fixe, 0x20-0xE1 : EMA1-6 en 8x8, PROFECY en 12x14", () => {
    expect(names()).toEqual([
      "EMA1.LET",
      "EMA2.LET",
      "EMA3.LET",
      "EMA4.LET",
      "EMA5.LET",
      "EMA6.LET",
      "PROFECY.LET",
    ]);
    for (const name of names()) {
      const data = entry(name);
      const font = parseFont(data);
      const [width, height] = name === "PROFECY.LET" ? [12, 14] : [8, 8];
      expect(
        [font.charWidthDefault, font.charHeight, font.startChar, font.endChar],
        name,
      ).toEqual([width, height, 0x20, 0xe1]);
      expect(font.monospaced, name).toBe(true);
      // Pas de table de largeurs : le fichier est exactement l'en-tête et les glyphes.
      expect(data.length, name).toBe(
        4 + font.charCount * (Math.floor((width - 1) / 8) + 1) * height,
      );
    }
  });

  it("restituent chaque glyphe comme Font::drawLetterRaw de ScummVM", () => {
    for (const name of names()) {
      const data = entry(name);
      const font = parseFont(data);
      let nonBlank = 0;
      for (let c = font.startChar; c <= font.endChar; c++) {
        const surface = createSurface(font.charWidthDefault, font.charHeight);
        font.drawChar(surface, c, 0, 0, 1, 0);
        const expected = referenceGlyph(data, c);
        const actual = Array.from({ length: font.charHeight }, (_, y) =>
          Array.from(
            surface.pixels.subarray(
              y * font.charWidthDefault,
              (y + 1) * font.charWidthDefault,
            ),
          ),
        );
        expect(actual, `${name} 0x${c.toString(16)}`).toEqual(expected);
        if (expected.some((row) => row.includes(1))) nonBlank++;
      }
      expect(nonBlank, name).toBeGreaterThan(100);
      expect(font.charWidth(0x41), name).toBe(font.charWidthDefault);
    }
  });

  it("couvrent les caractères accentués du texte français", () => {
    for (const name of names())
      expect(parseFont(entry(name)).hasChar(0x82), name).toBe(true);
  });

  it("restent identiques d'une exécution à l'autre (empreintes)", () => {
    const hashes = Object.fromEntries(names().map((n) => [n, sha1(entry(n))]));
    expect(Object.keys(hashes)).toHaveLength(7);
    expect(sha1(...names().map(entry))).toBe(
      "48e5d271df21437c6d99c803f4c7742fa4b5d254",
    );
    expect(loadIntro().get("INTRO.INF")).toBeDefined();
  });
});
