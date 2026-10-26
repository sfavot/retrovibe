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
    // Codes de balayage de l'original (capture d'une touche) : flèches étendues, Entrée, Entrée du pavé, Échap, F1, Retour arrière.
    expect(input.scans).toEqual([0xc8, 0xd0, 0xcb, 0xcd, 0x1c, 0x9c, 0x01, 0x3b, 0x0e]);
    expect(c.take()).toEqual({ keys: [], typed: [], taps: [], pressed: false, scans: [] });
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
    expect(c.take().typed).toEqual([{ char: "a" }, { char: " " }]);
  });

  it("la saisie garde l'ordre de frappe des caractères et des touches", () => {
    const c = new UiInputCollector();
    c.keyDown(key("KeyA", "a"));
    c.keyDown(key("Backspace"));
    c.keyDown(key("KeyB", "b"));
    c.keyDown(key("Enter"));
    const input = c.take();
    expect(input.typed).toEqual([{ char: "a" }, "backspace", { char: "b" }, "enter"]);
    expect(input.keys).toEqual(["backspace", "enter"]);
  });

  it("une touche de modification seule n'est pas « une touche pressée »", () => {
    const c = new UiInputCollector();
    expect(c.keyDown(key("ShiftLeft", "Shift"))).toBe(false);
    expect(c.take().pressed).toBe(false);
  });

  it("garde les appuis de souris et de doigt", () => {
    const c = new UiInputCollector();
    c.tap(12, 34);
    expect(c.take()).toEqual({ keys: [], typed: [], taps: [{ x: 12, y: 34 }], pressed: true, scans: [0x90] });
    c.tap(1, 2, 2); // bouton droit : « Souris 2 »
    expect(c.take().scans).toEqual([0x91]);
  });

  it("codes à lier : la répétition automatique n'en donne pas, les modificateurs oui (pris seulement pendant la capture)", () => {
    const c = new UiInputCollector();
    c.keyDown({ ...key("KeyQ", "a"), repeat: true });
    expect(c.keyDown(key("ControlLeft", "Control"))).toBe(false);
    c.capturing = true;
    expect(c.keyDown(key("ShiftRight", "Shift"))).toBe(true);
    expect(c.take().scans).toEqual([0x1d, 0x36]);
  });

  it("manette : boutons 1 à 8 donnent les codes 0x93 à 0x9a au front montant", () => {
    const c = new UiInputCollector();
    c.pollGamepad(() => [pad([2])]);
    c.pollGamepad(() => [pad([2, 7])]);
    expect(c.take().scans).toEqual([0x95, 0x9a]);
    expect(UiInputCollector.gamepadConnected(() => [pad()])).toBe(true);
    expect(UiInputCollector.gamepadConnected(() => [])).toBe(false);
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
