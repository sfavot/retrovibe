import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../../src/engine/storage";
import type { BassSettings } from "../../../src/games/bass/engine/host";
import { SETTINGS_KEY, parseSettings, readSettings, writeSettings } from "../../../src/games/bass/ui/settings";

const full: BassSettings = { musicVolume: 64, gameSpeed: 74, fxOff: true, textMode: "voice" };

describe("réglages mémorisés", () => {
  it("aller-retour par le stockage du site", () => {
    const store = new MemoryStorage();
    expect(readSettings(store)).toBeNull();
    writeSettings(store, full);
    expect(store.get(SETTINGS_KEY)).toBe(JSON.stringify(full));
    expect(readSettings(store)).toEqual(full);
  });

  it("valeur absente, illisible ou d'une autre forme : aucun réglage", () => {
    expect(parseSettings(null)).toBeNull();
    expect(parseSettings("pas du json")).toBeNull();
    expect(parseSettings("12")).toBeNull();
    expect(parseSettings("null")).toBeNull();
    expect(parseSettings("{}")).toBeNull();
  });

  it("champ par champ : un champ hors bornes ou du mauvais type est ignoré, les autres restent", () => {
    expect(parseSettings(JSON.stringify({ musicVolume: 200, gameSpeed: 1, fxOff: "oui", textMode: "both" }))).toEqual({ textMode: "both" });
    expect(parseSettings(JSON.stringify({ musicVolume: 0, gameSpeed: 134, fxOff: false, textMode: "text" }))).toEqual({
      musicVolume: 0,
      gameSpeed: 134,
      fxOff: false,
      textMode: "text",
    });
    expect(parseSettings(JSON.stringify({ musicVolume: 12.5, textMode: "autre" }))).toBeNull();
  });

  it("un stockage qui lève (bloqué, plein) n'empêche pas de jouer", () => {
    const broken = {
      get: () => {
        throw new Error("bloqué");
      },
      set: () => {
        throw new Error("plein");
      },
    };
    expect(readSettings(broken)).toBeNull();
    expect(() => writeSettings(broken, full)).not.toThrow();
  });
});
