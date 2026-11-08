import { describe, expect, it } from "vitest";
import { VERB_KEYS, keyAction } from "../../../src/games/fotaq/ui/keys";

const key = (k: string, extra: { code?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) =>
  keyAction({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...extra });

describe("touches du jeu (carte de ScummVM, version française)", () => {
  it("les huit verbes sont les lettres « ofdnepau » (majuscule ou minuscule)", () => {
    expect(Object.keys(VERB_KEYS).join("")).toBe("ofdnepau");
    const actions = ["open", "close", "move", "give", "look", "pickUp", "talk", "use"];
    [..."ofdnepau"].forEach((letter, i) => {
      expect(key(letter)).toEqual({ type: "engine", action: actions[i] });
      expect(key(letter.toUpperCase())).toEqual({ type: "engine", action: actions[i] });
    });
  });

  it("les cases 1 à 4 par position (AZERTY compris) et au pavé numérique, virgule et point pour défiler", () => {
    expect(key("&", { code: "Digit1" })).toEqual({ type: "engine", action: "inventory1" });
    expect(key("4", { code: "Numpad4" })).toEqual({ type: "engine", action: "inventory4" });
    expect(key(",")).toEqual({ type: "engine", action: "scrollUp" });
    expect(key(".")).toEqual({ type: "engine", action: "scrollDown" });
    expect(key(";", { code: "Comma" })).toEqual({ type: "engine", action: "scrollUp" });
  });

  it("Échap passe (skipCutaway), Entrée passe une réplique, F1 et F5 ouvrent le journal", () => {
    expect(key("Escape")).toEqual({ type: "engine", action: "skipCutaway" });
    expect(key("Enter")).toEqual({ type: "engine", action: "skipText" });
    expect(key("F1")).toEqual({ type: "engine", action: "journal" });
    expect(key("F5")).toEqual({ type: "engine", action: "journal" });
  });

  it("l'hôte garde la sauvegarde, le chargement, le volume et la pause (Espace)", () => {
    expect(key("F10")).toEqual({ type: "host", command: "save" });
    expect(key("F7")).toEqual({ type: "host", command: "load" });
    expect(key("F9")).toEqual({ type: "host", command: "volume" });
    expect(key(" ")).toEqual({ type: "host", command: "pause" });
  });

  it("le navigateur garde Ctrl / Cmd + touche, Alt + lettre, Tab, F11, F12 ; les autres touches ne font rien", () => {
    expect(key("o", { ctrlKey: true })).toBeNull();
    expect(key("e", { metaKey: true })).toBeNull();
    expect(key("o", { altKey: true })).toBeNull();
    for (const other of ["Tab", "F11", "F12", "Shift", "x", "ArrowLeft", "F2"]) expect(key(other), other).toBeNull();
  });
});
