import { describe, expect, it } from "vitest";
import { isTouchLandscape } from "../../src/ui/touch-layout";

describe("isTouchLandscape (disposition tactile paysage)", () => {
  it("s'applique sur écran tactile en paysage", () => {
    expect(isTouchLandscape({ coarse: true, landscape: true, rotated: false })).toBe(true);
  });

  it("s'applique dans le plein écran pivoté, la fenêtre étant en portrait", () => {
    expect(isTouchLandscape({ coarse: true, landscape: false, rotated: true })).toBe(true);
  });

  it("ne s'applique pas sur écran tactile en portrait", () => {
    expect(isTouchLandscape({ coarse: true, landscape: false, rotated: false })).toBe(false);
  });

  it("ne s'applique pas sans écran tactile, même en paysage (ordinateur)", () => {
    expect(isTouchLandscape({ coarse: false, landscape: true, rotated: false })).toBe(false);
  });
});
