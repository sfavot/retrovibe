import { describe, expect, it } from "vitest";
import { GadgetManager, type GadgetSpec } from "../../src/games/mathemagique/engine/gadgets";
import { isModifierOnlyKey, type ButtonEvent } from "../../src/games/mathemagique/engine/input";
import { gameModifiers, gameOwnsKey, isComposedKey, keepsInputOnBlur, type KeyInfo } from "../../src/games/mathemagique/ui/browser-host";
import { TestHost } from "./engine-test-host";

const key = (init: Partial<KeyInfo>): KeyInfo => ({
  key: "",
  code: "",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...init,
});

const ev = (down: boolean, x: number, y: number): ButtonEvent => ({ button: "left", down, x, y, ctrl: false, shift: false, alt: false });

describe("Gadgets : appui périmé", () => {
  const A: GadgetSpec = { rect: { x: 10, y: 10, w: 20, h: 10 } };
  function build(activateOn: "release" | "press" = "release") {
    const manager = new GadgetManager();
    const calls: number[] = [];
    manager.addGroup({ records: [A], activateOn, onActivate: (index) => calls.push(index) });
    return { manager, calls };
  }

  it("un bouton qui n'est plus tenu efface l'appui mémorisé (Alt-Tab bouton enfoncé)", () => {
    const { manager, calls } = build();
    manager.handleButton(ev(true, 15, 12));
    expect(manager.pressed).not.toBeNull();
    manager.updatePointer(15, 12, () => true);
    expect(manager.pressed).not.toBeNull();
    manager.updatePointer(15, 12, () => false);
    expect(manager.pressed).toBeNull();
    // le clic suivant fonctionne
    manager.handleButton(ev(true, 15, 12));
    manager.handleButton(ev(false, 15, 12));
    expect(calls).toEqual([1]);
  });

  it("un nouvel appui du même bouton remplace un appui dont le relâchement s'est perdu", () => {
    const { manager, calls } = build();
    manager.handleButton(ev(true, 15, 12));
    expect(manager.handleButton(ev(true, 15, 12))).toBe(true);
    manager.handleButton(ev(false, 15, 12));
    expect(calls).toEqual([1]);
  });

  it("Input.reset ne doit pas être appelé entre appui et relâchement : le relâchement en file active le gadget", () => {
    const host = new TestHost();
    const { manager, calls } = build();
    host.input.moveMouse(15, 12);
    host.input.mouseDown("left");
    host.input.mouseUp("left");
    host.input.beginTick();
    for (const e of host.input.buttonEvents) manager.handleButton(e);
    expect(calls).toEqual([1]);
  });
});

describe("keepsInputOnBlur", () => {
  it("garde l'entrée quand le focus va à un autre récepteur du jeu", () => {
    const input = {};
    const targets = new Set<EventTarget>([input as EventTarget]);
    expect(keepsInputOnBlur(input as EventTarget, targets)).toBe(true);
    expect(keepsInputOnBlur({} as EventTarget, targets)).toBe(false);
    expect(keepsInputOnBlur(null, targets)).toBe(false);
  });
});

describe("clavier : Tab, AltGr, composition", () => {
  it("le jeu possède Tab et Maj+Tab", () => {
    expect(gameOwnsKey(key({ key: "Tab", code: "Tab" }))).toBe(true);
    expect(gameOwnsKey(key({ key: "Tab", code: "Tab", shiftKey: true }))).toBe(true);
  });

  it("AltGr n'est ni Ctrl ni Alt : « @ » est tapable et au jeu", () => {
    const altGr = key({ key: "@", code: "Digit0", ctrlKey: true, altKey: true, altGraph: true });
    expect(gameModifiers(altGr)).toEqual({ ctrl: false, alt: false, shift: false });
    expect(gameOwnsKey(altGr)).toBe(true);
    expect(gameModifiers(key({ ctrlKey: true, altKey: true }))).toEqual({ ctrl: true, alt: true, shift: false });
    expect(gameOwnsKey(key({ key: "@", code: "Digit0", ctrlKey: true, altKey: true }))).toBe(false);
  });

  it("touches mortes et composition sont ignorées (le champ invisible relaie le texte)", () => {
    expect(isComposedKey({ key: "Dead", isComposing: false })).toBe(true);
    expect(isComposedKey({ key: "ê", isComposing: true })).toBe(true);
    expect(isComposedKey({ key: "Process" })).toBe(true);
    expect(isComposedKey({ key: "e", isComposing: false })).toBe(false);
    expect(isComposedKey({ key: "ê" })).toBe(false);
  });
});

describe("isModifierOnlyKey", () => {
  it("reconnaît les modificateurs et verrous seuls", () => {
    for (const k of ["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock"]) expect(isModifierOnlyKey(k)).toBe(true);
    for (const k of ["a", "Enter", " ", "Tab"]) expect(isModifierOnlyKey(k)).toBe(false);
  });
});
