import { describe, expect, it } from "vitest";
import { fotaqScript } from "../../../../src/games/fotaq/engine/specials";
import type { GameScript, SpecialMove } from "../../../../src/games/fotaq/engine/script";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";
import { crashSolution, solution } from "./solution";

/** Le script du jeu où chaque mouvement spécial note son numéro avant de s'exécuter (ceux qui n'existent pas ne font rien). */
function recordingScript(calls: number[]): GameScript {
  const specialMoves: Record<number, SpecialMove> = {};
  for (let n = 1; n <= 39; n++) {
    const move = fotaqScript.specialMoves?.[n];
    specialMoves[n] = function* (g) {
      calls.push(n);
      if (move) yield* move(g);
    };
  }
  return { ...fotaqScript, specialMoves };
}

describe.skipIf(!hasOriginalFiles)("groupe 5 : passage 5a (l'avion et le crash)", () => {
  it("and1.DOG puis C75B : l'orage (mouvements 28 et 32), le crash, Joe arrive au site du crash (pièce 1)", () => {
    const calls: number[] = [];
    const w = new Walkthrough({ ...crashSolution.start, script: recordingScript(calls), voices: false });
    crashSolution.solve!(w);
    expect(w.cutaways.played).toEqual(["c75b.CUT"]);
    expect(w.room).toBe(1);
    expect(calls).toEqual([28, 32]);
    expect(w.engine.warnings).toEqual([]);
    expect(w.engine.ended).toBe(false);
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("groupe 5 : passage 5b (le combat final) jusqu'à la fin du jeu", () => {
  it("C69Z, le pistolet, Faye, Sparky, C69G : les mouvements du groupe s'enchaînent et la partie se termine (endGame)", () => {
    const calls: number[] = [];
    const w = new Walkthrough({ ...solution.start, script: recordingScript(calls), voices: false });
    w.settle();
    solution.solve!(w);
    expect(w.cutaways.played).toEqual(["C69Z.CUT", "c69e.CUT", "c69j.CUT", "c69f.CUT", "c69i.CUT", "c69g.CUT"]);
    expect(w.engine.warnings).toEqual([]);
    // États de fin : Sparky transformé puis rendu, Faye a tourné son miroir, le rayon a touché Sparky.
    expect([149, 150, 151].map((n) => w.engine.gameState(n))).toEqual([1, 1, 2]);
    // Mouvements joués par C69Z (9, 11, 12), C69E et C69F (10 puis 9), C69G (10, 13, 26, 27, 29, 30, 14).
    expect(calls.filter((n) => n === 14)).toEqual([14]);
    expect(calls.slice(0, 3)).toEqual([11, 12, 9]);
    const finale = calls.slice(calls.lastIndexOf(10));
    expect(finale).toEqual([10, 13, 26, 27, 29, 30, 14]);
    // La fin du jeu : l'hôte a quitté, une seule fois, depuis la pièce 110 (générique de fin).
    expect(w.engine.ended).toBe(true);
    expect(w.host.exits).toBe(1);
    expect(w.room).toBe(110);
  }, 120_000);

  it("la partie finie, plus rien ne se joue (les ticks suivants sont sans effet)", () => {
    const w = new Walkthrough({ ...solution.start, voices: false });
    w.settle();
    solution.solve!(w);
    const frames = w.stage.frames;
    w.wait(50);
    expect(w.stage.frames).toBe(frames);
    expect(w.host.exits).toBe(1);
  }, 120_000);

  it("Échap pendant C69G passe la cinématique : les mouvements restants se jouent et la partie se termine quand même", () => {
    const w = new Walkthrough({ room: 69, voices: false });
    w.settle();
    w.engine.run(w.engine.playCutaway("c69g.CUT"));
    // Le dirigeable (mouvement 29, ~2100 images) ne tient pas compte de la demande de passage, comme dans ScummVM : ~3 400 ticks.
    w.skipUntil(() => w.engine.ended, 6_000);
    expect(w.host.exits).toBe(1);
    expect(w.engine.warnings).toEqual([]);
  }, 120_000);
});
