import { describe, expect, it } from "vitest";
import { COUNTER, countStep, END_GUARD_TICKS, END_START_TICKS, EndCounters, MAX_CATCHUP_MS, TICK_MS } from "../../../src/games/swiv3d/screens/end-screen";

const values = { levelScore: 1500, totalScore: 4200, objectivesPercent: 66, bonusPercent: 25, secretsPercent: 0 };

describe("pas du décompte (gm_menu_anim_tick)", () => {
  it("suit les tranches de l'original, dont les 12 de la tranche 1000-9999", () => {
    expect([0, 1, 49, 50, 99, 100, 999, 1000, 9999, 10000, 50000].map(countStep)).toEqual([0, 1, 1, 3, 3, 71, 71, 12, 12, 673, 673]);
  });
});

describe("compteurs de fin", () => {
  it("le score total repart de sa valeur d'avant le niveau, les autres de 0", () => {
    const c = new EndCounters("complete", values);
    expect(c.current.slice(0, 5)).toEqual([0, 2700, 0, 0, 0]);
    expect(c.target[COUNTER.totalScore]).toBe(4200);
  });

  it("un tick = 25 ms, plusieurs ticks par image si besoin, jamais de dépassement de la cible", () => {
    const c = new EndCounters("complete", { ...values, levelScore: 120, totalScore: 120 });
    expect(c.advance(TICK_MS)).toBe(0); // il faut dépasser 25 ms
    expect(c.advance(1 + 2 * TICK_MS)).toBe(3);
    expect(c.current[COUNTER.levelScore]).toBe(73); // 120 → +71, puis +1, +1 (écart sous 50)
    for (let i = 0; i < 400; i++) c.advance(16);
    expect(c.done).toBe(true);
    expect(c.current[COUNTER.levelScore]).toBe(120);
    expect(c.current[COUNTER.objectives]).toBe(66);
  });

  it("le décompte se fait en parallèle sur toutes les lignes, du même pas", () => {
    const c = new EndCounters("complete", values);
    c.advance(TICK_MS + 1);
    // écart 1500 → 12 ; écart 1500 sur le total aussi ; 66 → 3 ; 25 → 1
    expect(c.current.slice(0, 5)).toEqual([12, 2712, 3, 1, 0]);
  });

  it("une pause de plus de 800 ms ne se rattrape pas", () => {
    const c = new EndCounters("complete", values);
    expect(c.advance(MAX_CATCHUP_MS + 1)).toBe(0);
    expect(c.ticks).toBe(END_START_TICKS.complete);
  });

  it("les touches ne sont acceptées qu'à 110 : 55 ticks après une victoire, 75 après un game over", () => {
    expect(END_GUARD_TICKS - END_START_TICKS.complete).toBe(55);
    expect(END_GUARD_TICKS - END_START_TICKS.gameOver).toBe(75);
    const c = new EndCounters("gameOver", values);
    c.advance(1);
    for (let i = 0; i < 74; i++) c.advance(TICK_MS); // 1 ms d'avance : exactement un tick par appel
    expect(c.ticks).toBe(END_GUARD_TICKS - 1);
    expect(c.acceptsKeys).toBe(false);
    c.advance(TICK_MS);
    expect(c.acceptsKeys).toBe(true);
  });
});
