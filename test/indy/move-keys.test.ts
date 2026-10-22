import { describe, expect, it } from "vitest";
import { MoveKeys } from "../../src/games/indy/ui/move-keys";

describe("MoveKeys", () => {
  it("combine deux touches maintenues en diagonale (flèches, ZQSD)", () => {
    const keys = new MoveKeys();
    keys.press("ArrowUp");
    keys.press("ArrowRight");
    expect(keys.direction()).toEqual({ x: 1, y: -1 });
    expect(keys.direction()).toEqual({ x: 1, y: -1 });
    keys.release("ArrowUp");
    expect(keys.direction()).toEqual({ x: 1, y: 0 });
    keys.release("ArrowRight");
    keys.press("KeyW");
    keys.press("KeyA");
    expect(keys.direction()).toEqual({ x: -1, y: -1 });
  });

  it("compte un appui bref pour un pas, sans écraser une touche maintenue", () => {
    const keys = new MoveKeys();
    keys.press("ArrowUp");
    keys.direction();
    keys.press("ArrowLeft");
    keys.release("ArrowLeft");
    expect(keys.direction()).toEqual({ x: -1, y: -1 });
    expect(keys.direction()).toEqual({ x: 0, y: -1 });
  });

  it("annule les directions opposées et ignore les autres touches", () => {
    const keys = new MoveKeys();
    keys.press("ArrowLeft");
    keys.press("ArrowRight");
    keys.press("KeyP");
    expect(keys.direction()).toEqual({ x: 0, y: 0 });
    keys.clear();
    expect(keys.direction()).toEqual({ x: 0, y: 0 });
  });
});
