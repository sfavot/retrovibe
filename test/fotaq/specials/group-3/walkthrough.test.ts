import { describe, expect, it } from "vitest";
import type { GameScript } from "../../../../src/games/fotaq/engine/script";
import { fotaqScript } from "../../../../src/games/fotaq/engine/specials";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";
import { GROUP_3, solveTemple } from "./solution";

/** Les mouvements spéciaux appelés pendant le parcours, dans l'ordre. */
function recordingScript(calls: number[]): GameScript {
  const specialMoves: GameScript["specialMoves"] = {};
  for (const [key, move] of Object.entries(fotaqScript.specialMoves ?? {})) {
    specialMoves[Number(key)] = function* (g) {
      calls.push(Number(key));
      yield* move!(g);
    };
  }
  return { ...fotaqScript, specialMoves };
}

/** Le départ du groupe (`GROUP_3.start` : ce que `C18B` a montré compris), les mouvements spéciaux enregistrés dans `calls`. */
function startOfGroup(calls: number[] = []): Walkthrough {
  const w = new Walkthrough({ ...GROUP_3.start, script: recordingScript(calls), voices: false });
  w.settle();
  return w;
}

describe.skipIf(!hasOriginalFiles)("groupe 3 : le passage du temple (solution jouée à la souris)", () => {
  it("part du passeur (42), traverse le temple et ouvre la porte de l'oracle (102) : états et inventaire du passage 3a", () => {
    const w = startOfGroup();
    expect(w.room).toBe(42);
    solveTemple(w);
    expect(w.room).toBe(102);
    // États posés par le passage (mesurés ; `docs/fotaq/specials-group-3.md`, § 3 : 37 vaut 2 et non 1).
    const states: Record<number, number> = {
      21: 1, 37: 2, 41: 2, 42: 1, 44: 2, 46: 1, 57: 1, 58: 3, 65: 1, 66: 1, 68: 1, 80: 1, 90: 1, 98: 1, 106: 1, 108: 1, 110: 1, 111: 1,
      121: 1, 122: 1, 137: 1, 141: 1, 142: 1, 146: 1, 162: 1, 165: 1, 170: 3, 176: 1, 177: 1, 179: 1, 180: 1, 181: 1, 182: 0, 183: 1,
      184: 1, 185: 1, 186: 2, 187: 1, 188: 2, 189: 1, 190: 1, 200: 1, 207: 1,
    };
    for (const [index, value] of Object.entries(states)) expect(w.engine.gameState(Number(index)), `état ${index}`).toBe(value);
    // Inventaire d'arrivée : batte, journal, couteau, masque propre, torche, aspirateur, argent, croquettes, briquet, piolet, racine,
    // bandelettes, carte d'identité, poupée, couronne, corne.
    const owned = Array.from({ length: 100 }, (_, i) => i).filter((item) => item > 0 && w.engine.inventory.has(item));
    expect(owned).toEqual([1, 2, 3, 15, 17, 20, 24, 25, 39, 40, 42, 46, 79, 81, 95, 97]);
    expect(w.engine.state.objects[694].name).toBeLessThan(0);
    expect(w.engine.warnings).toEqual([]);
  }, 60_000);

  it("joue les cas du groupe : mouvements 20 et 24 (la mort de Ian), 33 (le puzzle), zones éteintes des pièces 50 et 53", () => {
    const calls: number[] = [];
    const w = startOfGroup(calls);
    GROUP_3.solve!(w);
    // c100c : 20 puis (l'échec du levier) ; c100d : 20 et 24 ; c102c/c102d (33) ne sont pas joués par la bonne solution.
    expect(calls).toContain(20);
    expect(calls).toContain(24);
    expect(calls).not.toContain(33);
    // C50D (zone 6 de la pièce 50), jouée une seule fois, avant le sarcophage ; C101E : l'entrée dans la pièce 101.
    const played = w.cutaways.played;
    expect(played.filter((name) => name.toUpperCase() === "C50D.CUT")).toHaveLength(1);
    expect(played.indexOf("C50D.CUT")).toBeLessThan(played.indexOf("c50b.CUT"));
    expect(played).toContain("c53a.CUT");
    expect(played).not.toContain("C53B.CUT");
    expect(played).not.toContain("C101B.CUT");
  }, 60_000);

  it("va jusqu'au bout : le crâne de cristal pris, la chaise de Frank, retour dans la cellule de la pièce 41 (passage 4b)", () => {
    const w = startOfGroup();
    GROUP_3.solve!(w);
    expect(w.room).toBe(41);
    expect(w.engine.state.joe.x).toBe(136);
    expect(w.engine.state.joe.y).toBe(102);
    expect(w.engine.gameState(45)).toBe(2);
    expect(w.engine.gameState(100)).toBe(3);
    expect(w.engine.gameState(67)).toBe(2);
    expect(w.engine.inventory.has(45)).toBe(false);
    expect(w.engine.inventory.has(97)).toBe(false);
    expect(w.engine.warnings).toEqual([]);
    expect(w.engine.input.cutawayRunning).toBe(false);
  }, 60_000);
});
