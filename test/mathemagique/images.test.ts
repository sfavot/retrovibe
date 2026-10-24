import { describe, expect, it } from "vitest";
import { MohawkArchive, TAG_SHAP, TAG_SHPL } from "../../src/games/mathemagique/data/mohawk";
import { applyShpl, brighten, createPalette, PALETTE_SIZE } from "../../src/games/mathemagique/data/palette";
import { decodeShap, unpackLz } from "../../src/games/mathemagique/data/shap";
import { parseShpl } from "../../src/games/mathemagique/data/shpl";
import { decodeTbmp } from "../../src/games/mathemagique/data/tbmp";
import { parseTpal } from "../../src/games/mathemagique/data/tpal";
import { archivePaths, hasOriginalFiles, readOriginal } from "./helpers";

describe("SHAP (données synthétiques)", () => {
  it("décode un bitmap brut en retirant le bourrage de ligne", () => {
    // 3x2, 8 bits, pas 4, brut.
    const bytes = new Uint8Array([0, 3, 0, 2, 0, 4, 0, 2, 1, 2, 3, 0, 4, 5, 6, 0]);
    const shape = decodeShap(bytes);
    expect([shape.width, shape.height, shape.bitsPerPixel]).toEqual([3, 2, 8]);
    expect([...shape.pixels]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(shape.consumed).toBe(16);
  });

  it("décode le RLE par ligne (répétition bit 7, copie sinon)", () => {
    // 5x2, RLE : ligne 1 = répétition de 5 x 9 ; ligne 2 = copie de 2 puis répétition de 3.
    const bytes = new Uint8Array([0, 5, 0, 2, 0, 5, 0, 0x12, 0, 2, 0x84, 9, 0, 5, 0x01, 7, 8, 0x82, 6]);
    const shape = decodeShap(bytes);
    expect([...shape.pixels]).toEqual([9, 9, 9, 9, 9, 7, 8, 6, 6, 6]);
    expect(shape.consumed).toBe(bytes.length);
  });

  it("décode un masque 1 bit (bit de poids fort à gauche)", () => {
    const bytes = new Uint8Array([0, 4, 0, 2, 0, 4, 0, 0, 0xa0, 0, 0, 0, 0x50, 0, 0, 0]);
    const shape = decodeShap(bytes);
    expect(shape.bitsPerPixel).toBe(1);
    expect([...shape.pixels]).toEqual([1, 0, 1, 0, 0, 1, 0, 1]);
  });

  it("décompresse le LZ (anneau de 1024 octets, écriture initiale en 0x3be)", () => {
    // Trois littéraux A B C, puis une copie de 3 octets depuis la position 0x3be (début de l'écriture).
    // Copie : offset 0x3be (10 bits) + longueur 3 -> (3 - 3) << 10 : 0x03be.
    const src = new Uint8Array([0b00000111, 0x41, 0x42, 0x43, 0x03, 0xbe]);
    expect(Array.from(unpackLz(src, 0, src.length, 6).data)).toEqual([0x41, 0x42, 0x43, 0x41, 0x42, 0x43]);
  });

  it("refuse une profondeur inconnue", () => {
    expect(() => decodeShap(new Uint8Array([0, 1, 0, 1, 0, 4, 0, 5, 0, 0, 0, 0]))).toThrow(/profondeur/);
  });
});

describe("SHPL / palette (données synthétiques)", () => {
  it("lit les en-têtes et les entrées RGB d'un SHPL", () => {
    const shpl = parseShpl(new Uint8Array([0, 100, 0, 5, 0, 10, 0, 2, 1, 2, 3, 0, 8, 16, 255, 0]));
    expect(shpl).toMatchObject({ firstShapeId: 100, shapeCount: 5, paletteFirst: 10 });
    expect([...shpl.rgb]).toEqual([1, 2, 3, 8, 16, 255]);
  });

  it("éclaircit les composantes non nulles comme 1098:0857", () => {
    expect([0, 1, 8, 255].map(brighten)).toEqual([0, 32, 38, 255]);
    const palette = createPalette();
    applyShpl(palette, parseShpl(new Uint8Array([0, 1, 0, 1, 0, 10, 0, 1, 0, 8, 255, 0])));
    expect([...palette.subarray(30, 33)]).toEqual([0, 38, 255]);
    expect([...palette.subarray(255 * 3)]).toEqual([255, 255, 255]);
  });
});

describe.skipIf(!hasOriginalFiles)("SHAP, SHPL, tBMP, tPAL (fichiers du jeu)", () => {
  const archives = archivePaths()
    .filter((path) => /\.DAT$/i.test(path))
    .map((path) => ({ path, archive: MohawkArchive.parse(readOriginal(path)) }));

  it("décode tous les SHAP : taille lue cohérente avec la taille déclarée", () => {
    let count = 0;
    for (const { path, archive } of archives) {
      for (const id of archive.ids(TAG_SHAP)) {
        const bytes = archive.get(TAG_SHAP, id);
        const shape = decodeShap(bytes);
        const label = `${path} ${id}`;
        expect(shape.pixels.length, label).toBe(shape.width * shape.height);
        expect(shape.consumed, label).toBeLessThanOrEqual(shape.declaredEnd);
        // Le LZ déclare quelques octets de plus que nécessaire (fin de groupe de drapeaux : au plus 8 éléments de 2 octets).
        expect(shape.declaredEnd - shape.consumed, label).toBeLessThanOrEqual(17);
        if (shape.declaredEnd <= bytes.length) {
          // sinon la ressource est tronquée par la taille déclarée dans l'archive (42 cas), sans perte de pixels
          expect(shape.consumed, label).toBeLessThanOrEqual(bytes.length);
        }
        count++;
      }
    }
    expect(count).toBe(16258);
  });

  it("retrouve les dimensions connues (écran titre, fond du hall, logo)", () => {
    const title = MohawkArchive.parse(readOriginal("TITLE.DAT"));
    expect(decodeShap(title.get(TAG_SHAP, 105))).toMatchObject({ width: 576, height: 432, bitsPerPixel: 8 });
    expect(decodeShap(title.get(TAG_SHAP, 200))).toMatchObject({ width: 265, height: 119 });
    const main = MohawkArchive.parse(readOriginal("MAINSCRN.DAT"));
    expect(decodeShap(main.get(TAG_SHAP, 100))).toMatchObject({ width: 576, height: 432 });
    expect(decodeShap(main.get(TAG_SHAP, 301))).toMatchObject({ width: 187, height: 117 });
  });

  it("n'utilise l'index 0 que dans les sprites : les fonds d'écran sont opaques", () => {
    const main = MohawkArchive.parse(readOriginal("MAINSCRN.DAT"));
    expect(decodeShap(main.get(TAG_SHAP, 100)).pixels).not.toContain(0);
    const sprite = decodeShap(main.get(TAG_SHAP, 301));
    expect(sprite.pixels[0]).toBe(0);
    expect(sprite.pixels[sprite.width * sprite.height - 1]).toBe(0);
  });

  it("lit tous les SHPL : les formes décrites existent dans l'archive, la palette tient dans 256 entrées", () => {
    let orphans = 0;
    for (const { archive } of archives) {
      for (const id of archive.ids(TAG_SHPL)) {
        const shpl = parseShpl(archive.get(TAG_SHPL, id));
        expect(shpl.firstShapeId).toBe(id);
        expect(shpl.paletteFirst + shpl.rgb.length / 3).toBeLessThanOrEqual(PALETTE_SIZE);
        if (!archive.has(TAG_SHAP, id)) orphans++;
      }
    }
    expect(orphans).toBe(3);
  });

  it("construit une palette de 256 entrées pour l'écran titre", () => {
    const title = MohawkArchive.parse(readOriginal("TITLE.DAT"));
    const palette = createPalette();
    applyShpl(palette, parseShpl(title.get(TAG_SHPL, 105)));
    expect(palette.length).toBe(PALETTE_SIZE * 3);
    const shape = decodeShap(title.get(TAG_SHAP, 105));
    // Les index de l'écran titre sont tous dans la plage définie par le SHPL (10 + 236 entrées).
    const used = new Set(shape.pixels);
    expect([...used].every((index) => index >= 10 && index < 10 + 236)).toBe(true);
    expect(parseShpl(title.get(TAG_SHPL, 105))).toMatchObject({ shapeCount: 1, paletteFirst: 10 });
  });

  it("décode les 128 tBMP et les 8 tPAL de PVG.MHK", () => {
    const pvg = MohawkArchive.parse(readOriginal("MPC/PVG.MHK"));
    for (const id of pvg.ids("tBMP")) {
      const shape = decodeTbmp(pvg.get("tBMP", id));
      expect(shape.pixels.length).toBe(shape.width * shape.height);
    }
    expect(pvg.count("tBMP")).toBe(128);
    expect(decodeTbmp(pvg.get("tBMP", 0))).toMatchObject({ width: 512, height: 384 });
    for (const id of pvg.ids("tPAL")) {
      const pal = parseTpal(pvg.get("tPAL", id));
      expect(pal.paletteFirst + pal.rgb.length / 3).toBeLessThanOrEqual(PALETTE_SIZE);
    }
    expect(pvg.count("tPAL")).toBe(8);
  });
});
