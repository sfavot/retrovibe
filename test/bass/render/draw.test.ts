import { describe, expect, it } from "vitest";
import { DATA_FILE_HEADER_SIZE } from "../../../src/games/bass/data/header";
import { SpriteFile } from "../../../src/games/bass/data/sprite";
import {
  GRID_FLIP,
  GRID_RECREATE,
  type MaskLayer,
  ScrollDirection,
  SCROLL_STEPS,
  deblockBackground,
  drawSprite,
  markBlocks,
  recreateBackground,
  scrollFrame,
  showFullImage,
  sortSprites,
  spriteSortKey,
  verticalMask,
} from "../../../src/games/bass/render/draw";
import { GAME_SCREEN_SIZE, SCREEN_SIZE, SCREEN_WIDTH, TOP_LEFT_X, TOP_LEFT_Y } from "../../../src/games/bass/render/frame-buffer";

function makeSprite(width: number, height: number, pixels: number[], offsetX = 0, offsetY = 0): SpriteFile {
  const bytes = new Uint8Array(DATA_FILE_HEADER_SIZE + pixels.length);
  const view = new DataView(bytes.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  view.setUint16(10, width * height, true);
  view.setUint16(14, 1, true);
  view.setInt16(16, offsetX, true);
  view.setInt16(18, offsetY, true);
  bytes.set(pixels, DATA_FILE_HEADER_SIZE);
  return new SpriteFile(bytes);
}

const screen = (): Uint8Array => new Uint8Array(SCREEN_SIZE);
const at = (buf: Uint8Array, x: number, y: number): number => buf[y * SCREEN_WIDTH + x]!;

describe("images et décor", () => {
  it("showFullImage force les 8 dernières lignes à 0 hors plein écran", () => {
    const dest = screen();
    const image = new Uint8Array(SCREEN_SIZE).fill(7);
    showFullImage(dest, image, false);
    expect([at(dest, 0, 191), at(dest, 0, 192), at(dest, 319, 199)]).toEqual([7, 0, 0]);
    showFullImage(dest, image, true);
    expect(at(dest, 0, 199)).toBe(7);
    expect(() => showFullImage(dest, new Uint8Array(100), true)).toThrow(/invalide/);
  });

  it("remet un décor par blocs de 16 x 8 en lignes ; seules les cases marquées sont recopiées", () => {
    const blocks = new Uint8Array(GAME_SCREEN_SIZE);
    // Bloc 21 (rangée 1, colonne 1) : ligne n de ce bloc = 100 + n.
    for (let line = 0; line < 8; line++) blocks.fill(100 + line, 21 * 128 + line * 16, 21 * 128 + line * 16 + 16);
    const full = deblockBackground(blocks);
    expect([full[8 * 320 + 16], full[9 * 320 + 31], full[15 * 320 + 16], full[8 * 320 + 15]]).toEqual([100, 101, 107, 0]);

    const grid = new Uint8Array(480);
    grid[21] = GRID_RECREATE;
    const dest = new Uint8Array(SCREEN_SIZE).fill(9);
    recreateBackground(dest, blocks, grid);
    expect(at(dest, 16, 8)).toBe(100);
    expect(at(dest, 0, 0)).toBe(9);
    expect(grid[21]).toBe(GRID_FLIP);
  });
});

describe("drawSprite", () => {
  const sprite = makeSprite(4, 3, [1, 0, 2, 3, 0, 4, 5, 6, 7, 8, 0, 9], -1, -2);
  const origin = { x: TOP_LEFT_X + 1, y: TOP_LEFT_Y + 2 };

  it("dessine en (xcood + offsetX - 128, ycood + offsetY - 136), la couleur 0 est transparente", () => {
    const dest = screen().fill(50);
    const blocks = drawSprite(dest, sprite, 0, origin.x + 20, origin.y + 10);
    expect([at(dest, 20, 10), at(dest, 21, 10), at(dest, 22, 10), at(dest, 23, 12)]).toEqual([1, 50, 2, 9]);
    expect(blocks).toEqual({ x: 1, y: 1, width: 1, height: 1 });
  });

  it("rogne en haut et à gauche exactement", () => {
    const dest = screen();
    const blocks = drawSprite(dest, sprite, 0, origin.x - 1, origin.y - 1);
    // Sprite en (-1, -1) : première ligne et première colonne perdues ; reste [4, 5, 6] puis [8, 0, 9] (0 transparent).
    expect([at(dest, 0, 0), at(dest, 1, 0), at(dest, 2, 0), at(dest, 0, 1), at(dest, 1, 1), at(dest, 2, 1)]).toEqual([4, 5, 6, 8, 0, 9]);
    expect(blocks).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("ne dessine rien si le sprite est entièrement au-dessus ou à gauche", () => {
    expect(drawSprite(screen(), sprite, 0, origin.x - 4, origin.y)).toBeNull();
    expect(drawSprite(screen(), sprite, 0, origin.x, origin.y - 3)).toBeNull();
  });

  it("rogne en bas exactement (192 lignes de jeu) et ne touche pas les 8 dernières lignes", () => {
    const dest = screen();
    drawSprite(dest, sprite, 0, origin.x, origin.y + 190);
    expect(at(dest, 0, 190)).toBe(1);
    expect(at(dest, 1, 191)).toBe(4);
    expect(at(dest, 0, 192)).toBe(0);
  });

  it("rogne à droite un pixel de plus que nécessaire, comme ScummVM", () => {
    const dest = screen();
    // Sprite de 4 pixels en x = 318 : dépasse de 2, perd 3 (2 + 1) : seul le pixel 318 est dessiné.
    drawSprite(dest, sprite, 0, origin.x + 318, origin.y);
    expect([at(dest, 318, 0), at(dest, 319, 0)]).toEqual([1, 0]);
    // Tient exactement (x = 316) : rien n'est rogné.
    const exact = screen();
    drawSprite(exact, sprite, 0, origin.x + 316, origin.y);
    expect(at(exact, 319, 0)).toBe(3);
  });
});

describe("masque vertical, marquage, tri", () => {
  it("marque les cases de grille couvertes", () => {
    const grid = new Uint8Array(480);
    markBlocks(grid, { x: 2, y: 3, width: 2, height: 2 }, 0x81);
    expect([grid[3 * 20 + 2], grid[4 * 20 + 3], grid[3 * 20 + 4], grid[2 * 20 + 2]]).toEqual([0x81, 0x81, 0, 0]);
  });

  it("remonte depuis la rangée du bas, recopie les blocs de la couche (0 transparent), saute le bit 0x8000 et s'arrête à une case nulle", () => {
    const layerPixels = new Uint8Array(4 * 128);
    layerPixels.fill(11, 0, 128); // bloc 1
    layerPixels.fill(0, 128, 256);
    layerPixels[128 + 5] = 22; // bloc 2 : un seul pixel non nul
    layerPixels.fill(33, 256, 384); // bloc 3
    const grid = new Uint16Array(480);
    grid[4 * 20 + 1] = 1; // rangée du bas (3 sur 5) : bloc 1
    grid[3 * 20 + 1] = 0x8000 | 5; // sautée
    grid[2 * 20 + 1] = 3; // dessinée
    // grid[1 * 20 + 1] = 0 : la remontée s'arrête avant
    grid[1 * 20 + 1] = 0;
    grid[0 * 20 + 1] = 2; // jamais atteinte
    const layer: MaskLayer = { pixels: layerPixels, grid };
    const dest = screen().fill(5);
    verticalMask(dest, { x: 1, y: 0, width: 1, height: 5 }, [layer, undefined]);
    expect(at(dest, 16, 4 * 8)).toBe(11);
    expect(at(dest, 16, 3 * 8)).toBe(5);
    expect(at(dest, 16, 2 * 8)).toBe(33);
    expect(at(dest, 16, 8)).toBe(5);
    expect(at(dest, 16, 0)).toBe(5);
    expect(at(dest, 15, 4 * 8)).toBe(5);
  });

  it("trie comme sortSprites : clé 16 bits, échange si strictement supérieur", () => {
    const sprite = makeSprite(2, 10, new Array(20).fill(1), 0, -5);
    expect(spriteSortKey(100, sprite)).toBe(105);
    expect(spriteSortKey(0, makeSprite(2, 1, [1, 1], 0, -5))).toBe((0 - 5 + 1) & 0xffff);
    const list = [
      { id: "a", y: 30 },
      { id: "b", y: 10 },
      { id: "c", y: 30 },
      { id: "d", y: 20 },
    ];
    sortSprites(list, (item) => item.y);
    expect(list.map((i) => i.id)).toEqual(["b", "d", "c", "a"]);
  });
});

describe("défilement", () => {
  const oldScreen = new Uint8Array(SCREEN_SIZE);
  const newScreen = new Uint8Array(SCREEN_SIZE);
  for (let y = 0; y < 192; y++)
    for (let x = 0; x < 320; x++) {
      oldScreen[y * 320 + x] = 1;
      newScreen[y * 320 + x] = 2;
    }

  it("vers la gauche : l'ancien décor sort à gauche, le nouveau entre par la droite, 16 pixels par pas", () => {
    const dest = screen();
    scrollFrame(dest, oldScreen, newScreen, ScrollDirection.left, 1);
    expect([at(dest, 0, 0), at(dest, 303, 0), at(dest, 304, 0), at(dest, 319, 191)]).toEqual([1, 1, 2, 2]);
    scrollFrame(dest, oldScreen, newScreen, ScrollDirection.left, SCROLL_STEPS);
    expect([at(dest, 0, 5), at(dest, 15, 5), at(dest, 16, 5)]).toEqual([1, 1, 2]);
    scrollFrame(dest, oldScreen, newScreen, ScrollDirection.left, SCROLL_STEPS + 1);
    expect(at(dest, 0, 0)).toBe(2);
  });

  it("vers la droite : le nouveau décor entre par la gauche", () => {
    const dest = screen();
    scrollFrame(dest, oldScreen, newScreen, ScrollDirection.right, 2);
    expect([at(dest, 31, 0), at(dest, 32, 0), at(dest, 319, 0)]).toEqual([2, 1, 1]);
    expect(() => scrollFrame(dest, oldScreen, newScreen, ScrollDirection.right, 0)).toThrow(RangeError);
  });
});
