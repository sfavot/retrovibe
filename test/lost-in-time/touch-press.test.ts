import { describe, expect, it } from "vitest";
import { LONG_PRESS_MS, TouchPress, type Timers } from "../../src/games/lost-in-time/ui/touch-press";

/** Minuteries manuelles : `advance` déclenche ce qui arrive à échéance. */
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
  const advance = (ms: number): void => {
    now += ms;
    for (const [id, t] of [...pending]) {
      if (t.at > now) continue;
      pending.delete(id);
      t.callback();
    }
  };
  return { timers, advance, pending };
}

function setup() {
  const { timers, advance, pending } = fakeTimers();
  const log: string[] = [];
  const press = new TouchPress({ move: (x, y) => log.push(`move ${x},${y}`), click: (b) => log.push(`click ${b}`) }, timers);
  return { press, log, advance, pending };
}

describe("TouchPress", () => {
  it("toucher bref : position tout de suite, clic gauche au relâchement seulement", () => {
    const { press, log, advance, pending } = setup();
    press.down(1, 50, 60);
    expect(log).toEqual(["move 50,60"]);
    advance(LONG_PRESS_MS - 100);
    press.up(1, 52, 61);
    expect(log).toEqual(["move 50,60", "move 52,61", "click 0"]);
    expect(pending.size).toBe(0);
  });

  it("appui long : clic droit, le relâchement ne fait rien", () => {
    const { press, log, advance } = setup();
    press.down(1, 50, 60);
    press.move(1, 55, 63); // moins que le seuil : l'appui long tient
    advance(LONG_PRESS_MS);
    expect(log.at(-1)).toBe("click 2");
    press.move(1, 58, 64);
    press.up(1, 58, 64);
    expect(log).toEqual(["move 50,60", "move 55,63", "click 2"]);
  });

  it("glissement : plus d'appui long, le curseur suit et le clic gauche part au relâchement", () => {
    const { press, log, advance } = setup();
    press.down(1, 50, 60);
    press.move(1, 70, 60);
    advance(LONG_PRESS_MS * 2);
    press.move(1, 90, 80);
    press.up(1, 95, 80);
    expect(log).toEqual(["move 50,60", "move 70,60", "move 90,80", "move 95,80", "click 0"]);
  });

  it("geste annulé : aucun clic ; un second doigt est ignoré", () => {
    const { press, log, advance } = setup();
    press.down(1, 10, 10);
    press.down(2, 200, 200);
    press.move(2, 210, 210);
    press.up(2, 210, 210);
    press.cancel(1);
    advance(LONG_PRESS_MS);
    expect(log).toEqual(["move 10,10"]);
    // le geste suivant repart de zéro
    press.down(3, 20, 20);
    press.up(3, 20, 20);
    expect(log.at(-1)).toBe("click 0");
  });
});
