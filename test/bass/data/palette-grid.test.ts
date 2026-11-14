import { describe, expect, it } from "vitest";
import {
  GRID_BLOCK,
  GRID_COLUMNS,
  GRID_CONVERT_TABLE,
  GRID_ROWS,
  GRID_SIZE,
  TOT_NO_GRIDS,
  gridBitNumber,
  gridIndexOfScreen,
  gridToCells,
  isGridBlocked,
  setGridBlocked,
} from "../../../src/games/bass/data/grid-file";
import { CONTROL_PANEL_PALETTE, GRID_FIRST, gridFile } from "../../../src/games/bass/data/ids";
import { GAME_COLORS, PALETTE_BYTES, VGA_COLORS, vgaPaletteToRgb } from "../../../src/games/bass/data/palette";
import { allFiles, hasOriginalFiles } from "./helpers";

describe("palette VGA", () => {
  it("passe les composantes de 6 à 8 bits par (v << 2) + (v >> 4)", () => {
    const vga = new Uint8Array(PALETTE_BYTES);
    vga.set([0, 63, 32, 1, 16, 48]);
    const rgb = vgaPaletteToRgb(vga);
    expect(rgb).toHaveLength(768);
    expect([...rgb.subarray(0, 6)]).toEqual([0, 255, 130, 4, 65, 195]);
    expect(GAME_COLORS).toBe(240);
    expect(VGA_COLORS).toBe(256);
  });

  it("tronque une composante hors de 0 à 63 à un octet, comme le moteur, et refuse un fichier trop court", () => {
    const vga = new Uint8Array(PALETTE_BYTES);
    vga[0] = 255;
    expect(vgaPaletteToRgb(vga)[0]).toBe(((255 << 2) + (255 >> 4)) & 0xff);
    expect(() => vgaPaletteToRgb(new Uint8Array(767))).toThrow(/invalide/);
  });
});

describe("grilles (données synthétiques)", () => {
  it("numérote les bits par mots de 32 bits, première case en poids fort", () => {
    expect(gridBitNumber(0, 0)).toBe(31);
    expect(gridBitNumber(1, 0)).toBe(30);
    expect(gridBitNumber(31, 0)).toBe(0);
    expect(gridBitNumber(32, 0)).toBe(63);
    // Les lignes de 40 cases ne sont pas alignées : la case (0, 1) est le rang 40, soit le mot 1, bit 31 - 8.
    expect(gridBitNumber(0, 1)).toBe(32 + 23);
    expect(gridBitNumber(39, 23)).toBe(((23 * 40 + 39) & ~31) + (31 - ((23 * 40 + 39) & 31)));
    expect(() => gridBitNumber(40, 0)).toThrow(RangeError);
    expect(() => gridBitNumber(0, 24)).toThrow(RangeError);
  });

  it("pose et retire un bloc ; l'octet touché est celui de ScummVM (octet = bit >> 3, masque = 1 << (bit & 7))", () => {
    const grid = new Uint8Array(GRID_SIZE);
    setGridBlocked(grid, 0, 0, true);
    expect(grid[3]).toBe(0x80);
    setGridBlocked(grid, 1, 0, true);
    expect(grid[3]).toBe(0xc0);
    setGridBlocked(grid, 31, 0, true);
    expect(grid[0]).toBe(0x01);
    expect(isGridBlocked(grid, 1, 0)).toBe(true);
    setGridBlocked(grid, 1, 0, false);
    expect(isGridBlocked(grid, 1, 0)).toBe(false);
    expect(gridToCells(grid).reduce((n, v) => n + v, 0)).toBe(2);
    expect(() => isGridBlocked(new Uint8Array(119), 0, 0)).toThrow(/invalide/);
  });

  it("convertit un écran en numéro de grille", () => {
    expect(GRID_CONVERT_TABLE).toHaveLength(97);
    expect(gridIndexOfScreen(0)).toBe(0);
    expect(gridIndexOfScreen(36)).toBe(35);
    expect(gridIndexOfScreen(35)).toBeUndefined();
    expect(gridIndexOfScreen(66)).toBeUndefined();
    expect(gridIndexOfScreen(96)).toBe(69);
    expect(gridIndexOfScreen(97)).toBeUndefined();
    expect(GRID_COLUMNS * GRID_ROWS).toBe(GRID_SIZE * 8);
    expect(GRID_BLOCK * GRID_COLUMNS).toBe(320);
    // Chacune des 70 grilles est atteinte par un écran, une seule fois.
    const reached = GRID_CONVERT_TABLE.filter((g) => g >= 0 && g < TOT_NO_GRIDS);
    expect([...reached].sort((a, b) => a - b)).toEqual(Array.from({ length: TOT_NO_GRIDS }, (_, i) => i));
  });
});

describe.skipIf(!hasOriginalFiles)("palettes et grilles (fichiers du jeu)", () => {
  it("la palette du panneau (60510) fait 768 octets de composantes sur 6 bits", () => {
    const palette = allFiles().get(CONTROL_PANEL_PALETTE)!;
    expect(palette).toHaveLength(768);
    expect(Math.max(...palette)).toBeLessThanOrEqual(63);
    const rgb = vgaPaletteToRgb(palette);
    expect(Math.max(...rgb)).toBeGreaterThan(200);
  });

  it("les 70 grilles (60000 à 60069) font 120 octets et se lisent comme des mots de 32 bits petit-boutistes", () => {
    let nonEmpty = 0;
    for (let g = 0; g < TOT_NO_GRIDS; g++) {
      const file = allFiles().get(gridFile(g))!;
      expect(file, `grille ${g}`).toHaveLength(GRID_SIZE);
      const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
      let blocked = 0;
      for (let row = 0; row < GRID_ROWS; row++) {
        for (let column = 0; column < GRID_COLUMNS; column++) {
          const k = row * GRID_COLUMNS + column;
          // Formulation indépendante : mot k >> 5, case n°0 en bit 31.
          const expected = ((view.getUint32((k >> 5) * 4, true) >>> (31 - (k & 31))) & 1) === 1;
          expect(isGridBlocked(file, column, row)).toBe(expected);
          if (expected) blocked++;
        }
      }
      if (blocked > 0) nonEmpty++;
    }
    expect(gridFile(0)).toBe(GRID_FIRST);
    expect(nonEmpty).toBeGreaterThan(60);
  });
});
