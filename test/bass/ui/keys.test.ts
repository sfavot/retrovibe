import { describe, expect, it } from "vitest";
import { type KeyLike, keyAction } from "../../../src/games/bass/ui/keys";

const key = (name: string, extra: Partial<KeyLike> = {}): KeyLike => ({ key: name, ctrlKey: false, metaKey: false, altKey: false, ...extra });

describe("keyAction", () => {
  it("les touches du jeu : F5 panneau, Échap, point, P (casse indifférente)", () => {
    expect(keyAction(key("F5"))).toEqual({ type: "engine", action: "panel" });
    expect(keyAction(key("Escape"))).toEqual({ type: "engine", action: "skip" });
    expect(keyAction(key("."))).toEqual({ type: "engine", action: "skipLine" });
    expect(keyAction(key("p"))).toEqual({ type: "engine", action: "pause" });
    expect(keyAction(key("P"))).toEqual({ type: "engine", action: "pause" });
  });

  it("F1 ouvre le menu du site, F10 le volume", () => {
    expect(keyAction(key("F1"))).toEqual({ type: "host", command: "menu" });
    expect(keyAction(key("F10"))).toEqual({ type: "host", command: "volume" });
  });

  it("toute autre touche est transmise comme `key` (elle reprend le jeu en pause)", () => {
    expect(keyAction(key(" "))).toEqual({ type: "engine", action: "key" });
    expect(keyAction(key("a"))).toEqual({ type: "engine", action: "key" });
    expect(keyAction(key("ArrowLeft"))).toEqual({ type: "engine", action: "key" });
  });

  it("le navigateur garde Ctrl / Cmd + touche, Alt + lettre, Tab, F11, F12 et les modificateurs seuls", () => {
    expect(keyAction(key("r", { ctrlKey: true }))).toBeNull();
    expect(keyAction(key("F5", { ctrlKey: true }))).toBeNull();
    expect(keyAction(key("p", { metaKey: true }))).toBeNull();
    expect(keyAction(key("f", { altKey: true }))).toBeNull();
    for (const name of ["Tab", "F11", "F12", "Shift", "Control", "Alt", "Meta", "CapsLock", "Dead"]) expect(keyAction(key(name))).toBeNull();
  });
});
