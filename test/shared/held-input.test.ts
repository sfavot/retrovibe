import { describe, expect, it } from "vitest";
import { HeldInput, type PadLike } from "../../src/ui/held-input";

type A = "left" | "right" | "fire";

const make = () =>
  new HeldInput<A>(
    { left: { keys: ["ArrowLeft", "KeyA"], buttons: [14] }, right: { keys: ["ArrowRight"], buttons: [15] }, fire: { keys: ["Space"], buttons: [0] } },
    [
      { axis: 0, dir: -1, action: "left" },
      { axis: 0, dir: 1, action: "right", threshold: 0.3 },
    ],
  );

const pad = (pressed: number[] = [], axes: number[] = [0, 0]): PadLike => ({
  connected: true,
  mapping: "standard",
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
  axes,
});

describe("HeldInput", () => {
  it("suit les touches liées et signale si la touche est gérée", () => {
    const h = make();
    expect(h.keyDown("KeyA")).toBe(true);
    expect(h.isHeld("left")).toBe(true);
    expect(h.keyDown("KeyP")).toBe(false);
    expect(h.keyUp("KeyA")).toBe(true);
    expect(h.isHeld("left")).toBe(false);
    expect(h.keyUp("KeyP")).toBe(false);
  });

  it("garde un appui bref entre deux ticks jusqu'à endTick", () => {
    const h = make();
    h.keyDown("Space");
    h.keyUp("Space");
    expect(h.isHeld("fire")).toBe(false);
    expect(h.wasTapped("fire")).toBe(true);
    h.endTick();
    expect(h.wasTapped("fire")).toBe(false);
  });

  it("clear relâche tout et oublie les appuis", () => {
    const h = make();
    h.keyDown("ArrowLeft");
    h.press("fire");
    h.clear();
    expect(h.isHeld("left")).toBe(false);
    expect(h.isHeld("fire")).toBe(false);
    expect(h.wasTapped("left")).toBe(false);
  });

  it("press / release programmatiques (tactile)", () => {
    const h = make();
    h.press("right");
    expect(h.isHeld("right")).toBe(true);
    h.release("right");
    expect(h.isHeld("right")).toBe(false);
    expect(h.wasTapped("right")).toBe(true);
  });

  it("lit les boutons de manette, avec relâchement et appui à l'arrivée", () => {
    const h = make();
    let p: PadLike | null = pad([0]);
    h.pollGamepads(() => [null, p]);
    expect(h.isHeld("fire")).toBe(true);
    expect(h.wasTapped("fire")).toBe(true);
    h.endTick();
    h.pollGamepads(() => [p]);
    expect(h.isHeld("fire")).toBe(true);
    expect(h.wasTapped("fire")).toBe(false);
    p = pad();
    h.pollGamepads(() => [p]);
    expect(h.isHeld("fire")).toBe(false);
    p = null;
    h.pollGamepads(() => [p]);
    expect(h.isHeld("fire")).toBe(false);
  });

  it("lit les axes avec seuil par défaut et personnalisé", () => {
    const h = make();
    h.pollGamepads(() => [pad([], [-0.4, 0])]);
    expect(h.isHeld("left")).toBe(false);
    h.pollGamepads(() => [pad([], [-0.8, 0])]);
    expect(h.isHeld("left")).toBe(true);
    h.pollGamepads(() => [pad([], [0.4, 0])]);
    expect(h.isHeld("left")).toBe(false);
    expect(h.isHeld("right")).toBe(true);
  });

  it("ignore les manettes déconnectées ou non standard", () => {
    const h = make();
    h.pollGamepads(() => [{ ...pad([0]), connected: false }, { ...pad([0]), mapping: "other" }]);
    expect(h.isHeld("fire")).toBe(false);
  });

  it("garde clavier et manette indépendants", () => {
    const h = make();
    h.keyDown("ArrowLeft");
    h.pollGamepads(() => [pad([14])]);
    h.keyUp("ArrowLeft");
    expect(h.isHeld("left")).toBe(true);
    h.keyDown("ArrowLeft");
    h.pollGamepads(() => [pad()]);
    expect(h.isHeld("left")).toBe(true);
    h.keyUp("ArrowLeft");
    expect(h.isHeld("left")).toBe(false);
  });
});
