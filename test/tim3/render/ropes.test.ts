import { describe, expect, it } from "vitest";
import { BeltData, RopeData } from "../../../src/games/tim3/engine/part";
import { BELT_COLOR, ROPE_COLOR, Surface, drawBelt, drawRope, mapColor, ropeLine, ropeSegment } from "../../../src/games/tim3/render";
import { FakeAssets, image, part } from "./support";

const at = (s: Surface, x: number, y: number) => s.pixels[y * s.width + x]!;

describe("ligne de corde (42d7a9)", () => {
  it("trace trois lignes de 1 pixel dans les teintes de la couleur, décalées en Y pour une ligne peu inclinée", () => {
    const s = new Surface(8, 5);
    ropeLine(s, 1, 2, 6, 2, ROPE_COLOR);
    // Corde 0x86 : côté −1 = teinte 6, centre = 0xe, côté +1 = 0xd (numéros logiques, +15).
    expect([at(s, 3, 1), at(s, 3, 2), at(s, 3, 3)]).toEqual([mapColor(6), mapColor(0xe), mapColor(0xd)]);
    expect([at(s, 0, 2), at(s, 7, 2), at(s, 3, 0), at(s, 3, 4)]).toEqual([0, 0, 0, 0]);
  });

  it("décale en X pour une ligne plus verticale qu'horizontale", () => {
    const s = new Surface(5, 8);
    ropeLine(s, 2, 1, 2, 6, BELT_COLOR);
    expect([at(s, 1, 3), at(s, 2, 3), at(s, 3, 3)]).toEqual([mapColor(7), mapColor(8), mapColor(5)]);
  });

  it("ne trace rien pour une couleur qui n'est pas une des cinq teintes", () => {
    const s = new Surface(4, 4);
    ropeLine(s, 0, 0, 3, 3, 0x20);
    expect(s.pixels.every((v) => v === 0)).toBe(true);
  });
});

describe("flèche (42d757)", () => {
  it("reste une ligne droite quand le mou ne dépasse pas 4", () => {
    const a = new Surface(20, 10);
    const b = new Surface(20, 10);
    ropeSegment(a, 2, 4, 17, 4, 4, ROPE_COLOR);
    ropeLine(b, 2, 4, 17, 4, ROPE_COLOR);
    expect(a.pixels).toEqual(b.pixels);
  });

  it("devient une courbe quadratique : extrémités fixes, point le plus bas au milieu, à la moitié du mou", () => {
    const s = new Surface(41, 30);
    ropeSegment(s, 0, 2, 40, 2, 16, ROPE_COLOR);
    const centre = mapColor(0xe);
    expect(at(s, 0, 2)).toBe(centre);
    expect(at(s, 40, 2)).toBe(centre);
    // Bézier : le sommet est à y = 2 + sag / 2 = 10.
    expect(at(s, 20, 10)).toBe(centre);
    expect(at(s, 20, 2)).toBe(0);
  });
});

describe("corde et courroie", () => {
  const assets = new FakeAssets({ frames: [image([[1]])] }, new Map());

  it("une courroie trace ses deux brins aux points du moteur", () => {
    const belt = part(8, 0, 0, 0, 0);
    const data = new BeltData(belt);
    data.end1 = part(14, 0, 0, 1, 1);
    data.end2 = part(14, 0, 0, 1, 1);
    data.pos.set([2, 1, 12, 1, 2, 6, 12, 6]);
    belt.belt = data;
    const s = new Surface(16, 8);
    drawBelt(s, belt, { x: 0, y: 0 });
    expect([at(s, 7, 1), at(s, 7, 6), at(s, 7, 3)]).toEqual([mapColor(8), mapColor(8), 0]);
  });

  it("une courbe de corde tendue (longueur égale à la distance) est droite", () => {
    const rope = part(10, 0, 0, 0, 0);
    rope.fFC = 10;
    const data = new RopeData(rope);
    data.end1 = part(0, 0, 0, 1, 1);
    data.end2 = part(0, 0, 0, 1, 1);
    data.ends.set([4, 4, 14, 4]);
    rope.ropes[0] = data;
    const s = new Surface(20, 10);
    drawRope(s, assets, rope, { x: 0, y: 0 });
    expect(at(s, 9, 4)).toBe(mapColor(0xe));
    expect(at(s, 9, 5)).toBe(mapColor(0xd));
  });
});
