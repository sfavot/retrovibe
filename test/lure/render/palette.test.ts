import { describe, expect, it } from "vitest";
import { emptyPalette, fadeInStep, fadeOutStep, roomPalette } from "../../../src/games/lure/render/palette";
import { hasOriginalFiles } from "../data/helpers";
import { lureData } from "../data/catalog-helper";

describe("fondus", () => {
  it("le fondu sortant retire 4 à chaque composante des 255 premières entrées, jusqu'à zéro, et laisse l'entrée 255", () => {
    const rgb = new Uint8Array(768).fill(10);
    rgb[3] = 3;
    expect(fadeOutStep(rgb)).toBe(true);
    expect([rgb[0], rgb[3], rgb[765]]).toEqual([6, 0, 10]);
    let steps = 1;
    while (fadeOutStep(rgb)) steps++;
    expect(steps).toBe(3);
    expect(rgb.subarray(0, 765).every((v) => v === 0)).toBe(true);
    expect(rgb[765]).toBe(10);
  });

  it("le fondu entrant monte de 4, finit à la cible (un écart < 4 est comblé) et ne baisse jamais une composante", () => {
    const target = new Uint8Array(768);
    target.set([10, 6, 255]);
    const rgb = new Uint8Array(768);
    rgb[6 * 0 + 2] = 255;
    const seen: number[][] = [];
    while (fadeInStep(rgb, target)) seen.push([rgb[0]!, rgb[1]!]);
    expect(seen).toEqual([[4, 4], [8, 6], [10, 6]]);
    const above = new Uint8Array(768).fill(255);
    expect(fadeInStep(above, target)).toBe(false);
  });

  it("emptyPalette ne vide que les premières entrées (les 220 de la pièce, le reste est gardé)", () => {
    const rgb = new Uint8Array(768).fill(7);
    emptyPalette(rgb, 220);
    expect(rgb[220 * 3 - 1]).toBe(0);
    expect(rgb[220 * 3]).toBe(7);
  });
});

describe.skipIf(!hasOriginalFiles)("palette d'une pièce", () => {
  it("palette du jeu recouverte par celle du fond, puis par la sous-palette (60 couleurs en 129, 8 en 220) : 256 entrées", () => {
    const data = lureData();
    const room = data.rooms.find((r) => r.roomNumber === 1)!;
    const pal = roomPalette(data, room.layers[0]!);
    expect(pal.length).toBe(768);
    // entrée 129 : première couleur de la sous-palette 0x3F02 ; entrée 255 : celle du jeu
    expect([...pal.subarray(129 * 3, 129 * 3 + 3)]).toEqual([...data.altPalette.rgb.subarray(0, 3)]);
    expect([...pal.subarray(220 * 3, 220 * 3 + 3)]).toEqual([...data.altPalette.rgb.subarray(60 * 3, 60 * 3 + 3)]);
    expect([...pal.subarray(255 * 3, 255 * 3 + 3)]).toEqual([...data.gamePalette.rgb.subarray(255 * 3, 255 * 3 + 3)]);
  });
});
