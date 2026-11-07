import { describe, expect, it } from "vitest";
import { Item, Outside } from "../../../../src/games/drascula/engine/rooms/chapter-4/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";
import { speech } from "./support";

/** L'inventaire du chapitre 4 : `roomActions` de la pseudo-pièce 200, combinaisons et regards de `checkAction`, le héros (201). */
describe.skipIf(!hasOriginalFiles)("chapitre 4 : l'inventaire", () => {
  const start = (...items: number[]) => {
    const w = new Walkthrough({ chapter: 4 });
    for (const item of items) w.engine.addObject(item);
    return w;
  };

  it("on commence avec le téléphone, la croix, l'ail et la pièce (objets 28, 9, 20, 22)", () => {
    const w = start();
    expect(w.state.inventory.filter((item) => item >= 7)).toEqual([28, 9, 20, 22]);
  });

  it.each([
    [Item.Phone, ["328.als"]],
    [Item.Reefer, ["162.als"]],
    [Item.Coin, ["161.als"]],
    [Item.Key, ["478.als"]],
    [Item.LivingRoomKey, ["478.als"]],
    [Item.Fries, ["480.als"]],
    [Item.Wig, ["485.als"]],
    [Item.Axe, ["488.als"]],
    [Item.Flour, ["486.als"]],
    [Item.Deodorant, ["490.als"]],
    [Item.Stake, ["122.als"]],
    [Item.Brain, ["117.als"]],
    [Item.Cape, ["491.als"]],
    [Item.Branch, ["493.als"]],
    [Item.Grapnel, ["496.als"]],
  ])("regarder l'objet %i dans l'inventaire : %j (roomActions 200)", (item, voices) => {
    const w = start(item);
    expect(speech(w, () => w.verbOnItem(Verb.Look, item))).toEqual(voices);
    expect(w.state.menuScreen).toBe(false);
  });

  it("le cerveau : parler (118) et ouvrir (119) ont leurs répliques", () => {
    const w = start(Item.Brain);
    expect(speech(w, () => w.verbOnItem(Verb.Talk, Item.Brain))).toEqual(["118.als"]);
    expect(speech(w, () => w.verbOnItem(Verb.Open, Item.Brain))).toEqual(["119.als"]);
  });

  describe("checkAction du chapitre 4 (inventaire ouvert)", () => {
    it("regarder la croix (9) : « Comme je m'amuse à tuer des vampires avec ce truc ! » (482, 483)", () => {
      const w = start();
      expect(speech(w, () => w.verbOnItem(Verb.Look, Item.Cross))).toEqual(["482.als", "483.als"]);
    });

    it("regarder la corde (19) : « Une corde dans un jeu d'aventure ! » (494, 495)", () => {
      const w = start(Item.Rope);
      expect(speech(w, () => w.verbOnItem(Verb.Look, Item.Rope))).toEqual(["494.als", "495.als"]);
    });

    it.each([
      ["la branche sur la corde", Item.Branch, Item.Rope],
      ["la corde sur la branche", Item.Rope, Item.Branch],
    ])("%s : le grappin (21) est en main, la branche et la corde ont disparu", (_label, first, second) => {
      const w = start(Item.Branch, Item.Rope);
      w.combine(first, second);
      expect(w.state.pickedObject).toBe(Item.Grapnel);
      expect(w.state.takeObject).toBe(true);
      expect(w.state.inventory).not.toContain(Item.Branch);
      expect(w.state.inventory).not.toContain(Item.Rope);
      expect(w.state.menuScreen).toBe(false);
    });

    it("un autre mariage d'objets : réponses de roomActions (le pieu et la corde : 484) ou par défaut", () => {
      const w = start(Item.Stake, Item.Rope, Item.Axe);
      expect(speech(w, () => w.combine(Item.Stake, Item.Rope))).toEqual(["484.als"]);
      w.selectVerb(Verb.None);
      expect(speech(w, () => w.combine(Item.Axe, Item.Rope))).toEqual(["11.als"]);
      expect(w.state.inventory).toContain(Item.Rope);
    });
  });

  describe("le héros (objet 50, roomActions 201)", () => {
    const hero = (w: Walkthrough) => ({ x: w.hero.x + Math.trunc(w.hero.width / 2), y: w.hero.y + Math.trunc(w.hero.height / 2) });

    it.each([
      [Verb.Look, "309.als"],
      [Verb.Open, "310.als"],
      [Verb.Close, "311.als"],
      [Verb.Move, "312.als"],
      [Verb.Pick, "313.als"],
      [Verb.Talk, "314.als"],
    ])("le verbe %i sur le héros : %s", (verb, voice) => {
      const w = start();
      w.selectVerb(verb);
      const mark = w.mark();
      const at = hero(w);
      w.clickAt(at.x, at.y);
      expect(w.voices(mark)).toEqual([voice]);
    });

    it("la croix sur le héros : « Non, il faut que ce soit avec un sale et puant vampire » (484)", () => {
      const w = start();
      w.takeItem(Item.Cross);
      const mark = w.mark();
      const at = hero(w);
      w.clickAt(at.x, at.y);
      expect(w.voices(mark)).toEqual(["484.als"]);
    });
  });

  it("un objet sur le mur du château sans être le grappin : réponse par défaut ; le grappin ne se combine pas", () => {
    const w = start(Item.Axe);
    expect(speech(w, () => w.useItem(Item.Axe, Outside.Wall))).toEqual(["11.als"]);
  });
});
