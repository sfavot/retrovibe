import { describe, expect, it } from "vitest";
import { DATA_FILE_HEADER_SIZE } from "../../../src/games/bass/data/header";
import { SpriteFile } from "../../../src/games/bass/data/sprite";
import {
  CursorSet,
  MouseCursor,
  cursorRgba,
  drawCursor,
  findMouseCursor,
  MOUSE_LINC_OBJECTS,
  MOUSE_MAIN_OBJECTS,
} from "../../../src/games/bass/render/cursor";
import { FrameBuffer, SCREEN_SIZE, SCREEN_WIDTH, initialPalette } from "../../../src/games/bass/render/frame-buffer";
import { FADE_STEPS, fadeDownStep, fadeUpStep, fadedDown, halvedPalette } from "../../../src/games/bass/render/palette-fade";
import { PALETTE_BYTES, vgaPaletteToRgb } from "../../../src/games/bass/data/palette";
import { hasOriginalFiles, skyDisk } from "../data/helpers";

describe("fondus de palette", () => {
  it("fondu au noir : 8 par pas, plancher à 0, cumulatif ; 255 atteint 0 au pas 32", () => {
    const pal = new Uint8Array(PALETTE_BYTES);
    pal.set([255, 7, 8, 100], 0);
    pal.set([9, 9, 9], 239 * 3);
    pal.set([200, 200, 200], 240 * 3);
    fadeDownStep(pal);
    expect([...pal.subarray(0, 4)]).toEqual([247, 0, 0, 92]);
    // Les 16 dernières couleurs ne bougent pas.
    expect([...pal.subarray(240 * 3, 240 * 3 + 3)]).toEqual([200, 200, 200]);
    const start = new Uint8Array(PALETTE_BYTES).fill(255);
    expect(fadedDown(start, 31)[0]).toBe(255 - 31 * 8);
    expect(fadedDown(start, FADE_STEPS)[0]).toBe(0);
    expect(start[0]).toBe(255);
  });

  it("fondu en entrée : (cible * pas) >> 5, calculé depuis la cible, le pas 32 rend la cible", () => {
    const target = new Uint8Array(PALETTE_BYTES);
    target.set([255, 100, 1]);
    const out = new Uint8Array(PALETTE_BYTES);
    out.set([1, 2, 3], 240 * 3);
    fadeUpStep(target, 1, out);
    expect([...out.subarray(0, 3)]).toEqual([7, 3, 0]);
    expect([...out.subarray(240 * 3, 240 * 3 + 3)]).toEqual([1, 2, 3]);
    fadeUpStep(target, 16, out);
    expect([...out.subarray(0, 3)]).toEqual([127, 50, 0]);
    fadeUpStep(target, FADE_STEPS, out);
    expect([...out.subarray(0, 3)]).toEqual([255, 100, 1]);
    expect(() => fadeUpStep(target, 0, out)).toThrow(RangeError);
    expect(() => fadeUpStep(target, 33, out)).toThrow(RangeError);
  });

  it("la pause divise la palette de jeu par deux sans modifier l'original", () => {
    const pal = new Uint8Array(PALETTE_BYTES).fill(255);
    const half = halvedPalette(pal);
    expect([half[0], half[239 * 3 + 2], half[240 * 3]]).toEqual([127, 127, 255]);
    expect(pal[0]).toBe(255);
  });
});

describe("FrameBuffer", () => {
  it("la palette de départ est noire pour les 240 couleurs de jeu et fixe les 16 d'interface", () => {
    const pal = initialPalette();
    expect([...pal.subarray(0, 3)]).toEqual([0, 0, 0]);
    // Couleur 255 : blanc (63 en VGA), couleur 241 : gris (38 en VGA).
    expect([...pal.subarray(255 * 3, 255 * 3 + 3)]).toEqual([255, 255, 255]);
    expect(pal[241 * 3]).toBe((38 << 2) + (38 >> 4));
  });

  it("setVgaPalette n'écrase que les 240 couleurs de jeu et toRgba applique la palette", () => {
    const fb = new FrameBuffer();
    const vga = new Uint8Array(PALETTE_BYTES).fill(63);
    fb.setVgaPalette(vga);
    expect([...fb.palette.subarray(0, 3)]).toEqual([255, 255, 255]);
    expect(fb.palette[241 * 3]).toBe(initialPalette()[241 * 3]);
    fb.pixels[0] = 5;
    fb.pixels[1] = 241;
    const rgba = fb.toRgba();
    expect(rgba).toHaveLength(SCREEN_SIZE * 4);
    expect([...rgba.subarray(0, 8)]).toEqual([255, 255, 255, 255, initialPalette()[241 * 3]!, initialPalette()[241 * 3 + 1]!, initialPalette()[241 * 3 + 2]!, 255]);
    expect(vgaPaletteToRgb(vga)[0]).toBe(255);
  });
});

function spriteFile(width: number, height: number, frames: number[][]): SpriteFile {
  const size = width * height;
  const bytes = new Uint8Array(DATA_FILE_HEADER_SIZE + frames.length * size);
  const view = new DataView(bytes.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  view.setUint16(10, size, true);
  view.setUint16(14, frames.length, true);
  frames.forEach((f, i) => bytes.set(f, DATA_FILE_HEADER_SIZE + i * size));
  return new SpriteFile(bytes);
}

describe("curseurs", () => {
  const mice = spriteFile(2, 2, Array.from({ length: 9 }, (_, i) => [i + 1, 0, 0, i + 1]));
  const objects = spriteFile(2, 2, Array.from({ length: 4 }, (_, i) => [100 + i, 100 + i, 100 + i, 100 + i]));

  it("choisit l'image et le point chaud, masque le curseur blank", () => {
    const set = new CursorSet(mice, objects);
    const cross = set.spriteMouse(MouseCursor.cross)!;
    expect(cross.hotspot).toEqual({ x: 4, y: 4 });
    expect([...cross.pixels]).toEqual([8, 0, 0, 8]);
    expect(set.spriteMouse(MouseCursor.blank)).toBeNull();
    expect(set.current).toBe(MouseCursor.blank);
  });

  it("main ouverte ou fermée : copie l'image d'objet dans l'image 0 (point chaud 5, 5) ; sans objet, curseur normal", () => {
    const set = new CursorSet(mice, objects);
    const held = MOUSE_MAIN_OBJECTS[1]!;
    expect([...set.openCloseHand(true, held)!.pixels]).toEqual([103, 103, 103, 103]);
    expect(set.openCloseHand(false, held)!.hotspot).toEqual({ x: 5, y: 5 });
    expect(set.openCloseHand(false, 0)!.pixels).toEqual(Uint8Array.from([2, 0, 0, 2]));
    // Le fichier d'origine n'est pas modifié.
    expect([...mice.frame(0)]).toEqual([1, 0, 0, 1]);
  });

  it("trouve le rang d'un objet : principaux, puis Linc, sinon 0", () => {
    expect(findMouseCursor(MOUSE_MAIN_OBJECTS[5]!)).toBe(5);
    expect(findMouseCursor(MOUSE_LINC_OBJECTS[3]!)).toBe(3);
    expect(findMouseCursor(123456)).toBe(0);
  });

  it("dessine avec rognage et sans la couleur 0 ; RGBA transparent sur 0", () => {
    const cursor = new CursorSet(mice, objects).spriteMouse(MouseCursor.normal, { x: 1, y: 1 })!;
    const dest = new Uint8Array(SCREEN_SIZE);
    drawCursor(dest, cursor, 0, 0);
    expect(dest[0]).toBe(2);
    expect(dest[SCREEN_WIDTH]).toBe(0);
    drawCursor(dest, cursor, 10, 10);
    expect([dest[9 * SCREEN_WIDTH + 9], dest[9 * SCREEN_WIDTH + 10], dest[10 * SCREEN_WIDTH + 10]]).toEqual([2, 0, 2]);
    const rgba = cursorRgba(cursor, new FrameBuffer().palette);
    expect([rgba[3], rgba[7]]).toEqual([255, 0]);
  });
});

describe.skipIf(!hasOriginalFiles)("curseurs réels", () => {
  it("le curseur normal (60300, image 1) a des pixels visibles et l'objet tenu remplace l'image 0", () => {
    const disk = skyDisk();
    const set = new CursorSet(new SpriteFile(disk.load(60300)), new SpriteFile(disk.load(60301)));
    const normal = set.spriteMouse(MouseCursor.normal)!;
    expect(normal.pixels.some((p) => p !== 0)).toBe(true);
    const hand = set.openCloseHand(true, MOUSE_MAIN_OBJECTS[0]!)!;
    expect(hand.pixels.some((p) => p !== 0)).toBe(true);
  });
});
