import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MohawkArchive, TAG_SHAP, TAG_SHPL } from "../../src/data/mohawk/mohawk";
import { applyShpl, brighten, createPalette } from "../../src/games/mathemagique/data/palette";
import { decodeShap, type Shape } from "../../src/data/mohawk/shap";
import { parseShpl, type ShapeList } from "../../src/data/mohawk/shpl";
import { drawMask, drawShape, hitTestShape } from "../../src/games/mathemagique/engine/graphics/blit";
import { parseFon } from "../../src/games/mathemagique/engine/graphics/fon";
import { Palette } from "../../src/games/mathemagique/engine/graphics/palette";
import { ClipMask, Surface } from "../../src/games/mathemagique/engine/graphics/surface";
import { drawText, encodeText, measureText } from "../../src/games/mathemagique/engine/graphics/text";
import { Blinds, revealRects, transitionFrames, Wipe, type WipeDirection } from "../../src/games/mathemagique/engine/graphics/transitions";
import { hasOriginalFiles, readOriginal } from "./helpers";

function shape(width: number, height: number, pixels: number[], bitsPerPixel: 1 | 8 = 8): Shape {
  return { width, height, pitch: width, flags: 0, bitsPerPixel, pixels: Uint8Array.from(pixels), consumed: 0, declaredEnd: 0 };
}

function rows(surface: Surface, x: number, y: number, w: number, h: number): number[][] {
  return Array.from({ length: h }, (_, r) => Array.from(surface.pixels.subarray((y + r) * surface.width + x, (y + r) * surface.width + x + w)));
}

describe("surface", () => {
  it("remplit, copie et restaure un rectangle", () => {
    const s = new Surface(8, 6);
    s.fill(3, { x: 1, y: 1, w: 3, h: 2 });
    const saved = s.saveRect({ x: 0, y: 0, w: 5, h: 4 });
    s.fill(9);
    expect(s.get(0, 0)).toBe(9);
    s.restoreRect(saved);
    expect(rows(s, 0, 0, 5, 4)).toEqual([
      [0, 0, 0, 0, 0],
      [0, 3, 3, 3, 0],
      [0, 3, 3, 3, 0],
      [0, 0, 0, 0, 0],
    ]);
    expect(s.get(6, 5)).toBe(9);
    const other = new Surface(8, 6);
    other.copyFrom(s, { x: 1, y: 1, w: 3, h: 2 }, 4, 3);
    expect(rows(other, 3, 2, 5, 4)).toEqual([
      [0, 0, 0, 0, 0],
      [0, 3, 3, 3, 0],
      [0, 3, 3, 3, 0],
      [0, 0, 0, 0, 0],
    ]);
  });

  it("empile les rectangles de découpe", () => {
    const s = new Surface(10, 10);
    s.pushClip({ x: 2, y: 2, w: 6, h: 6 });
    s.pushClip({ x: 0, y: 0, w: 4, h: 4 });
    expect(s.clip).toEqual({ x: 2, y: 2, w: 2, h: 2 });
    s.fill(1);
    s.popClip();
    s.popClip();
    expect(s.pixels.reduce((a, b) => a + b, 0)).toBe(4);
    expect(() => s.popClip()).toThrow();
  });
});

describe("blit", () => {
  const sprite = shape(3, 2, [1, 0, 2, 0, 3, 0]);

  it("mode 0 copie tout, mode 8 saute l'index 0", () => {
    const s = new Surface(6, 4);
    s.fill(7);
    drawShape(s, sprite, 1, 1, 0);
    expect(rows(s, 1, 1, 3, 2)).toEqual([
      [1, 0, 2],
      [0, 3, 0],
    ]);
    s.fill(7);
    drawShape(s, sprite, 1, 1, 8);
    expect(rows(s, 1, 1, 3, 2)).toEqual([
      [1, 7, 2],
      [7, 3, 7],
    ]);
  });

  it("découpe par le bord de la surface et par la découpe", () => {
    const s = new Surface(4, 3);
    drawShape(s, sprite, -1, 2, 8);
    expect(rows(s, 0, 2, 4, 1)).toEqual([[0, 2, 0, 0]]);
    drawShape(s, sprite, 3, -1, 8); // seule la ligne 1 de la forme, colonne 0
    expect(s.get(3, 0)).toBe(0);
    s.fill(0);
    s.pushClip({ x: 1, y: 0, w: 1, h: 3 });
    drawShape(s, shape(4, 1, [5, 5, 5, 5]), 0, 1, 0);
    expect(rows(s, 0, 1, 4, 1)).toEqual([[0, 5, 0, 0]]);
    drawShape(s, sprite, 100, 100, 0);
    drawShape(s, sprite, -100, -100, 0);
  });

  it("dessine un masque 1 bit en couleur unie et sait le tester", () => {
    const mask = shape(3, 2, [1, 0, 1, 0, 1, 0], 1);
    const s = new Surface(5, 3);
    s.fill(2);
    drawMask(s, mask, 1, 0, 180);
    expect(rows(s, 0, 0, 5, 2)).toEqual([
      [2, 180, 2, 180, 2],
      [2, 2, 180, 2, 2],
    ]);
    expect(hitTestShape(mask, 0, 0)).toBe(true);
    expect(hitTestShape(mask, 1, 0)).toBe(false);
    expect(hitTestShape(mask, 3, 0)).toBe(false);
    expect(hitTestShape(mask, 0, -1)).toBe(false);
    expect(hitTestShape(sprite, 0, 0)).toBe(true);
    expect(hitTestShape(sprite, 1, 0)).toBe(false);
  });

  it("restreint le dessin à une union de rectangles (masque)", () => {
    const s = new Surface(6, 2);
    s.mask = new ClipMask(6, 2, [
      { x: 0, y: 0, w: 2, h: 1 },
      { x: 4, y: 0, w: 5, h: 2 },
    ]);
    drawShape(s, shape(6, 2, Array(12).fill(1)), 0, 0, 0);
    expect(rows(s, 0, 0, 6, 2)).toEqual([
      [1, 1, 0, 0, 1, 1],
      [0, 0, 0, 0, 1, 1],
    ]);
    s.fill(4);
    expect(s.get(2, 0)).toBe(0);
    expect(s.get(0, 0)).toBe(4);
  });
});

describe("palette", () => {
  const shpl = (first: number, rgb: number[]): ShapeList => ({ firstShapeId: 1, shapeCount: 1, paletteFirst: first, rgb: Uint8Array.from(rgb) });

  it("éclaircit les SHPL : v + 31 - v/8 pour v non nul", () => {
    expect([0, 1, 8, 100, 224, 255].map(brighten)).toEqual([0, 32, 38, 119, 227, 255]);
    const p = new Palette();
    p.loadShpl(shpl(10, [0, 8, 255, 100, 1, 224]));
    expect(Array.from(p.colors.subarray(30, 36))).toEqual([0, 38, 255, 119, 32, 227]);
    p.loadRaw(shpl(10, [0, 8, 255]));
    expect(Array.from(p.colors.subarray(30, 33))).toEqual([0, 8, 255]);
  });

  it("couleurs système : 0 noir, 255 blanc", () => {
    const p = new Palette();
    expect(Array.from(p.output().subarray(0, 3))).toEqual([0, 0, 0]);
    expect(Array.from(p.output().subarray(765, 768))).toEqual([255, 255, 255]);
  });

  it("fondu vers le noir puis depuis le noir : extrémités et durée", () => {
    const p = new Palette();
    p.loadRaw(shpl(10, [200, 100, 50, 40, 20, 10]));
    const fade = p.fadeToBlack(30);
    expect(Array.from(p.output().subarray(30, 33))).toEqual([200, 100, 50]);
    for (let i = 0; i < 15; i++) p.tick();
    expect(Array.from(p.output().subarray(30, 33))).toEqual([100, 50, 25]);
    for (let i = 0; i < 14; i++) p.tick();
    expect(fade.done).toBe(false);
    p.tick();
    expect(fade.done).toBe(true);
    expect(Array.from(p.output().subarray(30, 36))).toEqual([0, 0, 0, 0, 0, 0]);
    // La palette système (hors plage) n'est pas touchée, le noir est tenu.
    expect(Array.from(p.output().subarray(765, 768))).toEqual([255, 255, 255]);
    p.tick();
    expect(Array.from(p.output().subarray(30, 33))).toEqual([0, 0, 0]);

    const rise = p.fadeFromBlack(30);
    expect(Array.from(p.output().subarray(30, 33))).toEqual([0, 0, 0]);
    for (let i = 0; i < 30; i++) p.tick();
    expect(rise.done).toBe(true);
    expect(p.fade).toBeNull();
    expect(Array.from(p.output().subarray(30, 36))).toEqual([200, 100, 50, 40, 20, 10]);
  });

  it("fondu instantané (durée 0) et par paliers de 4", () => {
    const p = new Palette();
    p.loadRaw(shpl(10, [200, 100, 50]));
    p.fadeToBlack(0);
    expect(Array.from(p.output().subarray(30, 33))).toEqual([0, 0, 0]);
    p.clearFade();
    const fade = p.fadeToBlack(100, 10, 236, true);
    for (let i = 0; i < 7; i++) p.tick();
    expect(fade.level % 4).toBe(0);
  });

  it("cycle une plage d'un cran toutes les N ticks, plusieurs cycleurs à la fois, restauration", () => {
    const p = new Palette();
    p.loadRaw(shpl(20, [1, 1, 1, 2, 2, 2, 3, 3, 3]));
    p.loadRaw(shpl(40, [10, 10, 10, 20, 20, 20]));
    const a = p.startCycle({ first: 20, count: 3, period: 8, duration: 24, restore: true });
    p.startCycle({ first: 40, count: 2, period: 2, direction: -1 });
    const first = (i: number) => p.colors[i * 3]!;
    for (let i = 0; i < 7; i++) p.tick();
    expect([first(20), first(21), first(22), first(40)]).toEqual([1, 2, 3, 20]); // 3 rotations de la 2e plage = un cran
    p.tick();
    expect([first(20), first(21), first(22)]).toEqual([2, 3, 1]);
    for (let i = 0; i < 8; i++) p.tick();
    expect([first(20), first(21), first(22)]).toEqual([3, 1, 2]);
    for (let i = 0; i < 8; i++) p.tick();
    expect(a.active).toBe(false);
    expect([first(20), first(21), first(22)]).toEqual([1, 2, 3]); // restauré
    expect(first(40)).toBe(10); // 12 rotations à pas 2 : toujours actif, pair = ordre d'origine
    p.stopCycles();
  });
});

describe("polices FON", () => {
  const sizes = [
    { file: "NCSCLB10.FON", points: 10, height: 11 },
    { file: "NCSCLB12.FON", points: 12, height: 13 },
    { file: "NCSCLB14.FON", points: 14, height: 15 },
    { file: "NCSCLB18.FON", points: 18, height: 19 },
    { file: "NCSCLB24.FON", points: 25, height: 26 },
  ];

  describe.skipIf(!hasOriginalFiles)("sur les fichiers du jeu", () => {
    it.each(sizes)("$file : une police de 256 glyphes", ({ file, points, height }) => {
      const fonts = parseFon(readOriginal(file));
      expect(fonts).toHaveLength(1);
      const font = fonts[0]!;
      expect(font.face).toBe(file.replace(".FON", "").replace("NCSCLB", "NCSclB"));
      expect(font.points).toBe(points);
      expect(font.height).toBe(height);
      expect([font.firstChar, font.lastChar]).toEqual([0, 255]);
      expect(font.glyph(65).pixels.some((v) => v === 1)).toBe(true);
      expect(font.glyph(32).pixels.every((v) => v === 0)).toBe(true);
      for (let c = 0; c < 256; c++) expect(font.glyph(c).pixels.length).toBe(font.glyph(c).width * height);
    });

    it("largeurs connues et mesure", () => {
      const f10 = parseFon(readOriginal("NCSCLB10.FON"))[0]!;
      const f14 = parseFon(readOriginal("NCSCLB14.FON"))[0]!;
      expect(f10.glyph(65).width).toBe(9);
      expect(f14.glyph(65).width).toBe(11);
      expect(measureText(f10, "")).toBe(0);
      expect(measureText(f10, "AA")).toBe(18);
      expect(measureText(f10, "A÷A")).toBe(9 + f10.glyph(0xd6).width + 9);
      expect(measureText(f10, new Uint8Array([0x41, 0xd6, 0x41]))).toBe(measureText(f10, "A÷A"));
      expect(measureText(f10, "AÖA")).toBe(9 + f10.glyph(0x85).width + 9);
    });

    it("dessine un texte coloré, découpé, et le glyphe ÷ est le 0xD6 de la police", () => {
      const font = parseFon(readOriginal("NCSCLB14.FON"))[0]!;
      const s = new Surface(60, 20);
      const width = drawText(s, font, "A÷", 2, 1, 200);
      expect(width).toBe(font.glyph(65).width + font.glyph(0xd6).width);
      expect(s.pixels.every((v) => v === 0 || v === 200)).toBe(true);
      expect(s.pixels.some((v) => v === 200)).toBe(true);
      expect(s.get(0, 0)).toBe(0);
      const clipped = new Surface(60, 20);
      clipped.pushClip({ x: 0, y: 0, w: 5, h: 20 });
      drawText(clipped, font, "AAAA", 2, 1, 200);
      for (let y = 0; y < 20; y++) for (let x = 5; x < 60; x++) expect(clipped.get(x, y)).toBe(0);
    });
  });

  it("convertit les chaînes en codes de glyphe Mac Roman", () => {
    expect(Array.from(encodeText("Aé€÷Ö?"))).toEqual([0x41, 0x8e, 0xdb, 0xd6, 0x85, 0x3f]);
    expect(Array.from(encodeText("ÀÈÇçùÿ"))).toEqual([0xcb, 0xe9, 0x82, 0x8d, 0x9d, 0xd8]);
    expect(Array.from(encodeText("ж"))).toEqual([0x3f]);
  });

  it("la table Mac Roman couvre les codes 0x80 à 0xFF une seule fois", () => {
    const codes = new Set<number>();
    for (const char of "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»…\u00a0ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ\uf8ffÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ") {
      const [code] = encodeText(char);
      expect(code, char).toBeGreaterThanOrEqual(0x80);
      codes.add(code!);
    }
    expect(codes.size).toBe(128);
  });
});

describe("transitions", () => {
  const rect = { x: 32, y: 24, w: 100, h: 73 };

  function covered(surface: Surface): number {
    return surface.pixels.reduce((n, v) => n + (v === 1 ? 1 : 0), 0);
  }

  function collect(transition: Wipe | Blinds): { ticks: number; surface: Surface } {
    const target = new Surface(200, 150);
    const source = new Surface(200, 150);
    source.fill(1);
    let ticks = 0;
    for (const rects of transitionFrames(transition)) {
      ticks++;
      revealRects(target, source, rects);
    }
    return { ticks, surface: target };
  }

  it.each([0, 1, 2, 3] as WipeDirection[])("balayage direction %i : couvre tout le rectangle, une seule fois", (direction) => {
    const { surface } = collect(new Wipe(rect, direction, 30));
    expect(covered(surface)).toBe(rect.w * rect.h);
    expect(surface.get(rect.x, rect.y)).toBe(1);
    expect(surface.get(rect.x + rect.w - 1, rect.y + rect.h - 1)).toBe(1);
    expect(surface.get(rect.x - 1, rect.y)).toBe(0);
  });

  it("balayage : nombre de ticks, ordre de progression", () => {
    expect(collect(new Wipe({ x: 0, y: 0, w: 576, h: 432 }, 0, 30)).ticks).toBe(30);
    expect(collect(new Wipe({ x: 0, y: 0, w: 576, h: 432 }, 2, 30)).ticks).toBe(30);
    const wipe = new Wipe(rect, 1, 30);
    const [first] = wipe.step();
    expect(first!.y + first!.h).toBe(rect.y + rect.h); // direction 1 : part du bas
    const left = new Wipe(rect, 3, 30);
    const [band] = left.step();
    expect(band!.x + band!.w).toBe(rect.x + rect.w); // direction 3 : part de la droite
  });

  it("stores vénitiens : bandes de 10 lignes, 15 ou 30 ticks, tout est couvert", () => {
    for (const ticks of [15, 30]) {
      const { ticks: count, surface } = collect(new Blinds(rect, ticks, 10));
      expect(count).toBe(ticks);
      expect(covered(surface)).toBe(rect.w * rect.h);
    }
    // Rectangle d'un nombre de lignes non multiple de la bande : la dernière bande est rognée.
    const first = new Blinds(rect, 15, 10).step();
    expect(first).toHaveLength(8);
    expect(first.every((r) => r.h === 1 && (r.y - rect.y) % 10 === 0)).toBe(true);
  });

  it("finish révèle tout ce qui reste (clic pendant la transition)", () => {
    for (const transition of [new Wipe(rect, 2, 30), new Blinds(rect, 30, 10)]) {
      const target = new Surface(200, 150);
      const source = new Surface(200, 150);
      source.fill(1);
      revealRects(target, source, transition.step());
      revealRects(target, source, transition.step());
      revealRects(target, source, transition.finish());
      expect(transition.done).toBe(true);
      expect(covered(target)).toBe(rect.w * rect.h);
      expect(transition.finish()).toEqual([]);
    }
  });
});

describe.skipIf(!hasOriginalFiles)("données réelles : MAINSCRN SHAP 100", () => {
  it("le rendu surface + palette donne les mêmes couleurs que le décodage direct", () => {
    const archive = MohawkArchive.parse(readFileSync(resolve(import.meta.dirname, "../../original/mathemagique/MAINSCRN.DAT")));
    const background = decodeShap(archive.get(TAG_SHAP, 100));
    const shpl = parseShpl(archive.get(TAG_SHPL, 100));
    expect([background.width, background.height]).toEqual([576, 432]);

    const surface = new Surface();
    drawShape(surface, background, 0, 0, 0);
    const palette = new Palette();
    palette.loadShpl(shpl);
    const screen = palette.output();

    // Référence : ce que fait scripts/mathemagique/render-samples.mts (applyShpl sur createPalette, puis index -> RVB).
    const reference = createPalette();
    applyShpl(reference, shpl);
    expect(Array.from(screen)).toEqual(Array.from(reference));
    for (const [x, y] of [[0, 0], [10, 10], [288, 216], [575, 431], [100, 300]] as const) {
      const index = background.pixels[y * 576 + x]!;
      expect(surface.get(x, y)).toBe(index);
      expect(Array.from(screen.subarray(index * 3, index * 3 + 3))).toEqual(Array.from(reference.subarray(index * 3, index * 3 + 3)));
    }
    expect(Array.from(surface.pixels)).toEqual(Array.from(background.pixels));
    // Le fond n'utilise jamais l'index 0 : le mode 8 donne la même image.
    const surface8 = new Surface();
    drawShape(surface8, background, 0, 0, 8);
    expect(Array.from(surface8.pixels)).toEqual(Array.from(background.pixels));
  });
});
