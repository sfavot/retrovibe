import { describe, expect, it } from "vitest";
import { Inn } from "../../../../src/games/drascula/engine/rooms/chapter-1/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { solveChapter1 } from "../../solutions";
import { Walkthrough } from "../../walkthrough";

/**
 * Passage du chapitre 1 : la solution jouée à la souris et au clavier, de l'arrivée dans l'auberge jusqu'au début du chapitre 2.
 * Solution : parler au barman (la porte du fond s'ouvre), puis passer la porte du fond ; la cinématique de B.J. finit le chapitre.
 * Le reste de l'auberge (pianiste, ivrogne, objets, arrière-salle) est facultatif.
 */
describe.skipIf(!hasOriginalFiles)("chapitre 1 : passage", () => {
  it("la solution minimale : le barman, puis la porte du fond ; le chapitre 2 commence", () => {
    const w = new Walkthrough();
    solveChapter1(w);
  });

  it("la partie complète du chapitre : on parle à tout le monde, on regarde, puis on passe", () => {
    const w = new Walkthrough();
    // L'ivrogne : les trois choix.
    w.selectVerb(Verb.Talk);
    const drunk = w.pointOf(Inn.Drunk);
    w.player.click(drunk.x, drunk.y);
    expect(w.choose(0)).toBe(true);
    expect(w.choose(1)).toBe(true);
    expect(w.choose(2)).toBe(true);
    expect(w.choose(3)).toBe(false);
    w.settle();
    // Le pianiste, les affiches, la tête de mort, puis l'arrière-salle et le retour.
    w.act(Verb.Talk, Inn.Pianist);
    w.act(Verb.Look, Inn.Skull);
    w.act(Verb.Look, Inn.Poster1);
    w.goTo(Inn.Toilets);
    expect(w.room).toBe(63);
    w.act(Verb.Look, 110);
    w.goTo(107);
    expect(w.room).toBe(62);
    w.act(Verb.Talk, Inn.Barman);
    w.goTo(Inn.Back, 60_000);
    expect(w.state.chapter).toBe(2);
    expect(w.room).toBe(14);
  });

  it("Échap saute la cinématique de B.J. : le chapitre 2 commence aussitôt après", () => {
    const w = new Walkthrough();
    w.act(Verb.Talk, Inn.Barman);
    w.selectVerb(Verb.None);
    const { x, y } = w.pointOf(Inn.Back);
    w.player.click(x, y);
    w.until(() => w.engine.gfx.owner === "canvas"); // la cinématique est lancée (ag.bin)
    w.wait(100);
    w.key("Escape");
    w.settle(60_000);
    expect(w.state.chapter).toBe(2);
    expect(w.room).toBe(14);
  });

  it("l'inventaire : le téléphone se regarde (roomActions 200) et se range", () => {
    const w = new Walkthrough();
    expect(w.state.inventory).toContain(28);
    const mark = w.mark();
    w.verbOnItem(Verb.Look, 28);
    expect(w.voices(mark)).toEqual(["328.als"]);
    expect(w.state.menuScreen).toBe(false);
  });

  it("un objet de l'inventaire sur un objet de la pièce : réponse par défaut du chapitre (« Et pourquoi ? »)", () => {
    const w = new Walkthrough();
    const mark = w.mark();
    w.useItem(28, Inn.Skull);
    expect(w.voices(mark)).toEqual(["11.als"]);
  });
});
