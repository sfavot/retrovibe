import { describe, expect, it } from "vitest";
import { type KeyLike, keyDown, keyUp } from "../../../src/games/voyageurs/ui/keys";

const key = (k: string, extra: Partial<KeyLike> = {}): KeyLike => ({ key: k, code: k, ctrlKey: false, metaKey: false, altKey: false, ...extra });

describe("keyDown / keyUp", () => {
  it("F1 à F6 : les six verbes", () => {
    const verbs = ["F1", "F2", "F3", "F4", "F5", "F6"].map((k) => keyDown(key(k)));
    expect(verbs).toEqual(["examine", "take", "inventory", "use", "activate", "speak"].map((action) => ({ type: "action", action })));
  });

  it("F9 : menu des verbes ; F10 : menu système", () => {
    expect(keyDown(key("F9"))).toEqual({ type: "action", action: "actionMenu" });
    expect(keyDown(key("F10"))).toEqual({ type: "action", action: "systemMenu" });
  });

  it("Entrée = clic gauche, Échap = clic droit, tenus tant que la touche l'est", () => {
    expect(keyDown(key("Enter"))).toEqual({ type: "button", button: "left", down: true });
    expect(keyUp(key("Enter"))).toEqual({ type: "button", button: "left", down: false });
    expect(keyDown(key("Escape"))).toEqual({ type: "button", button: "right", down: true });
    expect(keyUp(key("Escape"))).toEqual({ type: "button", button: "right", down: false });
  });

  it("flèches haut et bas : ligne précédente / suivante du menu (MENUUP / MENUDOWN) ; gauche et droite sans effet", () => {
    expect(keyDown(key("ArrowUp"))).toEqual({ type: "action", action: "menuUp" });
    expect(keyDown(key("ArrowDown"))).toEqual({ type: "action", action: "menuDown" });
    expect(keyDown(key("ArrowLeft"))).toBeNull();
    expect(keyDown(key("ArrowRight"))).toBeNull();
    expect(keyUp(key("ArrowUp"))).toBeNull();
  });

  it("pavé numérique 1 à 4, 6 à 9 : marche au clavier tenue (dy > 0 = haut), arrêtée au relâchement ; 5 = clic gauche", () => {
    const pad = (n: number, extra: Partial<KeyLike> = {}) => key(String(n), { code: `Numpad${n}`, ...extra });
    const dirs = [1, 2, 3, 4, 6, 7, 8, 9].map((n) => keyDown(pad(n)));
    expect(dirs).toEqual(
      [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]].map(([dx, dy]) => ({ type: "walk", dx, dy })),
    );
    // Verrouillage numérique éteint : la touche 8 du pavé arrive comme une flèche, mais reste une touche de marche.
    expect(keyDown(pad(8, { key: "ArrowUp" }))).toEqual({ type: "walk", dx: 0, dy: 1 });
    expect(keyUp(pad(4))).toEqual({ type: "walk", dx: 0, dy: 0 });
    expect(keyDown(pad(5))).toEqual({ type: "button", button: "left", down: true });
  });

  it("laisse au navigateur Ctrl / Cmd + touche, Alt + lettre, F11, F12, Tab", () => {
    expect(keyDown(key("F5", { ctrlKey: true }))).toBeNull();
    expect(keyDown(key("r", { metaKey: true }))).toBeNull();
    expect(keyDown(key("d", { altKey: true }))).toBeNull();
    for (const k of ["F11", "F12", "Tab", "a"]) expect(keyDown(key(k))).toBeNull();
  });
});
