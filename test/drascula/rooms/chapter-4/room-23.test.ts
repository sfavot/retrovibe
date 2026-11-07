import { describe, expect, it } from "vitest";
import { Flag, Hall, Item } from "../../../../src/games/drascula/engine/rooms/chapter-4/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { comparedPixels, render, speech, startIn } from "./support";

/** Pièce 23, le hall : les deux portes, les frites cachées par la porte ouverte (`room_23`, `update_23_pre`). */
describe.skipIf(!hasOriginalFiles)("chapitre 4 : le hall (pièce 23)", () => {
  const enter = (flags: Record<number, number> = {}, exit = Hall.DoorToOutside) =>
    startIn(23, { exit, flags: { [Flag.DoorOutside]: 1, [Flag.OutsideUnlocked]: 1, ...flags } });
  const object = (w: ReturnType<typeof enter>, id: number) => w.engine.room.objects.find((o) => o.id === id)!;

  it("objets de la fiche ; on arrive par la porte 103, ouverte ; les frites sont cachées derrière", () => {
    const w = enter();
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([103, 104, 142, 170, 170, 171, 174]);
    expect(object(w, Hall.DoorToOutside).isDoor).toBe(true);
    expect(object(w, Hall.DoorToLanding).isDoor).toBe(false);
    expect(object(w, Hall.Fries).visible).toBe(false);
    expect(w.host.music.at(-1)).toBe(15);
    expect(w.hero.x + Math.trunc(w.hero.width / 2)).toBeGreaterThan(230);
  });

  it("fermer la porte 103 (son 4) fait apparaître les frites ; l'ouvrir (son 3) les recache", () => {
    const w = enter();
    let mark = w.mark();
    w.act(Verb.Close, Hall.DoorToOutside);
    expect(w.voices(mark)).toEqual(["s4.als"]);
    expect(w.flags[Flag.DoorOutside]).toBe(0);
    expect(object(w, Hall.DoorToOutside).isDoor).toBe(false);
    expect(object(w, Hall.Fries).visible).toBe(true);
    mark = w.mark();
    w.act(Verb.Open, Hall.DoorToOutside);
    expect(w.voices(mark)).toEqual(["s3.als"]);
    expect(w.flags[Flag.DoorOutside]).toBe(1);
    expect(object(w, Hall.Fries).visible).toBe(false);
  });

  it("la porte 103 ramène au pied du château (sortie 101) quand elle est ouverte", () => {
    const w = enter();
    w.goTo(Hall.DoorToOutside);
    expect(w.room).toBe(21);
    expect(w.state.objExit).toBe(101);
  });

  it("la porte 103 fermée ne se franchit pas", () => {
    const w = enter({ [Flag.DoorOutside]: 0 });
    w.goTo(Hall.DoorToOutside);
    expect(w.room).toBe(23);
  });

  describe("les frites en forme de crocs (142)", () => {
    it("prendre les frites : l'objet 8 est en main, drapeau 11, elles ne reviennent pas", () => {
      const w = enter({ [Flag.DoorOutside]: 0 });
      expect(object(w, Hall.Fries).visible).toBe(true);
      expect(speech(w, () => w.act(Verb.Pick, Hall.Fries))).toEqual([]);
      expect(w.state.pickedObject).toBe(Item.Fries);
      expect(w.flags[Flag.FriesTaken]).toBe(1);
      expect(object(w, Hall.Fries).visible).toBe(false);
      // La porte rouverte puis refermée ne les remet pas.
      w.act(Verb.Open, Hall.DoorToOutside);
      w.act(Verb.Close, Hall.DoorToOutside);
      expect(object(w, Hall.Fries).visible).toBe(false);
    });

    it("avec la farine et la cape déjà prises, Igor part : sa chambre est montrée, il dit sa réplique 26", () => {
      const w = enter({ [Flag.DoorOutside]: 0, [Flag.FlourTaken]: 1, [Flag.CapeTaken]: 1 });
      const mark = w.mark();
      w.act(Verb.Pick, Hall.Fries, 60_000);
      expect(w.flags[Flag.Ready]).toBe(1);
      expect(w.voices(mark)).toEqual(["i26.als"]);
      expect(w.room).toBe(23);
      expect(w.state.takeObject).toBe(false);
      expect(w.state.inventory).toContain(Item.Fries);
      expect(w.engine.gfx.owner).toBe("room");
    });

    it("avec seulement l'un des deux autres objets, Igor reste", () => {
      const w = enter({ [Flag.DoorOutside]: 0, [Flag.CapeTaken]: 1 });
      w.act(Verb.Pick, Hall.Fries);
      expect(w.flags[Flag.Ready]).toBe(0);
    });

    it("regarder les frites (inventaire) : « des frites en forme de crocs » (480)", () => {
      const w = enter({ [Flag.DoorOutside]: 0 });
      w.act(Verb.Pick, Hall.Fries);
      w.selectVerb(Verb.None);
      expect(speech(w, () => w.verbOnItem(Verb.Look, Item.Fries))).toEqual(["480.als"]);
    });
  });

  describe("la porte 104 vers le palier", () => {
    it("fermée au départ : l'ouvrir (flag 1, son 3) la rend franchissable, jusqu'au palier (sortie 105)", () => {
      const w = enter();
      w.act(Verb.Open, Hall.DoorToLanding);
      expect(w.flags[Flag.DoorLanding]).toBe(1);
      expect(object(w, Hall.DoorToLanding).isDoor).toBe(true);
      w.goTo(Hall.DoorToLanding);
      expect(w.room).toBe(24);
      expect(w.state.objExit).toBe(105);
    });

    it("la fermer : plus de passage", () => {
      const w = enter({ [Flag.DoorLanding]: 1 });
      expect(object(w, Hall.DoorToLanding).isDoor).toBe(true);
      w.act(Verb.Close, Hall.DoorToLanding);
      expect(w.flags[Flag.DoorLanding]).toBe(0);
      expect(object(w, Hall.DoorToLanding).isDoor).toBe(false);
    });
  });

  it("verbes sans gestionnaire : le portrait, la table et les enceintes (réponses par défaut)", () => {
    const w = enter();
    expect(speech(w, () => w.act(Verb.Look, 174))).toEqual(["100.als"]);
    expect(speech(w, () => w.act(Verb.Talk, 171))).toEqual(["16.als"]);
  });

  describe("le dessin (update_23_pre)", () => {
    it("la porte 103 ouverte est recopiée de la feuille annexe en (239, 94), sans le héros devant", () => {
      const w = enter();
      w.hero.x = 20;
      const gfx = render(w);
      const { compared, mismatches } = comparedPixels(gfx, gfx.draw3, [29, 126, 239, 94, 57, 73]);
      expect(compared).toBeGreaterThan(50);
      expect(mismatches).toEqual([]);
    });

    it("la porte 104 ouverte est recopiée en (7, 94) sans les pixels transparents ; fermée, rien", () => {
      const w = enter({ [Flag.DoorLanding]: 1 });
      w.hero.x = 150;
      let gfx = render(w);
      let result = comparedPixels(gfx, gfx.draw3, [1, 135, 7, 94, 27, 64], false, 3);
      expect(result.compared).toBeGreaterThan(30);
      expect(result.mismatches).toEqual([]);
      w.flags[Flag.DoorLanding] = 0;
      gfx = render(w);
      result = comparedPixels(gfx, gfx.draw3, [1, 135, 7, 94, 27, 64], false, 3);
      expect(result.mismatches.length).toBeGreaterThan(result.compared / 2);
    });

    it("le manque laissé par les frites prises est dessiné en (237, 110) quand la porte 103 est fermée", () => {
      const w = enter({ [Flag.DoorOutside]: 0, [Flag.FriesTaken]: 1 });
      w.hero.x = 20;
      const gfx = render(w);
      const { compared, mismatches } = comparedPixels(gfx, gfx.draw3, [87, 171, 237, 110, 20, 28], true, 3);
      expect(compared).toBeGreaterThan(30);
      expect(mismatches).toEqual([]);
    });
  });
});
