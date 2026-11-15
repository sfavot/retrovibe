import { describe, expect, it } from "vitest";
import { readBitmaps } from "../../src/engine/desktop-adventures/data/resources";
import { BUBBLE_BUTTONS, BUBBLE_STATES, bubbleBitmapId, bubbleVariable } from "../../src/ui/desktop-adventures/bubble-buttons";
import { hasOriginalFiles, loadExe } from "./helpers";

describe("boutons de la bulle de dialogue", () => {
  it("nomme les BITMAP de l'exécutable : bouton + état", () => {
    // ▲ s'appelle « DNA » dans l'exécutable, ▼ « UPA ».
    expect(bubbleBitmapId("up", "rest")).toBe("DNAU");
    expect(bubbleBitmapId("up", "pressed")).toBe("DNAD");
    expect(bubbleBitmapId("down", "disabled")).toBe("UPAX");
    expect(bubbleBitmapId("close", "focus")).toBe("CLOSEF");
    expect(bubbleVariable("down", "pressed")).toBe("--bubble-down-pressed");
  });
});

describe.skipIf(!hasOriginalFiles)("BITMAP de DESKADV.EXE", () => {
  const bitmaps = readBitmaps(loadExe());

  it("lit les 12 images des boutons en 16×16 opaque", () => {
    for (const prefix of Object.values(BUBBLE_BUTTONS)) {
      for (const suffix of Object.values(BUBBLE_STATES)) {
        const bitmap = bitmaps.get(`${prefix}${suffix}`)!;
        expect([bitmap.width, bitmap.height]).toEqual([16, 16]);
        expect(bitmap.rgba.length).toBe(16 * 16 * 4);
        expect(bitmap.rgba.filter((_, i) => i % 4 === 3).every((a) => a === 255)).toBe(true);
      }
    }
  });

  const pixel = (id: string, x: number, y: number) => [...bitmaps.get(id)!.rgba.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 3)];

  it("le bouton relâché est biseauté (blanc en haut à gauche, gris foncé en bas à droite), l'enfoncé l'inverse", () => {
    expect(pixel("DNAU", 1, 1)).toEqual([255, 255, 255]);
    expect(pixel("DNAU", 14, 14)).toEqual([128, 128, 128]);
    expect(pixel("DNAD", 1, 1)).toEqual([128, 128, 128]);
    expect(pixel("DNAD", 14, 14)).toEqual([255, 255, 255]);
    expect(pixel("DNAU", 0, 0)).toEqual([0, 0, 0]);
  });

  it("▲ pointe en haut et ▼ en bas ; la désactivée est grise", () => {
    expect(pixel("DNAU", 7, 4)).toEqual([0, 0, 0]); // pointe de ▲
    expect(pixel("DNAU", 3, 4)).toEqual([192, 192, 192]);
    expect(pixel("DNAX", 7, 4)).toEqual([128, 128, 128]);
    expect(pixel("UPAU", 7, 11)).toEqual([0, 0, 0]); // pointe de ▼
  });
});
