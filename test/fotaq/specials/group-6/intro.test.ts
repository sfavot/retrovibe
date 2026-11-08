import { describe, expect, it } from "vitest";
import { parseCredits } from "../../../../src/games/fotaq/data/credits";
import { hasOriginalFiles, readOriginal } from "../../helpers";
import { GROUP_SOLUTIONS } from "../../solutions";
import { Walkthrough } from "../../walkthrough";

const INTRO = ["COPY.CUT", "CLOGO.CUT", "CDINT.CUT", "CRED.CUT", "C70D.CUT"];
const introDone = (w: Walkthrough) => w.cutaways.played.includes("C70D.CUT") && w.idle;

describe.skipIf(!hasOriginalFiles)("groupe 6 : l'introduction (pièce 95, changeToSpecialRoom)", () => {
  it("se joue seule jusqu'à la première pièce jouable : COPY, CLOGO, CDINT, CRED, le hall de l'hôtel puis C70D", () => {
    const w = new Walkthrough({ ...GROUP_SOLUTIONS[6].start });
    GROUP_SOLUTIONS[6].solve!(w);
    expect(w.cutaways.played).toEqual(INTRO);
    // La pièce 73 a été affichée avec l'objet d'entrée 584, puis C70D finit dans la chambre (pièce 70).
    expect(w.room).toBe(70);
    expect(w.engine.gameState(117)).toBe(1);
    expect(w.engine.warnings).toEqual([]);
    expect(w.engine.input.cutawayRunning).toBe(false);
    expect(w.engine.scene).toBe(0);
    expect(w.stage.display.cursorVisible).toBe(true);
  }, 60_000);

  it("se saute par Échap : les mêmes cinématiques, au même état, en quelques secondes", () => {
    const w = new Walkthrough({ room: 95 });
    const ticks = w.skipUntil(() => introDone(w));
    expect(ticks).toBeLessThan(300);
    expect(w.cutaways.played).toEqual(INTRO);
    expect(w.room).toBe(70);
    expect(w.engine.gameState(117)).toBe(1);
    expect(w.engine.warnings).toEqual([]);
    expect(w.stage.display.cursorVisible).toBe(true);
    expect(w.engine.scene).toBe(0);
  });

  it("ne se rejoue pas : revenir à la pièce 95 une fois jouée l'affiche comme une pièce ordinaire", () => {
    const w = new Walkthrough({ room: 95, states: { 117: 1 } });
    w.settle(2_000);
    expect(w.cutaways.played).toEqual([]);
    expect(w.room).toBe(95);
  });

  it("le générique de début (#credit1.crd, CRED) s'affiche pendant l'introduction", () => {
    const w = new Walkthrough({ room: 95 });
    const seen = new Set<string>();
    w.until(() => {
      for (let y = 1; y < 200; y++) seen.add(w.stage.display.textAt(y).text);
      return introDone(w);
    }, 20_000);
    const first = parseCredits(readOriginal("CREDIT1.CRD")).pages[0].lines[0].text;
    expect(seen.has(first)).toBe(true);
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("générique de fin (C69G, #credit2.crd)", () => {
  it("se joue : la cinématique lance le générique, qui se déroule page après page jusqu'à la dernière, dans la pièce 110", () => {
    const w = new Walkthrough({ room: 69 });
    w.settle();
    const pages = parseCredits(readOriginal("CREDIT2.CRD")).pages;
    const lastLine = pages[pages.length - 1].lines.at(-1)!.text;
    const seen = new Set<string>();
    w.engine.run(w.engine.playCutaway("C69G.CUT"));
    // Le générique se déroule pendant les mouvements du groupe 5 que joue C69G, surtout le dirigeable (29, ~2 100 images), dans la
    // pièce 110, avant que le mouvement 14 ne termine la partie (pas de retour à la pièce après le générique de fin).
    w.until(() => {
      for (let y = 1; y < 200; y++) if (w.stage.display.textAt(y).text) seen.add(w.stage.display.textAt(y).text);
      return seen.has(lastLine);
    }, 30_000, "la dernière page du générique");
    const missing = pages.flatMap((page) => page.lines.map((line) => line.text)).filter((text) => text.trim() !== "" && !seen.has(text));
    expect(missing).toEqual([]);
    expect(w.room).toBe(110);
    expect(w.engine.warnings).toEqual([]);
  }, 60_000);
});
