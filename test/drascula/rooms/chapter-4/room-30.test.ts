import { describe, expect, it } from "vitest";
import { Flag, Item, Pantry } from "../../../../src/games/drascula/engine/rooms/chapter-4/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { comparedPixels, render, speech, startIn } from "./support";

/** Pièce 30, le garde-manger : la porte, l'armoire aux gonds rouillés, la farine (`room_30`). */
describe.skipIf(!hasOriginalFiles)("chapitre 4 : le garde-manger (pièce 30)", () => {
  const enter = (flags: Record<number, number> = {}, items: readonly number[] = []) =>
    startIn(30, { exit: Pantry.DoorToKitchen, flags: { [Flag.DoorPantry]: 1, ...flags }, items });
  const object = (w: ReturnType<typeof enter>, id: number) => w.engine.room.objects.find((o) => o.id === id)!;

  it("objets de la fiche ; la porte 115 est ouverte (on arrive par elle)", () => {
    const w = enter();
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([115, 144, 157, 158, 159]);
    expect(object(w, Pantry.DoorToKitchen).isDoor).toBe(true);
    expect(w.host.music.at(-1)).toBe(15);
  });

  it("la porte 115 se ferme (son 4), se rouvre (son 3) et ramène à la cuisine (sortie 114)", () => {
    const w = enter();
    let mark = w.mark();
    w.act(Verb.Close, Pantry.DoorToKitchen);
    expect(w.voices(mark)).toEqual(["s4.als"]);
    expect(w.flags[Flag.DoorPantry]).toBe(0);
    expect(object(w, Pantry.DoorToKitchen).isDoor).toBe(false);
    mark = w.mark();
    w.act(Verb.Open, Pantry.DoorToKitchen);
    expect(w.voices(mark)).toEqual(["s3.als"]);
    w.goTo(Pantry.DoorToKitchen);
    expect(w.room).toBe(29);
    expect(w.state.objExit).toBe(114);
  });

  describe("l'armoire (144)", () => {
    it("les gonds sont rouillés : « Les gonds sont rouillés » (422), l'armoire reste fermée", () => {
      const w = enter();
      expect(speech(w, () => w.act(Verb.Open, Pantry.Wardrobe))).toEqual(["422.als"]);
      expect(w.flags[Flag.PantryWardrobeOpen]).toBe(0);
      expect(w.flags[Flag.FlourTaken]).toBe(0);
    });

    it("le déodorant (13) sur l'armoire : « Ça a enlevé la rouille » (424), drapeau 19 ; le déodorant reste en main (jamais consommé)", () => {
      const w = enter({}, [Item.Deodorant]);
      expect(speech(w, () => w.useItem(Item.Deodorant, Pantry.Wardrobe))).toEqual(["424.als"]);
      expect(w.flags[Flag.HingesOiled]).toBe(1);
      expect(w.state.pickedObject).toBe(Item.Deodorant);
    });

    it("un autre objet sur l'armoire : réponse par défaut", () => {
      const w = enter({}, [Item.Key]);
      expect(speech(w, () => w.useItem(Item.Key, Pantry.Wardrobe))).toEqual(["11.als"]);
      expect(w.flags[Flag.HingesOiled]).toBe(0);
    });

    it("dégrippée, la première ouverture : son 3, « un pot de farine » (423), la farine (12) en main, drapeaux 22 et 16", () => {
      const w = enter({ [Flag.HingesOiled]: 1 });
      const mark = w.mark();
      w.act(Verb.Open, Pantry.Wardrobe);
      expect(w.voices(mark)).toEqual(["s3.als", "423.als"]);
      expect(w.flags[Flag.PantryWardrobeOpen]).toBe(1);
      expect(w.flags[Flag.FlourTaken]).toBe(1);
      expect(w.state.pickedObject).toBe(Item.Flour);
      expect(w.flags[Flag.Ready]).toBe(0);
    });

    it("la farine prise, les frites et la cape déjà dans l'inventaire : Igor s'en va (drapeau 18, i26) et la farine est rangée", () => {
      const w = enter({ [Flag.HingesOiled]: 1, [Flag.FriesTaken]: 1, [Flag.CapeTaken]: 1 });
      const mark = w.mark();
      w.act(Verb.Open, Pantry.Wardrobe, 60_000);
      expect(w.voices(mark)).toEqual(["s3.als", "423.als", "i26.als"]);
      expect(w.flags[Flag.Ready]).toBe(1);
      expect(w.state.takeObject).toBe(false);
      expect(w.state.inventory).toContain(Item.Flour);
      expect(w.room).toBe(30);
    });

    it("l'armoire se ferme (son 4) et se rouvre (son 3) sans redonner de farine", () => {
      const w = enter({ [Flag.HingesOiled]: 1 });
      w.act(Verb.Open, Pantry.Wardrobe);
      w.selectVerb(Verb.None);
      let mark = w.mark();
      w.act(Verb.Close, Pantry.Wardrobe);
      expect(w.voices(mark)).toEqual(["s4.als"]);
      expect(w.flags[Flag.PantryWardrobeOpen]).toBe(0);
      mark = w.mark();
      w.act(Verb.Open, Pantry.Wardrobe);
      expect(w.voices(mark)).toEqual(["s3.als"]);
      expect(w.flags[Flag.PantryWardrobeOpen]).toBe(1);
    });
  });

  it.each([
    [Verb.Open, 157, "468.als"],
    [Verb.Look, 158, "469.als"],
  ])("verbe %i sur l'objet %i : roomActions (%s)", (verb, id, voice) => {
    const w = enter();
    expect(speech(w, () => w.act(verb, id))).toEqual([voice]);
  });

  describe("le dessin", () => {
    it("l'armoire ouverte (drapeau 16) et la porte ouverte (drapeau 4) sont des rectangles de roomPreUpdates", () => {
      const w = enter({ [Flag.PantryWardrobeOpen]: 1 });
      w.hero.x = 240;
      const gfx = render(w);
      for (const rect of [[37, 173, 109, 84, 20, 26], [1, 148, 148, 66, 35, 51]] as const) {
        const { compared, mismatches } = comparedPixels(gfx, gfx.draw3, rect, true, 3);
        expect(compared).toBeGreaterThan(20);
        expect(mismatches).toEqual([]);
      }
    });
  });
});
