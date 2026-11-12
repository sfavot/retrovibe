import { describe, expect, it } from "vitest";
import { RoomLayers } from "../../../src/games/lure/render/layers";
import { LureRenderer } from "../../../src/games/lure/render/renderer";
import { hasOriginalFiles, makeEngine } from "../engine/test-host";

describe.skipIf(!hasOriginalFiles)("les pièces se composent", () => {
  it("les 45 pièces : calques, palette et image sans erreur, avec fondu entre deux pièces", () => {
    const { engine, data } = makeEngine();
    const renderer = new LureRenderer(data, { cursor: false });
    engine.tick();
    renderer.render(engine, 80);
    expect(data.rooms).toHaveLength(45);
    let fades = 0;
    for (const room of data.rooms) {
      engine.room.setRoomNumber(room.roomNumber);
      engine.tick();
      renderer.render(engine, 0);
      if (renderer.fading) fades++;
      for (let i = 0; i < 6 && renderer.fading; i++) renderer.render(engine, 5000);
      renderer.render(engine, 0);
      expect(renderer.fading, `pièce ${room.roomNumber}`).toBe(false);
      let lit = 0;
      for (const v of renderer.output) if (v !== 0) lit++;
      expect(lit, `pièce ${room.roomNumber}`).toBeGreaterThan(2000);
      expect(renderer.palette.some((v) => v !== 0)).toBe(true);
      // la pièce est bien celle demandée : son fond est le premier calque
      expect(engine.room.layers[0]).toBe(room.layers[0]);
    }
    expect(fades).toBeGreaterThanOrEqual(40);
  });

  it("calques d'une pièce : cellules du fond toutes occupées, les calques d'avant-plan marquent leurs voisines", () => {
    const { data } = makeEngine();
    for (const room of data.rooms) {
      const layers = new RoomLayers(data, room.layers.slice(0, room.numLayers));
      expect(layers.layers.length).toBe(room.numLayers);
      for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) expect(layers.background.isOccupied(x + 4, y + 4)).toBe(true);
    }
    // pièce 10 (village) : la grande arche d'avant-plan occupe des cellules du calque 1
    const village = data.rooms.find((r) => r.roomNumber === 10)!;
    const layers = new RoomLayers(data, village.layers.slice(0, village.numLayers));
    expect(village.numLayers).toBeGreaterThan(1);
    let occupied = 0;
    for (let y = 4; y < 10; y++) for (let x = 4; x < 14; x++) if (layers.layers[1]!.isOccupied(x, y)) occupied++;
    expect(occupied).toBeGreaterThan(0);
    expect(occupied).toBeLessThan(60);
  });

  it("le fondu d'un changement de pièce éteint l'ancienne image puis allume la nouvelle, le moteur étant à suspendre (`fading`)", () => {
    const { engine, data } = makeEngine();
    const renderer = new LureRenderer(data, { cursor: false });
    engine.tick();
    renderer.render(engine, 80);
    const lit = (): number => renderer.palette.reduce((a, v) => a + v, 0);
    const before = lit();
    expect(renderer.fading).toBe(false);
    engine.room.setRoomNumber(10);
    engine.tick();
    renderer.render(engine, 0);
    expect(renderer.fading).toBe(true);
    let minimum = Infinity;
    let phases = 0;
    while (renderer.fading && phases++ < 200) {
      renderer.render(engine, 20);
      minimum = Math.min(minimum, lit());
    }
    expect(minimum).toBeLessThan(before / 8);
    expect(lit()).toBeGreaterThan(before / 2);
    expect(phases).toBeLessThan(200);
  });
});
