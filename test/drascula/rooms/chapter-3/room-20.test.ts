import { describe, expect, it } from "vitest";
import { Flag, Item, Start } from "../../../../src/games/drascula/engine/rooms/chapter-3/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";

/**
 * Pièce 20, la pièce de départ du chapitre 3 : ni `room_20` ni `update_20` dans ScummVM ; la porte vers la pièce 13, les réponses par
 * défaut du chapitre et le rectangle d'avant-plan de `roomUpdates`.
 */
describe.skipIf(!hasOriginalFiles)("chapitre 3 : la pièce de départ (pièce 20)", () => {
  it("le chapitre commence en pièce 20 : inventaire, drapeau 1, héros tourné vers la droite", () => {
    const w = new Walkthrough({ chapter: 3 });
    expect(w.state.chapter).toBe(3);
    expect(w.room).toBe(20);
    // `addObject` : téléphone, bouchons, faucille, sac, croix, joint, pièce (28, 11, 14, 22, 9, 20, 19).
    expect(w.state.inventory.slice(7, 14)).toEqual([28, 11, 14, 22, 9, 20, 19]);
    expect(w.flags.slice(0, 4)).toEqual([0, 1, 0, 0]);
    expect(w.state.objExit).toBe(Start.Arrival);
    expect(w.host.music[0]).toBe(7);
  });

  it("les objets sont ceux de la fiche : la porte 100 et l'arrivée 99 (invisible)", () => {
    const w = new Walkthrough({ chapter: 3 });
    expect(w.engine.room.objects.map((o) => [o.id, o.visible])).toEqual([
      [Start.Door, true],
      [Start.Arrival, false],
    ]);
  });

  it.each([Verb.Look, Verb.Move, Verb.Pick, Verb.Open, Verb.Close, Verb.Talk])(
    "verbe %i sur la porte : rien ne répond (une porte n'a pas de nom au survol, donc pas de réponse par défaut)",
    (verb) => {
      const w = new Walkthrough({ chapter: 3 });
      const mark = w.mark();
      w.act(verb, Start.Door);
      expect(w.voices(mark)).toEqual([]);
      expect(w.room).toBe(20);
    },
  );

  it("un objet de l'inventaire sur la porte : rien non plus, et on ne passe pas la porte", () => {
    const w = new Walkthrough({ chapter: 3 });
    const mark = w.mark();
    w.useItem(Item.Coin, Start.Door);
    expect(w.voices(mark)).toEqual([]);
    expect(w.room).toBe(20);
  });

  it("la porte mène à la pièce 13, où l'on arrive par la porte 101 ; aucune animation ne se lance", () => {
    const w = new Walkthrough({ chapter: 3 });
    w.goTo(Start.Door);
    expect(w.room).toBe(13);
    expect(w.state.objExit).toBe(101);
    expect(w.flags[Flag.VampireWoke]).toBe(0);
    expect(w.host.music[0]).toBe(7);
  });

  it("l'avant-plan de la pièce (roomUpdates) est dessiné par-dessus le héros", () => {
    const w = new Walkthrough({ chapter: 3 });
    w.player.move(319, 0);
    w.wait(40);
    w.engine.render();
    const { screen, draw3 } = w.engine.gfx;
    // `roomUpdates` : 213 x 61 pixels de la feuille annexe en (1, 137), copiés en (106, 121), transparent 255.
    let compared = 0;
    for (let y = 0; y < 61; y += 6) {
      for (let x = 0; x < 213; x += 9) {
        const source = draw3.at(1 + x, 137 + y);
        if (source === 255) continue;
        expect(screen.at(106 + x, 121 + y)).toBe(source);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(20);
  });
});
