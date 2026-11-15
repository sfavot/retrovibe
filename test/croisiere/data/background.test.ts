import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  isPaletteOnly,
  PALETTE_SIZE,
  parseBackground,
  parsePaletteOnly,
  SCREEN_PIXELS,
} from "../../../src/games/croisiere/data/background";
import { CruiseVolumes } from "../../../src/games/croisiere/data/volumes";
import { originalFiles } from "../../support/original";

const original = originalFiles("croisiere", "VOL.CNF");
const hasOriginalFiles = original.has && ["D1", "D2", "D3", "D4", "D5"].every((name) => original.list((n) => n === name).length === 1);
const sha = (bytes: Uint8Array) => createHash("sha1").update(bytes).digest("hex").slice(0, 12);

describe("fonds PI1 (synthétiques)", () => {
  it("mode 8 : palette 8 bits telle quelle et pixels chunky", () => {
    const bytes = new Uint8Array(2 + PALETTE_SIZE + SCREEN_PIXELS);
    bytes[1] = 8;
    bytes[2] = 255;
    bytes[2 + 5] = 7;
    bytes[2 + PALETTE_SIZE + 321] = 42;
    const bg = parseBackground(bytes);
    expect(bg.mode).toBe(8);
    expect(bg.palette[0]).toBe(255);
    expect(bg.palette[5]).toBe(7);
    expect(bg.pixels[321]).toBe(42);
    expect(bg.pixels).toHaveLength(SCREEN_PIXELS);
  });

  it("mode 5 : nibbles × 17, palette dupliquée 8 fois, cinq plans consécutifs, bit 7 = pixel de gauche", () => {
    const bytes = new Uint8Array(2 + 64 + 40_000);
    bytes[1] = 5;
    bytes[2 + 2] = 0x0a; // couleur 1 : R = 0xA, G = 0x1, B = 0x2
    bytes[2 + 3] = 0x12;
    const planes = 2 + 64;
    bytes[planes + 0 * 8000 + 40 * 3 + 2] = 0x80; // ligne 3, colonne 2, bit 7 : plan 0
    bytes[planes + 4 * 8000 + 40 * 3 + 2] = 0x80; // plan 4
    bytes[planes + 1 * 8000 + 39] = 0x01; // ligne 0, dernier pixel : plan 1
    const bg = parseBackground(bytes);
    expect(Array.from(bg.palette.subarray(3, 6))).toEqual([0xaa, 0x11, 0x22]);
    expect(Array.from(bg.palette.subarray(32 * 3 * 7 + 3, 32 * 3 * 7 + 6))).toEqual([0xaa, 0x11, 0x22]);
    expect(bg.pixels[3 * 320 + 16]).toBe(1 | 16);
    expect(bg.pixels[319]).toBe(2);
    expect(bg.pixels.reduce((a, b) => a + (b ? 1 : 0), 0)).toBe(2);
  });

  it("fichier palette seule, modes absents et tailles fausses", () => {
    const pal = new Uint8Array(4 + PALETTE_SIZE);
    pal.set([0x50, 0x41, 0x4c, 0, 9]);
    expect(isPaletteOnly(pal)).toBe(true);
    expect(parsePaletteOnly(pal)[0]).toBe(9);
    expect(() => parseBackground(pal)).toThrow(/palette/);
    expect(() => parseBackground(Uint8Array.from([0, 4, 0, 0]))).toThrow(/mode 4/);
    expect(() => parseBackground(Uint8Array.from([0, 8, 1, 2]))).toThrow(/taille/);
    expect(() => parseBackground(Uint8Array.from([0, 5, 1, 2]))).toThrow(/taille/);
  });
});

describe.skipIf(!hasOriginalFiles)("fonds PI1 (fichiers originaux)", () => {
  const volumes = CruiseVolumes.open((name) => original.read(name));

  it("décode les 161 PI1 des volumes sans reste (102 en mode 8, 59 en mode 5, 1 palette seule)", () => {
    const modes: Record<string, number> = {};
    for (const entry of volumes.entries.filter((e) => e.name.endsWith(".PI1"))) {
      const bytes = volumes.readEntry(entry);
      if (isPaletteOnly(bytes)) {
        expect(parsePaletteOnly(bytes)).toHaveLength(PALETTE_SIZE);
        modes.pal = (modes.pal ?? 0) + 1;
        continue;
      }
      const bg = parseBackground(bytes);
      expect(bg.pixels, entry.name).toHaveLength(SCREEN_PIXELS);
      expect(bg.palette, entry.name).toHaveLength(PALETTE_SIZE);
      modes[bg.mode] = (modes[bg.mode] ?? 0) + 1;
    }
    expect(modes).toEqual({ 8: 102, 5: 59, pal: 1 });
  });

  it("I00.PI1 (mode 8) et XX2.PI1 (mode 5) : empreintes recoupées avec un décodeur Python indépendant", () => {
    const i00 = parseBackground(volumes.readFile("I00.PI1"));
    expect(i00.mode).toBe(8);
    expect(sha(i00.pixels)).toBe("134244d10b83");
    expect(sha(i00.palette)).toBe("a8f512e3be28");
    const xx2 = parseBackground(volumes.readFile("XX2.PI1"));
    expect(xx2.mode).toBe(5);
    expect(sha(xx2.pixels)).toBe("7db64e29b597");
    expect(sha(xx2.palette)).toBe("3ff3508d69e3");
    expect(Math.max(...xx2.pixels)).toBeLessThan(32);
  });
});
