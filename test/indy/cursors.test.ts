import { describe, expect, it } from "vitest";
import { readCursors } from "../../src/games/indy/data/resources";
import { arrowCursorId, stepToward } from "../../src/games/indy/ui/walk-cursor";
import { hasOriginalFiles, loadExe } from "./helpers";

describe.skipIf(!hasOriginalFiles)("curseurs de DESKADV.EXE", () => {
  const cursors = readCursors(loadExe());

  it("lit les 21 curseurs 32×32 (ids 11 à 31)", () => {
    expect([...cursors.keys()]).toEqual(Array.from({ length: 21 }, (_, i) => 11 + i));
    for (const c of cursors.values()) {
      expect([c.width, c.height]).toEqual([32, 32]);
      expect(c.rgba.length).toBe(32 * 32 * 4);
    }
  });

  it("les 8 flèches ont leur point chaud au centre", () => {
    for (let id = 11; id <= 18; id++) expect([cursors.get(id)!.hotspotX, cursors.get(id)!.hotspotY]).toEqual([15, 15]);
  });

  const opaque = (id: number, x: number, y: number) => cursors.get(id)!.rgba[(y * 32 + x) * 4 + 3] === 0xff;

  it("décode les masques : flèche gauche pointe à gauche, flèche haut pointe en haut", () => {
    expect(opaque(11, 0, 15)).toBe(true); // pointe de ←
    expect(opaque(11, 31, 15)).toBe(false);
    expect(opaque(13, 15, 0)).toBe(true); // pointe de ↑
    expect(opaque(13, 15, 31)).toBe(false);
    expect(opaque(11, 0, 0)).toBe(false); // coin transparent
  });
});

describe("direction du curseur", () => {
  const hero = { x: 10, y: 10 };

  it("suit le signe de l'écart avec le héros", () => {
    expect(stepToward(hero, { x: 14, y: 10 })).toEqual({ x: 1, y: 0 });
    expect(stepToward(hero, { x: 3, y: 12 })).toEqual({ x: -1, y: 1 });
    expect(stepToward(hero, hero)).toEqual({ x: 0, y: 0 });
  });

  it("associe les 8 directions aux ids 11 à 18 (←, →, ↑, ↓, ↖, ↗, ↙, ↘) et rien sur place", () => {
    const steps = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    expect(steps.map(([x, y]) => arrowCursorId({ x, y }))).toEqual([11, 12, 13, 14, 15, 16, 17, 18]);
    expect(arrowCursorId({ x: 0, y: 0 })).toBeNull();
  });
});
