import { describe, expect, it } from "vitest";
import { LOOK_AT_TICKS, lookAtWait } from "../../../src/games/bass/engine/effects";
import type { BassScreen } from "../../../src/games/bass/engine/services";

/** Nombre de tours (`yield`) de `lookAtWait`, le bouton étant relâché au tour `releaseAt` ; `skipAt` : tour où Échap arrive. */
function ticks(releaseAt: number, skipAt = Infinity): number {
  let compose = 0;
  let tick = 0;
  const screen = { compose: () => compose++ } as unknown as BassScreen;
  const gen = lookAtWait(screen, () => tick >= skipAt, () => tick < releaseAt);
  while (!gen.next("ok").done) tick++;
  expect(compose).toBe(1);
  return tick;
}

describe("lookAtWait (waitMouseNotPressed(800))", () => {
  it("bouton relâché : au moins 800 ms (40 ticks)", () => {
    expect(ticks(0)).toBe(LOOK_AT_TICKS);
    expect(ticks(10)).toBe(LOOK_AT_TICKS);
  });

  it("bouton tenu au-delà de 800 ms : attend le relâchement", () => {
    expect(ticks(100)).toBe(100);
  });

  it("Échap abrège l'attente, bouton tenu ou non", () => {
    expect(ticks(0, 5)).toBe(5);
    expect(ticks(100, 50)).toBe(50);
  });
});
