import { describe, expect, it } from "vitest";
import { decodeAnimation } from "../../../src/games/lure/data/anim";
import type { HotspotAnimRecord } from "../../../src/games/lure/data/lure-dat";
import type { Hotspot } from "../../../src/games/lure/engine/hotspot";
import { buildSpriteSheet, drawHotspot, RACK_SERF_ID, sortLayer1 } from "../../../src/games/lure/render/sprites";
import { Surface } from "../../../src/games/lure/render/surface";
import { hasOriginalFiles } from "../data/helpers";
import { lureData } from "../data/catalog-helper";

const h = (y: number, heightCopy: number, id: number): Hotspot => ({ y, heightCopy, hotspotId: id }) as unknown as Hotspot;

describe("tri des sprites du calque 1", () => {
  it("par ordonnée du pied croissante ; à pied égal, le premier arrivé d'abord (insertion avant le premier plus bas)", () => {
    const sorted = sortLayer1([h(50, 30, 1), h(10, 30, 2), h(70, 10, 3), h(40, 40, 4), h(0, 100, 5)]);
    expect(sorted.map((x) => x.hotspotId)).toEqual([2, 1, 3, 4, 5]);
  });
});

/** Animation synthétique de 2 images de 4 x 2 pixels : quartets 1..8 puis 9..15, 0. */
function fakeAnim(): { anim: ReturnType<typeof decodeAnimation>; record: HotspotAnimRecord } {
  const anim = { numFrames: 2, frameSizes: [8, 8], nibbles: Uint8Array.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]) };
  return { anim, record: { flags: 0 } as HotspotAnimRecord };
}

describe("planche d'images", () => {
  it("ajoute le décalage de couleur à chaque quartet et remplit le reste avec lui ; il vaut transparent à l'affichage", () => {
    const { anim, record } = fakeAnim();
    const sheet = buildSpriteSheet(anim, record, { hotspotId: 5, width: 4, height: 2, colorOffset: 100 });
    expect(sheet.surface.width).toBe(8);
    expect([...sheet.surface.data.subarray(0, 8)]).toEqual([101, 102, 103, 104, 109, 110, 111, 112]);
    const screen = new Surface(320, 200);
    screen.data.fill(1);
    const hs = { x: 10, y: 20, frameWidth: 4, height: 2, frameNumber: 1, colorOffset: 111 } as unknown as Hotspot;
    drawHotspot(screen, sheet, hs);
    // image 1 : 109 110 111 112 ; 111 est la couleur transparente (colorOffset du hotspot à l'affichage)
    expect([...screen.data.subarray(20 * 320 + 10, 20 * 320 + 14)]).toEqual([109, 110, 1, 112]);
  });

  it("rogne un sprite qui dépasse du bord gauche ou de l'écran", () => {
    const { anim, record } = fakeAnim();
    const sheet = buildSpriteSheet(anim, record, { hotspotId: 5, width: 4, height: 2, colorOffset: 0 });
    const screen = new Surface(320, 200);
    drawHotspot(screen, sheet, { x: -2, y: 30, frameWidth: 4, height: 2, frameNumber: 0, colorOffset: 0 } as unknown as Hotspot);
    expect([...screen.data.subarray(30 * 320, 30 * 320 + 3)]).toEqual([3, 4, 0]);
    drawHotspot(screen, sheet, { x: 400, y: 30, frameWidth: 4, height: 2, frameNumber: 0, colorOffset: 0 } as unknown as Hotspot);
    drawHotspot(screen, sheet, { x: 0, y: 250, frameWidth: 4, height: 2, frameNumber: 0, colorOffset: 0 } as unknown as Hotspot);
  });
});

describe.skipIf(!hasOriginalFiles)("Serf du chevalet (images de largeurs variables)", () => {
  it("planche de 416 x 27 ; le début de chaque image suit les largeurs 80, 80, 80, 48, 48, 32, 32, 16", () => {
    const data = lureData();
    const record = data.hotspots.find((r) => r.hotspotId === RACK_SERF_ID)!;
    const anim = data.anims.find((a) => a.animRecordId === record.animRecordId)!;
    const sheet = buildSpriteSheet(decodeAnimation(data.resources.get(anim.animId)), anim, {
      hotspotId: RACK_SERF_ID,
      width: record.width,
      height: record.height,
      colorOffset: record.colorOffset,
    });
    expect([sheet.surface.width, sheet.surface.height]).toEqual([416, 27]);
    expect(record.width).toBe(80);
    expect(sheet.numFrames).toBe(8);
    expect(sheet.frameStarts).toEqual([0, 80, 160, 240, 288, 336, 368, 400]);
  });
});
