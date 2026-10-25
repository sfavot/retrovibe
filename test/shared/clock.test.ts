import { describe, expect, it } from "vitest";
import { FixedStepClock } from "../../src/engine/clock";
import { Clock as MathClock, MAX_CATCH_UP_TICKS, TICK_MS, msToTicks } from "../../src/games/mathemagique/engine/clock";
import { Clock as SmurfClock } from "../../src/games/teleportaschtroumpf/engine/clock";

function drain(clock: FixedStepClock): number {
  let n = 0;
  while (clock.consume()) n++;
  return n;
}

describe("FixedStepClock", () => {
  const make = () => new FixedStepClock({ tickMs: 20, maxCatchUpTicks: 5 });

  it("le premier update ne fait que fixer l'origine", () => {
    const c = make();
    c.update(1000);
    expect(drain(c)).toBe(0);
    expect(c.ticks).toBe(0);
  });

  it("convertit le temps en ticks et garde le reste", () => {
    const c = make();
    c.update(0);
    c.update(50);
    expect(drain(c)).toBe(2);
    c.update(60);
    expect(drain(c)).toBe(1);
    expect(c.ticks).toBe(3);
  });

  it("tolère l'erreur de flottants (1000/60 ms répétés)", () => {
    const c = new FixedStepClock({ tickMs: 1000 / 60, maxCatchUpTicks: 15 });
    c.update(0);
    let t = 0;
    for (let i = 0; i < 600; i++) {
      t += 1000 / 60;
      c.update(t);
      expect(drain(c)).toBe(1);
    }
    expect(c.ticks).toBe(600);
  });

  it("plafonne le rattrapage et ignore un temps négatif", () => {
    const c = make();
    c.update(0);
    c.update(10_000);
    expect(drain(c)).toBe(5);
    c.update(0);
    expect(drain(c)).toBe(0);
  });

  it("resync abandonne l'absence mais garde les ticks déjà dus", () => {
    const c = make();
    c.update(0);
    c.update(40);
    c.resync();
    c.update(100_000);
    expect(drain(c)).toBe(2);
    c.update(100_020);
    expect(drain(c)).toBe(1);
  });
});

describe("horloges des jeux", () => {
  it("Téléportaschtroumpf : 60 ticks/s, centièmes et secondes, plafond 250 ms", () => {
    const c = new SmurfClock();
    c.update(0);
    c.update(1000);
    expect(drain(c)).toBe(15);
    c.update(1000 + 1000 / 60);
    expect(drain(c)).toBe(1);
    expect(c.centiseconds).toBe(26);
    expect(c.seconds).toBe(0);
  });

  it("Mathémagique : ticks de 17 ms, ms et msToTicks", () => {
    const c = new MathClock();
    c.update(0);
    c.update(TICK_MS * 3);
    expect(drain(c)).toBe(3);
    expect(c.ms).toBe(3 * TICK_MS);
    c.update(1_000_000);
    expect(drain(c)).toBe(MAX_CATCH_UP_TICKS);
    expect(msToTicks(34)).toBe(2);
    expect(msToTicks(35)).toBe(3);
  });
});
