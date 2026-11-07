import { describe, expect, it } from "vitest";
import {
  Bedroom,
  Corridor,
  Flag,
  Hall,
  Item,
  Landing,
  Maze,
  Outside,
  Study,
} from "../../../../src/games/drascula/engine/rooms/chapter-4/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { climb, disguise, gatherTheDisguise, getTheGrapnel, intoTheCastle, solveChapter4 } from "../../solutions";
import { Walkthrough } from "../../walkthrough";

/**
 * Passage du chapitre 4 : la solution jouée à la souris et au clavier, du pied du château jusqu'au début du chapitre 5.
 *
 * Solution : prendre la corde (21) ; à l'arbre (22) donner la pièce à la pie, prendre la clé ; ouvrir la porte du château (hall, 23) ;
 * fermer la porte derrière soi pour prendre les frites ; le bureau (34) par le grand couloir (27), l'armoire du bureau (35) pour la
 * cape, le cerveau et le déodorant ; le déodorant dégrippe l'armoire du garde-manger (30), qui donne la farine ; Igor s'en va ; sa
 * chambre (26) : la perruque, puis un objet du déguisement sur le héros ; sur le palier (24) le déguisement s'en va et laisse la clé du
 * salon ; le salon (31) donne la hache ; la hache coupe la branche (22) ; la branche et la corde font le grappin ; le grappin sur le mur (21).
 */
describe.skipIf(!hasOriginalFiles)("chapitre 4 : passage", () => {
  it("la solution du chapitre 4 : de la corde au grappin sur le mur, et le chapitre 5 commence", () => {
    const w = new Walkthrough({ chapter: 4 });
    expect(w.state.chapter).toBe(4);
    expect(w.room).toBe(21);
    solveChapter4(w);
    // Le chapitre 5 commence avec son propre inventaire.
    expect(w.state.inventory).toContain(Item.Phone);
  });

  it("la partie complète : conversation avec Igor, perruque refusée, pièce sombre, passage secret, puis la solution", () => {
    const w = new Walkthrough({ chapter: 4 });
    intoTheCastle(w);
    // Le grand couloir : l'aile ouest est interdite, la porte 110 mène à la pièce sombre.
    w.act(Verb.Open, Hall.DoorToLanding);
    w.goTo(Hall.DoorToLanding);
    w.act(Verb.Open, Landing.DoorToBedroom);
    // Igor : il se lève, on parle, on le quitte ; la perruque est défendue.
    w.goTo(Landing.DoorToBedroom);
    expect(w.room).toBe(26);
    w.selectVerb(Verb.Talk);
    const igor = w.pointOf(Bedroom.Igor);
    w.player.click(igor.x, igor.y);
    expect(w.choose(3)).toBe(false);
    w.settle();
    expect(w.flags[Flag.IgorMet]).toBe(1);
    const mark = w.mark();
    w.act(Verb.Pick, Bedroom.Wig);
    expect(w.voices(mark)).toEqual(["i25.als"]);
    expect(w.flags[Flag.WigTaken]).toBe(0);
    w.goTo(Bedroom.Door);
    expect(w.room).toBe(24);
    w.goTo(Landing.Stairs);
    expect(w.room).toBe(27);
    w.act(Verb.Talk, Corridor.WestWing);
    w.act(Verb.Open, Corridor.DoorToCellar);
    w.goTo(Corridor.DoorToCellar);
    expect(w.room).toBe(28);
    w.act(Verb.Look, 200);
    w.goTo(111);
    expect(w.room).toBe(27);
    // Le passage secret : l'étagère du bureau s'ouvre, le couloir mène à la pièce 44 et ramène au bureau.
    w.goTo(Corridor.DoorToStudy);
    w.act(Verb.Move, Study.Torch, 5_000);
    expect(w.flags[Flag.Bookcase]).toBe(1);
    w.goTo(Study.Bookcase);
    expect(w.room).toBe(36);
    for (const door of [124, 126, 128, 130, 132, 134, 136, 138]) w.goTo(door);
    expect(w.room).toBe(44);
    w.goTo(Maze.Exit);
    expect(w.room).toBe(34);
    // La suite est la solution, depuis le bureau.
    w.goTo(Study.DoorToCorridor);
    w.goTo(Corridor.Stairs);
    w.goTo(Landing.DoorToHall);
    expect(w.room).toBe(23);
    gatherTheDisguise(w);
    disguise(w);
    getTheGrapnel(w);
    w.selectVerb(Verb.None);
    climb(w);
  });

  it("Échap pendant la montée au mur saute la vidéo : le chapitre 5 commence aussitôt", () => {
    const w = new Walkthrough({ chapter: 4 });
    w.engine.addObject(Item.Grapnel);
    w.takeItem(Item.Grapnel);
    const { x, y } = w.pointOf(Outside.Wall);
    w.player.click(x, y);
    w.until(() => w.engine.gfx.owner === "canvas"); // st.bin joue
    w.wait(20);
    w.key("Escape");
    w.settle(60_000);
    expect(w.state.chapter).toBe(5);
    expect(w.room).toBe(45);
  });
});
