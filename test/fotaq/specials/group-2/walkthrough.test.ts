import { describe, expect, it } from "vitest";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";
import { GROUP2_SOLUTION, setupGroup2b, solveGroup2b, startGroup2b } from "./solution";

/** États du jeu posés par le passage 2a (`docs/fotaq/specials.md` § 7, « État d'arrivée (2a) »). */
const ARRIVAL_2A: Record<number, number> = {
  9: 1, 28: 1, 30: 2, 34: 1, 39: 1, 40: 1, 69: 1, 72: 1, 73: 1, 74: 1, 75: 1, 76: 1, 82: 1, 86: 1, 87: 1, 89: 1, 126: 1, 127: 1, 128: 1,
  134: 1, 135: 1, 144: 1, 172: 1, 191: 0, 192: 1, 193: 1, 197: 1,
};
/** Objets d'inventaire d'arrivée : croquettes, fusée dorsale, plan de fusée, ouvre-boîtes ; livre et clef sont retirés. */
const HELD_2A = [25, 23, 33, 27, 3, 20, 58];

describe.skipIf(!hasOriginalFiles)("groupe 2 : le passage 2a, de l'infiltration à la fuite d'Azura", () => {
  it("se joue du piton jusqu'à la pièce 22, états et inventaire d'arrivée", () => {
    const w = new Walkthrough({ ...GROUP2_SOLUTION.start, voices: false });
    GROUP2_SOLUTION.solve!(w);
    expect(w.room).toBe(22);
    expect(w.engine.state.joe.x).toBe(194);
    expect(w.engine.state.joe.y).toBe(147);
    for (const [state, value] of Object.entries(ARRIVAL_2A)) expect(w.engine.gameState(Number(state)), `état ${state}`).toBe(value);
    for (const item of HELD_2A) expect(w.engine.inventory.has(item), `objet ${item}`).toBe(true);
    for (const item of [30, 78, 28, 29, 34, 19]) expect(w.engine.inventory.has(item), `objet ${item} retiré`).toBe(false);
    expect(w.engine.warnings).toEqual([]);
    expect(w.talk.warnings).toEqual([]);
    // Les mouvements du groupe ont servi : la fusée est dans l'inventaire, le mannequin allumé, les lumières revenues.
    expect(w.cutaways.played).toEqual(expect.arrayContaining(["c41f.CUT", "c103f.CUT", "c103g.CUT"]));
    expect(w.engine.input.cutawayRunning).toBe(false);
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("groupe 2 : le passage 2b, de la corniche de la cellule à la fusée pleine", () => {
  it("se joue de la corniche où C62C laisse Joe jusqu'à la pièce 21 : tasse, porte de la prison, fusée pleine, argent dépensé", () => {
    const w = new Walkthrough({ ...startGroup2b, voices: false });
    setupGroup2b(w);
    solveGroup2b(w);
    expect(w.room).toBe(21);
    expect(w.engine.gameState(9)).toBe(2);
    expect(w.engine.gameState(30)).toBe(0);
    expect(w.engine.inventory.has(23)).toBe(true);
    expect(w.engine.inventory.has(22)).toBe(false);
    expect(w.engine.inventory.has(92)).toBe(true);
    expect(w.cutaways.played).toEqual(expect.arrayContaining(["c41b.CUT", "c21k.CUT"]));
    expect(w.engine.warnings).toEqual([]);
  }, 60_000);

  it("sans la porte vue de l'intérieur (C152 non jouée), la porte de la prison reste hors d'atteinte depuis la corniche (zone 3 éteinte)", () => {
    const w = new Walkthrough({ ...startGroup2b, copies: [], items: [92], voices: false });
    setupGroup2b(w);
    w.settle();
    w.useItem(92, 296);
    // Le chemin vers la porte extérieure (200,119) traverse la zone 3 éteinte : Joe s'arrête à son bord, comme dans ScummVM.
    expect([w.engine.state.joe.x, w.engine.state.joe.y]).toEqual([189, 106]);
    expect(w.cutaways.played).not.toContain("c41b.CUT");
  });
});
