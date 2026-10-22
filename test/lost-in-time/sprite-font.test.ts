import { describe, expect, it } from "vitest";
import { GraphicsSystems, Surface } from "../../src/games/lost-in-time/engine/graphics";
import { BACK_SURFACE } from "../../src/games/lost-in-time/engine/graphics/core";

/** Planche de police en sprite : cellules de 4x4, 8 par ligne, `base` = 65 ('A'), cellule i remplie de la couleur i + 1. */
function setup(rows: number) {
  const gfx = new GraphicsSystems();
  const draw = gfx.draw;
  const sheet = Surface.sprite(32, rows * 4);
  for (let i = 0; i < rows * 8; i++) {
    const sx = (i % 8) * 4;
    const sy = Math.trunc(i / 8) * 4;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) sheet.pixels[(sy + y) * sheet.width + sx + x] = i + 1;
  }
  draw.sprites[8] = sheet;
  draw.loadFontToSprite(3, 8, 65, 4, 4);
  return { draw, back: draw.sprites[BACK_SURFACE]! };
}

describe("police en planche de sprites", () => {
  it("imprime une lettre ordinaire depuis sa cellule", () => {
    const { draw, back } = setup(2);
    draw.printText({ x: 0, y: 0, backColor: 0, frontColor: 0, fontIndex: 3, text: "B", transparent: false });
    expect(back.pixels[0]).toBe(2);
  });

  it("lit les caractères accentués (CP850, > 0x7f) comme octets non signés : « è » (0x8a) = cellule 73", () => {
    const { draw, back } = setup(10);
    draw.printText({ x: 0, y: 0, backColor: 0, frontColor: 0, fontIndex: 3, text: "\x8a", transparent: false });
    expect(back.pixels[0]).toBe(74);
  });
});
