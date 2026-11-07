import { describe, expect, it } from "vitest";
import { Flag, Gate, Item, Start } from "../../../../src/games/drascula/engine/rooms/chapter-3/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { solveChapter3 } from "../../solutions";
import { Walkthrough } from "../../walkthrough";

/**
 * Passage du chapitre 3 : la solution jouée à la souris, de la pièce de départ jusqu'au début du chapitre 4. Solution : passer la porte
 * de la pièce 20, marcher jusqu'au vampire (il se réveille), lui montrer la croix (objet 9). Tout le reste (regarder, lui parler, lui
 * offrir la pièce) est facultatif.
 */
describe.skipIf(!hasOriginalFiles)("chapitre 3 : passage", () => {
  it("la solution minimale : la porte, puis la croix sur le vampire ; le chapitre 4 commence", () => {
    const w = new Walkthrough({ chapter: 3 });
    expect(w.state.chapter).toBe(3);
    expect(w.room).toBe(20);
    solveChapter3(w);
  });

  it("la partie complète du chapitre : on regarde, on parle, on offre la pièce, on fait un tour, puis la croix", () => {
    const w = new Walkthrough({ chapter: 3 });
    w.goTo(Start.Door);
    expect(w.room).toBe(13);
    // Le vampire se réveille dès que le héros s'avance ; le regarder, lui parler (dialogue 7), lui offrir la pièce.
    w.act(Verb.Look, Gate.Vampire);
    expect(w.flags[Flag.VampireWoke]).toBe(1);
    w.selectVerb(Verb.Talk);
    const talk = w.pointOf(Gate.Vampire);
    w.player.click(talk.x, talk.y);
    expect(w.choose(0)).toBe(true);
    expect(w.choose(1)).toBe(true);
    expect(w.choose(3)).toBe(false); // « Je ferais mieux de me taire » : le dialogue finit
    w.settle();
    w.useItem(Item.Coin, Gate.Vampire);
    // Un tour par la pièce de départ et retour.
    w.goTo(Gate.Door);
    expect(w.room).toBe(20);
    w.goTo(Start.Door);
    expect(w.room).toBe(13);
    // La croix.
    const mark = w.mark();
    w.useItem(Item.Cross, Gate.Vampire, 60_000);
    expect(w.state.chapter).toBe(4);
    expect(w.room).toBe(21);
    expect(w.voices(mark).length).toBeGreaterThan(0);
  });

  it("l'inventaire : la croix se regarde (roomActions 200) et se range", () => {
    const w = new Walkthrough({ chapter: 3 });
    const mark = w.mark();
    w.verbOnItem(Verb.Look, Item.Cross);
    expect(w.voices(mark)).toEqual(["147.als"]);
    expect(w.state.menuScreen).toBe(false);
  });
});
