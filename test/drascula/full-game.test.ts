import { describe, expect, it } from "vitest";
import { hasOriginalFiles } from "./helpers";
import { SOLUTIONS, playChapter6Intro, solveChapter6 } from "./solutions";
import { Walkthrough } from "./walkthrough";

/**
 * Partie complète : la solution du chapitre 1 au générique de fin dans une seule partie, un seul moteur, sans jamais toucher à
 * l'état (les solutions de `solutions.ts`, déjà jouées chapitre par chapitre par `rooms/chapter-N/walkthrough.test.ts`, sont
 * enchaînées). Seule l'introduction du jeu (`1_1`, six minutes) est sautée, comme dans tous les tests de passage. Vérifie que ce qui
 * passe d'un chapitre au suivant (le moteur, l'hôte, la musique, le journal des voix) tient sur toute la partie.
 */
describe.skipIf(!hasOriginalFiles)("partie complète", () => {
  it("les six chapitres, de l'auberge de Transylvanie au générique de fin", () => {
    const w = new Walkthrough({ chapter: 1 });
    const engine = w.engine;
    const chapters: number[] = [];
    for (const solve of SOLUTIONS) {
      chapters.push(w.state.chapter);
      solve(w);
      expect(w.engine, "le même moteur sur toute la partie").toBe(engine);
    }
    // Le chapitre 5 rend la main au début du chapitre 6, dont l'introduction attend les choix du joueur.
    expect(chapters).toEqual([1, 2, 3, 4, 5]);
    expect(w.state.chapter).toBe(6);
    playChapter6Intro(w);
    expect(w.room).toBe(102);
    expect(w.host.exits).toBe(0);
    solveChapter6(w);
    expect(w.host.exits).toBe(1);
    expect(w.engine.ended).toBe(true);
    expect(w.engine).toBe(engine);
  });
});
