import { describe, expect, it } from "vitest";
import {
  MAX_DELAY,
  advanceClock,
  applyCadenceKey,
  cadenceKeyFor,
  createCadence,
  createClock,
  stepCadence,
} from "../../src/games/armaeth/engine/clock";

describe("cadence du monde", () => {
  it("au délai 6 : un tic toutes les 7 images", () => {
    const c = createCadence(6);
    const ticks = Array.from({ length: 21 }, () => stepCadence(c));
    expect(ticks.flatMap((t, i) => (t ? [i] : []))).toEqual([0, 7, 14]);
  });

  it("délai 0 : un tic à chaque image ; pause : jamais, sauf touche", () => {
    const c = createCadence(0);
    expect([stepCadence(c), stepCadence(c)]).toEqual([true, true]);
    c.pause = 7;
    expect(stepCadence(c)).toBe(false);
    expect(stepCadence(c, true)).toBe(true);
  });

  it("une touche force un tic sans toucher au compteur", () => {
    const c = createCadence(3);
    stepCadence(c);
    const counter = c.counter;
    expect(stepCadence(c, true)).toBe(true);
    expect(c.counter).toBe(counter);
  });

  it("Alt+A / Alt+Z règlent le délai (plafond 250, plancher 0) et remettent le compteur à 0", () => {
    const c = createCadence(MAX_DELAY);
    c.counter = 4;
    applyCadenceKey(c, "slower");
    expect(c).toMatchObject({ delay: MAX_DELAY, counter: 0 });
    const d = createCadence(0);
    d.counter = 2;
    applyCadenceKey(d, "faster");
    expect(d).toMatchObject({ delay: 0, counter: 0 });
    applyCadenceKey(d, "slower");
    expect(d.delay).toBe(1);
    applyCadenceKey(d, "pause");
    expect(d.pause).toBe(7);
    applyCadenceKey(d, "resume");
    expect(d.pause).toBe(0);
  });

  it("associe les touches Alt aux réglages", () => {
    expect(["a", "-", "Z", "=", "p", "N", "x"].map(cadenceKeyFor)).toEqual(["slower", "slower", "faster", "faster", "pause", "resume", null]);
  });
});

describe("horloge de jeu", () => {
  it("100 tics = 1 minute, 60 minutes = 1 heure, 24 heures = 1 jour", () => {
    const clock = createClock(23, 59, 99);
    expect(advanceClock(clock)).toEqual({ minuteElapsed: true, paletteDirty: true });
    expect(clock).toEqual({ hour: 0, minute: 0, ticks: 0 });
    const other = createClock(10, 0, 0);
    for (let i = 0; i < 99; i++) expect(advanceClock(other).minuteElapsed).toBe(false);
    expect(advanceClock(other)).toEqual({ minuteElapsed: true, paletteDirty: false });
    expect(other).toEqual({ hour: 10, minute: 1, ticks: 0 });
  });

  it("la palette est à recalculer toutes les 10 minutes", () => {
    const clock = createClock(10, 9, 99);
    expect(advanceClock(clock).paletteDirty).toBe(true);
  });
});
