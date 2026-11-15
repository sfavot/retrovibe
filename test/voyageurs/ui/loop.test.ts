import { describe, expect, it } from "vitest";
import { CURSORS, CURSOR_SIZE, CursorKind } from "../../../src/games/voyageurs/render/cursor";
import { SCREEN_SIZE, SCREEN_WIDTH } from "../../../src/games/voyageurs/render/draw";
import { drawCursor } from "../../../src/games/voyageurs/ui/loop";

describe("drawCursor", () => {
  it("place le point chaud sur la position donnée (indices 16 et 17 de la palette présentée)", () => {
    const cursor = CURSORS[CursorKind.Cross]!;
    const page = new Uint8Array(SCREEN_SIZE);
    drawCursor(page, cursor, 100, 100);
    // Le point chaud est au centre de la croix (7, 7) : la barre horizontale du dessin passe par la ligne 7, de x - 7 à x + 8.
    expect(page[(100 - cursor.hotspotY + 7) * SCREEN_WIDTH + 100 - cursor.hotspotX + 3]).toBeGreaterThanOrEqual(16);
    expect(new Set(page).has(17)).toBe(true);
    expect(new Set(page).has(16)).toBe(true);
  });

  it("se coupe au bord de l'écran sans déborder", () => {
    const page = new Uint8Array(SCREEN_SIZE);
    drawCursor(page, CURSORS[CursorKind.Normal]!, 319, 199);
    drawCursor(page, CURSORS[CursorKind.Normal]!, 0, 0);
    expect(page.length).toBe(SCREEN_SIZE);
    expect(CURSOR_SIZE).toBe(16);
  });
});
