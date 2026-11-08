import { describe, expect, it } from "vitest";
import { GROUPS } from "../../../../src/games/fotaq/engine/specials";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";

function start(room = 102): Walkthrough {
  const w = new Walkthrough({ room });
  w.settle();
  return w;
}

/** Joue le mouvement spécial `n` jusqu'au bout ; rend la durée en ticks. */
function play(w: Walkthrough, n: number): number {
  w.engine.run(w.engine.executeSpecialMove(n));
  return w.settle(2_000);
}

describe.skipIf(!hasOriginalFiles)("groupe 3 : mouvements spéciaux du temple", () => {
  it("définit les mouvements 20, 24 et 33, et eux seuls", () => {
    expect(Object.keys(GROUPS[3].specialMoves!).map(Number)).toEqual([20, 24, 33]);
  });

  it("20 : la caméra quitte Joe, le décor défile jusqu'à 320 par pas de 16", () => {
    const w = start();
    w.engine.horizontalScroll = 0;
    expect(play(w, 20)).toBe(20);
    expect(w.engine.horizontalScroll).toBe(320);
    expect(w.stage.bobs.cameraBob).toBe(-1);
  });

  it("20 : un défilement déjà à 320 ne joue aucune image", () => {
    const w = start();
    w.engine.horizontalScroll = 320;
    play(w, 20);
    expect(w.engine.horizontalScroll).toBe(320);
  });

  it("24 : le défilement va vers Joe (abscisse moins 160) par pas de 16 vers la gauche, puis la caméra le suit", () => {
    const w = start();
    w.stage.bobs.bob(0).x = 200;
    w.engine.horizontalScroll = 320;
    expect(play(w, 24)).toBe(Math.ceil((320 - 40) / 16));
    expect(w.engine.horizontalScroll).toBe(40);
    expect(w.stage.bobs.cameraBob).toBe(0);
  });

  it("24 : vers la droite, une image de plus ; le défilement est borné à 0 et à 320", () => {
    const w = start();
    w.stage.bobs.bob(0).x = 100;
    w.stage.bobs.cameraBob = -1;
    w.engine.horizontalScroll = 100;
    // Joe à 100 : cible 0 (bornée), vers la gauche.
    play(w, 24);
    expect(w.engine.horizontalScroll).toBe(0);
    w.stage.bobs.bob(0).x = 600;
    expect(play(w, 24)).toBe(Math.ceil(320 / 16) + 1);
    expect(w.engine.horizontalScroll).toBe(320);
    expect(w.stage.bobs.cameraBob).toBe(0);
  });

  it("33 : Joe ne dit rien avant la quatrième tentative, puis se plaint et le compteur repart de zéro", () => {
    const w = start();
    for (let i = 1; i <= 3; i++) {
      const mark = w.mark();
      play(w, 33);
      expect(w.engine.state.puzzleAttemptCount).toBe(i);
      expect(w.voices(mark)).toEqual([]);
    }
    const mark = w.mark();
    play(w, 33);
    expect(w.voices(mark).length).toBeGreaterThan(0);
    expect(w.engine.state.puzzleAttemptCount).toBe(0);
    play(w, 33);
    expect(w.engine.state.puzzleAttemptCount).toBe(1);
  });
});

describe.skipIf(!hasOriginalFiles)("groupe 3 : le puzzle des inscriptions (pièce 102), joué à la souris", () => {
  it("chaque inscription mal placée (`c102c`, `c102d`) appelle 33 ; à la quatrième Joe se plaint (description 226) et le compteur repart", () => {
    const w = new Walkthrough({ room: 102, voices: false });
    w.settle();
    // Le premier déplacement pose une inscription (`c102e`, sans erreur) ; le suivant, hors ordre, la fait retomber (`c102d`).
    const wrong = (): number => w.cutaways.played.filter((name) => /^c102[cd]\.CUT$/i.test(name)).length;
    let marks = 0;
    for (let move = 0; wrong() < 4; move++) {
      expect(move).toBeLessThan(20);
      if (wrong() === 3) marks = w.mark();
      w.act("Move", move % 2 === 0 ? 707 : 711);
      if (wrong() < 4) expect(w.engine.state.puzzleAttemptCount).toBe(wrong());
    }
    expect(w.engine.state.puzzleAttemptCount).toBe(0);
    expect(w.voices(marks)).toContain("JOE02661");
    expect(w.engine.gameState(185)).toBe(0);
    // Le compteur repart : l'erreur suivante est la première.
    w.act("Move", 707);
    w.act("Move", 711);
    expect(w.engine.state.puzzleAttemptCount).toBe(1);
  });
});
