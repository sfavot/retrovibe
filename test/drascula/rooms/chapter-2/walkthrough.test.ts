import { describe, expect, it } from "vitest";
import { Flag, Item } from "../../../../src/games/drascula/engine/rooms/chapter-2/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { solveChapter2 } from "../../solutions";
import { Walkthrough } from "../../walkthrough";
import {
  bookToPianist,
  chapelToHut,
  clickChoice,
  drunkTellsAboutVonBraun,
  earplugsOnHero,
  go,
  handbagAndCigarettes,
  innToLab,
  restOfIngredients,
  talkAndWaitForChoices,
  talkToVonBraun,
  tissuesAndSickle,
  wellFromChapel,
} from "./route";

/**
 * Passage du chapitre 2 : la solution jouée à la souris et au clavier, de l'arrivée dans l'auberge (pièce 14) jusqu'au début du
 * chapitre 3 (pièce 20). Étapes dans `route.ts`. Solution : l'ivrogne indique la cabane de Von Braun ; le sac de B.J. (chambre 16)
 * donne l'argent ; les cinq ingrédients (cigarettes du distributeur, mouchoirs, feuilles de la plante coupées à la faucille de
 * l'aveugle, chewing-gum, bougie) ; Von Braun laisse entrer, on lui prend le livre pour le pianiste, qui donne les bouchons
 * d'oreilles, avec lesquels on supporte l'épreuve ; Von Braun prépare la potion, qui ouvre le puits du cimetière.
 */
describe.skipIf(!hasOriginalFiles)("chapitre 2 : passage", () => {
  it("la solution complète : de l'auberge au chapitre 3", () => {
    const w = new Walkthrough({ chapter: 2 });
    expect(w.state.chapter).toBe(2);
    expect(w.room).toBe(14);
    expect(w.state.inventory).toContain(Item.Phone);
    solveChapter2(w);
  });

  it("la partie complète du chapitre : on parle à tout le monde, on regarde, on saute l'histoire de l'ivrogne, puis on passe", () => {
    const w = new Walkthrough({ chapter: 2 });
    // Le barman, le pianiste (menu OP_1), l'ivrogne : histoire de Von Braun sautée avec Échap, puis la cabane.
    w.act(Verb.Talk, 52);
    talkAndWaitForChoices(w, 54);
    expect(w.choose(0)).toBe(true);
    expect(w.choose(1)).toBe(true);
    expect(w.choose(2)).toBe(true);
    expect(w.choose(3)).toBe(false);
    w.settle();
    talkAndWaitForChoices(w, 53);
    w.choose(0);
    clickChoice(w, 1);
    w.until(() => w.engine.gfx.owner === "canvas", 60_000);
    w.wait(150);
    w.key("Escape");
    w.waitForChoices(60_000);
    expect(w.engine.gfx.owner).toBe("room");
    w.choose(2);
    w.choose(3);
    w.settle();
    expect(w.flags[Flag.HutKnown]).toBe(1);
    // Les affiches et la corbeille, puis le reste de la solution.
    w.act(Verb.Look, 200);
    w.act(Verb.Look, 204);
    handbagAndCigarettes(w);
    tissuesAndSickle(w);
    restOfIngredients(w);
    chapelToHut(w);
    // La conversation avec Von Braun derrière la porte : les trois autres choix d'abord.
    w.act(Verb.Open, 177, 60_000);
    talkAndWaitForChoices(w, 177);
    expect(w.choose(0)).toBe(true);
    expect(w.choose(2)).toBe(true);
    expect(w.choose(1)).toBe(false);
    w.settle(60_000);
    expect(w.flags[Flag.MetVonBraun]).toBe(1);
    expect(w.room).toBe(17);
    go(w, 177, 18);
    w.act(Verb.Pick, 182);
    w.selectVerb(Verb.None);
    bookToPianist(w);
    innToLab(w);
    earplugsOnHero(w);
    w.selectVerb(Verb.None);
    talkToVonBraun(w, 2);
    go(w, 177, 18);
    talkToVonBraun(w, 2);
    expect(w.flags[Flag.WellOpen]).toBe(1);
    w.selectVerb(Verb.None);
    go(w, 176, 2);
    go(w, 127, 3);
    go(w, 134, 5);
    go(w, 136, 6);
    go(w, 138, 7);
    wellFromChapel(w);
    expect(w.state.chapter).toBe(3);
    expect(w.room).toBe(20);
  });

  it("le puits est fermé tant que la potion n'est pas faite", () => {
    const w = new Walkthrough({ chapter: 2 });
    drunkTellsAboutVonBraun(w);
    handbagAndCigarettes(w);
    tissuesAndSickle(w);
    restOfIngredients(w);
    expect(w.flags[Flag.WellOpen]).toBe(0);
    go(w, 164, 19);
    w.goTo(173);
    expect(w.room).toBe(19);
    expect(w.state.chapter).toBe(2);
  });
});
