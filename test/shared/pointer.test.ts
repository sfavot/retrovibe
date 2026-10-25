import { describe, expect, it } from "vitest";
import { LONG_PRESS_MS, LONG_PRESS_SLOP, LongPress, toLogical, type Timers } from "../../src/ui/pointer";

function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const timers: Timers = {
    set: (callback, ms) => {
      pending.set(next, { at: now + ms, callback });
      return next++;
    },
    clear: (id) => void pending.delete(id),
  };
  return {
    timers,
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...pending]) {
        if (timer.at <= now) {
          pending.delete(id);
          timer.callback();
        }
      }
    },
  };
}

describe("toLogical (pointeur -> coordonnées du jeu)", () => {
  const size = { width: 320, height: 200 };

  it("tient compte du décalage et de l'échelle du canvas", () => {
    const rect = { left: 100, top: 50, width: 640, height: 400 };
    expect(toLogical(100, 50, rect, size)).toEqual({ x: 0, y: 0 });
    expect(toLogical(420, 250, rect, size)).toEqual({ x: 160, y: 100 });
    expect(toLogical(740, 450, rect, size)).toEqual({ x: 320, y: 200 });
  });

  it("sort de l'écran sans borner", () => {
    const rect = { left: 10, top: 10, width: 320, height: 200 };
    expect(toLogical(0, 0, rect, size)).toEqual({ x: -10, y: -10 });
  });

  it("suit une échelle fractionnaire", () => {
    expect(toLogical(80, 50, { left: 0, top: 0, width: 160, height: 100 }, size)).toEqual({ x: 160, y: 100 });
  });
});

describe("LongPress", () => {
  it("se déclenche après la durée, à la position de départ", () => {
    const { timers, advance } = fakeTimers();
    const fired: [number, number][] = [];
    const press = new LongPress((x, y) => fired.push([x, y]), timers);
    press.start(5, 6);
    advance(LONG_PRESS_MS - 1);
    expect(fired).toEqual([]);
    expect(press.pending).toBe(true);
    advance(1);
    expect(fired).toEqual([[5, 6]]);
    expect(press.pending).toBe(false);
  });

  it("tolère un petit tremblement mais pas un glissement", () => {
    const { timers, advance } = fakeTimers();
    let fired = 0;
    const press = new LongPress(() => fired++, timers);
    press.start(0, 0);
    press.move(LONG_PRESS_SLOP, 0);
    advance(LONG_PRESS_MS);
    expect(fired).toBe(1);
    press.start(0, 0);
    press.move(LONG_PRESS_SLOP + 1, 0);
    expect(press.pending).toBe(false);
    advance(LONG_PRESS_MS);
    expect(fired).toBe(1);
  });

  it("stop annule, et un nouveau start repart de zéro", () => {
    const { timers, advance } = fakeTimers();
    let fired = 0;
    const press = new LongPress(() => fired++, timers);
    press.start(0, 0);
    advance(LONG_PRESS_MS - 10);
    press.start(0, 0);
    advance(LONG_PRESS_MS - 10);
    expect(fired).toBe(0);
    press.stop();
    advance(LONG_PRESS_MS);
    expect(fired).toBe(0);
  });
});
