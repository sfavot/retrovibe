import { describe, expect, it } from "vitest";
import {
  PLAY_ORIGIN_X,
  PLAY_ORIGIN_Y,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
} from "../../src/games/mathemagique/render/canvas-presenter";
import { fitScale } from "../../src/games/mathemagique/ui/app";
import {
  gameOwnsKey,
  toPlayArea,
} from "../../src/games/mathemagique/ui/browser-host";

describe("toPlayArea (doigt ou souris -> zone de jeu)", () => {
  it("convertit à l'échelle 1 avec la bordure du canvas", () => {
    const rect = {
      left: 10,
      top: 20,
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT,
    };
    expect(
      toPlayArea(10 + PLAY_ORIGIN_X + 5, 20 + PLAY_ORIGIN_Y + 7, rect),
    ).toEqual({ x: 5, y: 7 });
  });

  it("tient compte de la réduction sur petit écran", () => {
    const rect = {
      left: 0,
      top: 0,
      width: SCREEN_WIDTH / 2,
      height: SCREEN_HEIGHT / 2,
    };
    const { x, y } = toPlayArea(SCREEN_WIDTH / 4, SCREEN_HEIGHT / 4, rect);
    expect(x).toBeCloseTo(SCREEN_WIDTH / 2 - PLAY_ORIGIN_X);
    expect(y).toBeCloseTo(SCREEN_HEIGHT / 2 - PLAY_ORIGIN_Y);
  });

  it("sort de la zone sans être borné", () => {
    const { x, y } = toPlayArea(-10, -10, {
      left: 0,
      top: 0,
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT,
    });
    expect(x).toBeLessThan(0);
    expect(y).toBeLessThan(0);
  });
});

describe("fitScale (échelle du canvas)", () => {
  it("fractionnaire aussi au-dessus de 1, pour remplir la fenêtre", () => {
    expect(fitScale(1300, 1000)).toBeCloseTo(2.03, 2);
    expect(fitScale(1280, 720)).toBeCloseTo(1.5);
  });

  it("fractionnaire sur un écran plus étroit que 640 px (portrait) ou plus bas que 480 px (paysage)", () => {
    expect(fitScale(320, 1000)).toBeCloseTo(0.5);
    expect(fitScale(1000, 240)).toBeCloseTo(0.5);
  });

  it("ne tombe jamais à zéro", () => {
    expect(fitScale(0, 0)).toBeGreaterThan(0);
  });
});

describe("gameOwnsKey", () => {
  const key = (
    init: Partial<
      Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey">
    >,
  ) => ({
    key: "",
    code: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...init,
  });

  it("garde Espace, chiffres et Ctrl+Q", () => {
    expect(gameOwnsKey(key({ key: " ", code: "Space" }))).toBe(true);
    expect(gameOwnsKey(key({ key: "1", code: "Digit1" }))).toBe(true);
    expect(gameOwnsKey(key({ key: "q", code: "KeyQ", ctrlKey: true }))).toBe(
      true,
    );
  });

  it("garde Tab et Maj+Tab (focus des gadgets), mais pas Ctrl+Tab", () => {
    expect(gameOwnsKey(key({ key: "Tab", code: "Tab" }))).toBe(true);
    expect(gameOwnsKey(key({ key: "Tab", code: "Tab", ctrlKey: true }))).toBe(false);
  });

  it("laisse Ctrl+R et Cmd au navigateur", () => {
    expect(gameOwnsKey(key({ key: "r", code: "KeyR", ctrlKey: true }))).toBe(
      false,
    );
    expect(gameOwnsKey(key({ key: "q", code: "KeyQ", metaKey: true }))).toBe(
      false,
    );
  });
});
