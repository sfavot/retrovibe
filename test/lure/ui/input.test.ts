import { describe, expect, it } from "vitest";
import { InputQueue, TAP_DELAY_TICKS } from "../../../src/games/lure/ui/input";

describe("InputQueue", () => {
  it("le pointeur est un état en 320 x 200 : bouton gauche = 1, droit = 2", () => {
    const queue = new InputQueue();
    queue.move(10.4, 20.6);
    queue.down(2, 10, 21);
    queue.up(2, 10, 21);
    // L'appui attend une image après le saut de position (`TAP_DELAY_TICKS`).
    const events = Array.from({ length: TAP_DELAY_TICKS + 2 }, () => queue.drain()).flat();
    expect(events).toEqual([
      { type: "pointer", x: 10, y: 21, buttons: 0 },
      { type: "pointer", x: 10, y: 21, buttons: 2 },
      { type: "pointer", x: 10, y: 21, buttons: 0 },
    ]);
    queue.move(999, -5);
    expect(queue.drain()).toEqual([{ type: "pointer", x: 319, y: 0, buttons: 0 }]);
  });

  it("un toucher : le curseur y va tout de suite, l'appui vient une image plus tard puis se relâche", () => {
    const queue = new InputQueue();
    queue.tap(0, 50, 60);
    const frames: unknown[][] = [];
    for (let i = 0; i < TAP_DELAY_TICKS + 3; i++) frames.push(queue.drain());
    expect(frames[0]).toEqual([{ type: "pointer", x: 50, y: 60, buttons: 0 }]);
    expect(frames.flat()).toContainEqual({ type: "pointer", x: 50, y: 60, buttons: 1 });
    expect(frames.flat().at(-1)).toEqual({ type: "pointer", x: 50, y: 60, buttons: 0 });
    // Appui long : bouton droit.
    queue.tap(2, 5, 6);
    const rest = Array.from({ length: TAP_DELAY_TICKS + 3 }, () => queue.drain()).flat();
    expect(rest).toContainEqual({ type: "pointer", x: 5, y: 6, buttons: 2 });
  });

  it("actions, molette et fin d'appui, dans l'ordre", () => {
    const queue = new InputQueue();
    queue.action("escape");
    queue.wheel(-1);
    queue.wheel(1);
    queue.action("fightMoveLeft");
    queue.actionEnd("fightMoveLeft");
    expect(queue.drain()).toEqual([
      { type: "action", action: "escape" },
      { type: "wheel", delta: -1 },
      { type: "wheel", delta: 1 },
      { type: "action", action: "fightMoveLeft" },
      { type: "actionEnd", action: "fightMoveLeft" },
    ]);
  });

  it("le relâchement d'une touche qui n'est pas de combat, ou qui n'est pas tenue, ne donne rien", () => {
    const queue = new InputQueue();
    queue.action("escape");
    queue.actionEnd("escape");
    queue.actionEnd("fightMoveRight");
    expect(queue.drain()).toEqual([{ type: "action", action: "escape" }]);
  });

  it("releaseAll (perte du focus, pause) relâche aussi les touches de combat tenues, une seule fois", () => {
    const queue = new InputQueue();
    queue.action("fightMoveLeft");
    queue.action("fightCursorRightTop");
    queue.down(0, 5, 5);
    queue.drain();
    queue.releaseAll();
    const out = queue.drain();
    expect(out).toContainEqual({ type: "actionEnd", action: "fightMoveLeft" });
    expect(out).toContainEqual({ type: "actionEnd", action: "fightCursorRightTop" });
    expect(out).toContainEqual({ type: "pointer", x: 5, y: 5, buttons: 0 });
    queue.releaseAll();
    expect(queue.drain()).toEqual([]);
  });
});
