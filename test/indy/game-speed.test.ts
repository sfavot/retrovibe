import { afterEach, describe, expect, it, vi } from "vitest";
import { GAME_SPEED, SPEED_PRESETS, clampSpeed, nearestPreset, nextPreset, speedSetting } from "../../src/games/indy/ui/game-speed";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("vitesse de jeu", () => {
  it("vaut 140 ms par défaut et les crans sont dans les bornes", () => {
    expect(GAME_SPEED.default).toBe(140);
    for (const p of SPEED_PRESETS) expect(clampSpeed(p)).toBe(p);
  });

  it("borne à [95, 185] et rejette les valeurs invalides", () => {
    expect(clampSpeed(10)).toBe(95);
    expect(clampSpeed(999)).toBe(185);
    expect(clampSpeed(Number.NaN)).toBe(140);
  });

  it("choisit le cran le plus proche et boucle au cran suivant", () => {
    expect(nearestPreset(100)).toBe(96);
    expect(nearestPreset(150)).toBe(140);
    expect(nearestPreset(180)).toBe(185);
    expect(nextPreset(96)).toBe(140);
    expect(nextPreset(140)).toBe(185);
    expect(nextPreset(185)).toBe(96);
  });

  it("mémorise le réglage, avec repli si le stockage est absent ou corrompu", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    expect(speedSetting.read()).toBe(140);
    speedSetting.write(185);
    expect(speedSetting.read()).toBe(185);
    storage.data.set("indy-desktop-speed", "abc");
    expect(speedSetting.read()).toBe(140);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("bloqué");
      },
      setItem: () => {
        throw new Error("bloqué");
      },
    });
    expect(speedSetting.read()).toBe(140);
    expect(() => speedSetting.write(96)).not.toThrow();
  });
});
