import { describe, expect, it } from "vitest";
import { UiInputCollector } from "../../../src/games/swiv3d/ui/ui-input";

const key = (code: string, k = code) => ({ code, key: k });

function pad(buttons: number[] = [], axes: number[] = [0, 0, 0, 0]) {
  const down = new Set(buttons);
  return { connected: true, mapping: "standard", buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.has(i) })), axes };
}

describe("entrées des menus", () => {
  it("traduit les touches de navigation, Entrée, Échap et Retour arrière", () => {
    const c = new UiInputCollector();
    for (const code of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "NumpadEnter", "Escape", "F1", "Backspace"]) expect(c.keyDown(key(code))).toBe(true);
    const input = c.take();
    expect(input.keys).toEqual(["up", "down", "left", "right", "enter", "enter", "escape", "escape", "backspace"]);
    expect(input.pressed).toBe(true);
    expect(c.take()).toEqual({ keys: [], chars: [], taps: [], pressed: false });
  });

  it("garde la répétition automatique (une entrée par événement)", () => {
    const c = new UiInputCollector();
    c.keyDown(key("ArrowDown"));
    c.keyDown(key("ArrowDown"));
    expect(c.take().keys).toEqual(["down", "down"]);
  });

  it("recueille les caractères du nom (espace compris) mais pas les raccourcis du navigateur", () => {
    const c = new UiInputCollector();
    expect(c.keyDown(key("KeyA", "a"))).toBe(true);
    expect(c.keyDown(key("Space", " "))).toBe(true);
    expect(c.keyDown({ ...key("KeyC", "c"), ctrlKey: true })).toBe(false);
    expect(c.keyDown({ ...key("KeyR", "r"), metaKey: true })).toBe(false);
    expect(c.keyDown(key("F5"))).toBe(false);
    expect(c.take().chars).toEqual(["a", " "]);
  });

  it("une touche de modification seule n'est pas « une touche pressée »", () => {
    const c = new UiInputCollector();
    expect(c.keyDown(key("ShiftLeft", "Shift"))).toBe(false);
    expect(c.take().pressed).toBe(false);
  });

  it("garde les appuis de souris et de doigt", () => {
    const c = new UiInputCollector();
    c.tap(12, 34);
    expect(c.take()).toEqual({ keys: [], chars: [], taps: [{ x: 12, y: 34 }], pressed: true });
  });

  it("manette : croix et stick naviguent, A / Start valident, B annule, une fois par appui", () => {
    const c = new UiInputCollector();
    c.pollGamepad(() => [pad([13])]);
    c.pollGamepad(() => [pad([13])]); // maintenu : pas de nouvel appui
    c.pollGamepad(() => [pad()]);
    c.pollGamepad(() => [pad([0])]);
    c.pollGamepad(() => [pad([], [0, -0.9, 0, 0])]);
    c.pollGamepad(() => [pad([1])]);
    expect(c.take().keys).toEqual(["down", "enter", "up", "escape"]);
  });
});
