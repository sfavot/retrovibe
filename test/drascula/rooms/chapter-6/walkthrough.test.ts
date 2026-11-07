import { describe, expect, it } from "vitest";
import { Backroom, Bedroom, Corridor, Dungeon, Flag, Item, Tavern } from "../../../../src/games/drascula/engine/rooms/chapter-6/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { solveChapter6 } from "../../solutions";
import { startChapter6 } from "./start";

/**
 * Passage du chapitre 6 (le dernier) : la solution jouée à la souris et au clavier, du début du chapitre jusqu'à la fin du jeu.
 * Solution : prendre la lame (101) dans le cachot et couper les liens sur le pendule (100) ; dans le couloir pousser la torche (103) et
 * passer la porte dérobée (104) ; dans la chambre passer la porte (108) ; dans la taverne pousser le piano (112), parler au barman (52)
 * jusqu'à ce qu'il donne l'objet 21, le donner à Drascula (56), puis lui présenter l'objet 9 : la fin du jeu (`animation_9_6`, générique).
 * Le reste (B.J. et son téléphone, l'arrière-salle, les regards) est facultatif.
 */
describe.skipIf(!hasOriginalFiles)("chapitre 6 : passage", () => {
  it("la solution : du cachot du pendule à la fin du jeu", () => {
    const w = startChapter6();
    expect(w.state.chapter).toBe(6);
    expect(w.room).toBe(102);
    solveChapter6(w);
  });

  it("la partie complète : le téléphone de B.J., l'arrière-salle, le barman et ses trois choix, puis la fin", () => {
    const w = startChapter6();
    w.act(Verb.Pick, Dungeon.Reach);
    w.useItem(Item.Blade, Dungeon.Pendulum, 60_000);
    w.act(Verb.Look, Corridor.SecretDoor);
    w.act(Verb.Move, Corridor.Torch);
    w.selectVerb(Verb.None);
    w.goTo(Corridor.SecretDoor);
    expect(w.room).toBe(59);
    // B.J. : le téléphone sonne la première fois seulement.
    w.act(Verb.Talk, Bedroom.BJ, 60_000);
    expect(w.flags[Flag.PhoneCalled]).toBe(1);
    w.goTo(Bedroom.Door);
    expect(w.room).toBe(60);
    // L'arrière-salle et retour.
    w.goTo(Tavern.BackroomDoor);
    expect(w.room).toBe(61);
    w.act(Verb.Look, Backroom.Papers);
    w.goTo(Backroom.Door);
    expect(w.room).toBe(60);
    // Le barman, avant de pousser le piano : les trois premiers choix ne donnent rien.
    w.selectVerb(Verb.Talk);
    const barman = w.pointOf(Tavern.Barman);
    w.player.click(barman.x, barman.y);
    expect(w.choose(0)).toBe(true);
    expect(w.choose(1)).toBe(true);
    expect(w.choose(2)).toBe(true);
    expect(w.choose(3)).toBe(false);
    w.settle();
    expect(w.state.inventory).not.toContain(Item.Drink);
    // Le piano, puis le barman donne l'objet 21.
    w.act(Verb.Move, Tavern.Piano);
    w.selectVerb(Verb.Talk);
    w.player.click(barman.x, barman.y);
    expect(w.choose(2)).toBe(false);
    w.settle();
    expect(w.state.inventory).toContain(Item.Drink);
    // Drascula refuse d'abord l'objet 9, boit, puis la fin.
    w.useItem(Item.Stake, Tavern.Drascula, 60_000);
    expect(w.host.exits).toBe(0);
    w.useItem(Item.Drink, Tavern.Drascula, 60_000);
    w.useItem(Item.Stake, Tavern.Drascula, 100_000);
    expect(w.host.exits).toBe(1);
  });
});
