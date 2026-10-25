import { describe, expect, it } from "vitest";
import { isRotated, shouldRotate, type RotationState } from "../../src/ui/fullscreen";

const base: RotationState = { coarse: true, portrait: true, lockOk: false, covering: true };

describe("shouldRotate (plein écran tactile en paysage)", () => {
  it("pivote en repli, sur écran tactile tenu en portrait, sans verrou d'orientation (iPhone, iPad)", () => {
    expect(shouldRotate(base)).toBe(true);
  });

  it("ne pivote pas quand le verrou a réussi (Android)", () => {
    expect(shouldRotate({ ...base, lockOk: true })).toBe(false);
  });

  it("ne pivote pas quand l'appareil est déjà en paysage (tourné à la main)", () => {
    expect(shouldRotate({ ...base, portrait: false })).toBe(false);
  });

  it("ne pivote pas sans écran tactile (ordinateur)", () => {
    expect(shouldRotate({ ...base, coarse: false })).toBe(false);
  });

  it("ne pivote pas en vrai plein écran, que le navigateur ne laisse pas pivoter", () => {
    expect(shouldRotate({ ...base, covering: false })).toBe(false);
  });
});

describe("isRotated", () => {
  it("lit la classe de l'élément ou de l'un de ses ancêtres", () => {
    const hit = { closest: (selector: string) => (selector === ".is-rotated" ? {} : null) };
    const miss = { closest: () => null };
    expect(isRotated(hit as unknown as Element)).toBe(true);
    expect(isRotated(miss as unknown as Element)).toBe(false);
  });
});
