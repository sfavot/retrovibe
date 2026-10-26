import { describe, expect, it } from "vitest";
import { fitScale } from "../../src/ui/game-shell";
import { toLogical } from "../../src/ui/pointer";

// Tampon 320×400 (pixels non carrés) affiché dans un cadre 4:3 : l'échelle suit le cadre logique 320×240, le pointeur le tampon.
describe("tampon différent du cadre logique", () => {
  it("l'échelle se calcule sur le cadre 320×240, pas sur la hauteur du tampon", () => {
    expect(fitScale(1000, 800, 320, 240)).toBe(3);
    expect(fitScale(1000, 800, 320, 400)).toBe(2);
  });

  it("le pointeur sur le canvas affiché en 4:3 retombe sur les lignes du tampon", () => {
    const rect = { left: 10, top: 20, width: 960, height: 720 };
    const size = { width: 320, height: 400 };
    expect(toLogical(10 + 480, 20 + 360, rect, size)).toEqual({ x: 160, y: 200 });
    expect(toLogical(10 + 960, 20 + 720, rect, size)).toEqual({ x: 320, y: 400 });
  });

  it("plein écran pivoté : le rectangle englobant est échangé, le tampon reste cartographié de bout en bout", () => {
    const rect = { left: 0, top: 0, width: 720, height: 960 };
    const size = { width: 320, height: 400 };
    expect(toLogical(720, 0, rect, size, true)).toEqual({ x: 0, y: 0 });
    expect(toLogical(0, 960, rect, size, true)).toEqual({ x: 320, y: 400 });
  });
});
