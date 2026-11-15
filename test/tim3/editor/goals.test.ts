import { describe, expect, it } from "vitest";
import { levelParts, readLev, type Level } from "../../../src/games/tim3/data/lev";
import { GOAL_MET, GOAL_NONE, GOAL_PENDING, GoalTest, SolvedCountdown, SOLVED_COUNTDOWN } from "../../../src/games/tim3/engine/goals";
import { MemoryStorage, prefixedStorage } from "../../../src/engine/storage";
import { Progress, Tim3Session, puzzleList } from "../../../src/games/tim3/engine/session";
import { realTypes } from "../engine/helpers";
import { frenchIndex, original } from "../data/real";

/** Premier pas où 436dc6 rend 2, en marche libre (pas k = après le k-ième pas, comme le banc). */
function firstMet(level: Level, steps: number): number | null {
  const s = new Tim3Session(realTypes(), level);
  s.start();
  for (let k = 1; k <= steps; k++) {
    if (s.tick().goal === GOAL_MET) return k;
  }
  return null;
}

function lev(name: string, edit: (l: Level) => void = () => {}): Level {
  const l = readLev(frenchIndex().get(`${name}.LEV`));
  edit(l);
  return l;
}

/** Pièce du bac posée par le LEV (verrouillée, à une position) : comme une solution écrite pour le banc. */
const place = (i: number, x: number, y: number) => (l: Level) => {
  const p = levelParts(l)[i]!;
  p.flags3 |= 0x40;
  p.x = x;
  p.y = y;
};

describe.skipIf(!original.has)("conditions de victoire (436dc6), comparées au banc Unicorn", () => {
  // Valeurs relevées avec `bench.py trace --lev` sur les mêmes LEV modifiés (`# goal 2 step=…`).
  it("TLEV1 : balle magique sous la boule no 8 (hors de l'écran)", () => {
    expect(firstMet(lev("TLEV1", place(7, 444, 237)), 200)).toBe(63);
    expect(firstMet(lev("TLEV1", place(7, 444, 173)), 200)).toBe(61);
    expect(firstMet(lev("TLEV1", place(7, 300, 100)), 400)).toBeNull();
  });

  it("TLEV2 : condition « nombre » (2 boules de bowling dans la zone)", () => {
    const both = lev("TLEV2", (l) => {
      Object.assign(levelParts(l)[50]!, { x: 262, y: 200 });
      Object.assign(levelParts(l)[51]!, { x: 318, y: 200 });
    });
    expect(firstMet(both, 10)).toBe(1);
    const one = lev("TLEV2", (l) => Object.assign(levelParts(l)[50]!, { x: 262, y: 200 }));
    expect(firstMet(one, 200)).toBeNull();
  });

  it("une pièce visée encore dans le bac : pas encore", () => {
    const l = lev("TLEV1", (x) => (levelParts(x)[14]!.flags3 &= ~0x40));
    const s = new Tim3Session(realTypes(), l);
    expect(s.goals.check(s.world)).toBe(GOAL_PENDING);
  });
});

describe("fin de puzzle (4359a4)", () => {
  it("30 images après le premier 2, même si le but redevient faux", () => {
    const c = new SolvedCountdown();
    expect(c.update(GOAL_PENDING)).toBe(false);
    expect(c.update(GOAL_MET)).toBe(false);
    for (let i = 1; i < SOLVED_COUNTDOWN; i++) expect(c.update(GOAL_PENDING)).toBe(false);
    expect(c.update(GOAL_PENDING)).toBe(true);
    expect(c.solved).toBe(true);
  });

  it("sans condition active : 0", () => {
    const t = new GoalTest([], 0, 0);
    expect(t.check({ bin: [], mobiles: { head: null }, statics: { head: null } } as never)).toBe(GOAL_NONE);
  });
});

describe("progression et liste des puzzles (D11)", () => {
  it("156 puzzles dans l'ordre du jeu, index des voix de 0 à 155", () => {
    const list = puzzleList();
    expect(list.length).toBe(156);
    expect(list[0]).toEqual({ name: "TLEV1", index: 0, category: 0, number: 1 });
    expect(list[40]!.name).toBe("ELEV1");
    expect(list.at(-1)).toEqual({ name: "RLEV29", index: 155, category: 4, number: 29 });
  });

  it("résolus, dernier puzzle, suivant non résolu ; valeurs illisibles ignorées", () => {
    const store = new MemoryStorage();
    const p = new Progress(prefixedStorage(store, "tim3:"));
    expect(p.last).toBeNull();
    p.markSolved("TLEV2");
    p.markSolved("TLEV2");
    p.last = "TLEV1";
    expect(store.get("tim3:solved")).toBe("TLEV2");
    expect(p.next("TLEV1")?.name).toBe("TLEV3");
    expect(p.next("RLEV29")).toBeNull();
    const again = new Progress(prefixedStorage(store, "tim3:"));
    expect([again.isSolved("TLEV2"), again.last, again.count(["TLEV1", "TLEV2"])]).toEqual([true, "TLEV1", 1]);
    store.set("tim3:solved", "x,TLEV5,<b>");
    store.set("tim3:last", "../");
    const odd = new Progress(prefixedStorage(store, "tim3:"));
    expect([odd.count(["TLEV5"]), odd.last]).toEqual([1, null]);
  });
});
