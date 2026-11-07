import { describe, expect, it } from "vitest";
import { Cupboard, Flag, Item, Study } from "../../../../src/games/drascula/engine/rooms/chapter-4/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { comparedPixels, render, speech, startIn } from "./support";

/** Pièce 35, l'armoire derrière le bureau : la cape, le cerveau, le déodorant (`room_35`, `update_35_pre`). */
describe.skipIf(!hasOriginalFiles)("chapitre 4 : l'armoire (pièce 35)", () => {
  const enter = (flags: Record<number, number> = {}) => startIn(35, { exit: Cupboard.Exit, flags: { [Flag.StudyWardrobe]: 1, ...flags } });
  const object = (w: ReturnType<typeof enter>, id: number) => w.engine.room.objects.find((o) => o.id === id)!;

  it("objets de la fiche ; le déodorant est caché, le reste visible", () => {
    const w = enter();
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([121, 147, 148, 149]);
    expect(object(w, Cupboard.Deodorant).visible).toBe(false);
    expect(object(w, Cupboard.Brain).visible).toBe(true);
    expect(object(w, Cupboard.Cape).visible).toBe(true);
    expect(w.host.music.at(-1)).toBe(15);
  });

  it("la sortie 121 ramène au bureau (sortie 120)", () => {
    const w = enter();
    w.goTo(Cupboard.Exit);
    expect(w.room).toBe(34);
    expect(w.state.objExit).toBe(120);
  });

  describe("la cape (148)", () => {
    it("l'objet 16 en main, drapeau 14, la cape n'est plus dans la pièce ; Igor reste (frites et farine manquent)", () => {
      const w = enter();
      expect(speech(w, () => w.act(Verb.Pick, Cupboard.Cape))).toEqual([]);
      expect(w.state.pickedObject).toBe(Item.Cape);
      expect(w.flags[Flag.CapeTaken]).toBe(1);
      expect(object(w, Cupboard.Cape).visible).toBe(false);
      expect(w.flags[Flag.Ready]).toBe(0);
    });

    it("avec les frites et la farine, Igor part (drapeau 18, i26)", () => {
      const w = enter({ [Flag.FriesTaken]: 1, [Flag.FlourTaken]: 1 });
      const mark = w.mark();
      w.act(Verb.Pick, Cupboard.Cape, 60_000);
      expect(w.flags[Flag.Ready]).toBe(1);
      expect(w.voices(mark)).toEqual(["i26.als"]);
      expect(w.state.inventory).toContain(Item.Cape);
    });

    it("la cape prise n'est plus là à la rentrée", () => {
      const w = enter({ [Flag.CapeTaken]: 1 });
      expect(object(w, Cupboard.Cape).visible).toBe(false);
    });
  });

  describe("le cerveau (147) puis le déodorant (149)", () => {
    it("prendre le cerveau : « Je vais prendre le plus gros » (426), objet 15, le déodorant apparaît", () => {
      const w = enter();
      expect(speech(w, () => w.act(Verb.Pick, Cupboard.Brain))).toEqual(["426.als"]);
      expect(w.state.pickedObject).toBe(Item.Brain);
      expect(w.flags[Flag.BrainTaken]).toBe(1);
      expect(w.flags[Flag.DeodorantVisible]).toBe(1);
      expect(object(w, Cupboard.Brain).visible).toBe(false);
      expect(object(w, Cupboard.Deodorant).visible).toBe(true);
    });

    it("prendre le déodorant : objet 13, il disparaît et n'est plus offert à la rentrée", () => {
      const w = enter({ [Flag.BrainTaken]: 1, [Flag.DeodorantVisible]: 1 });
      expect(object(w, Cupboard.Deodorant).visible).toBe(true);
      expect(object(w, Cupboard.Brain).visible).toBe(false);
      w.act(Verb.Pick, Cupboard.Deodorant);
      expect(w.state.pickedObject).toBe(Item.Deodorant);
      expect(w.flags[Flag.DeodorantVisible]).toBe(0);
      expect(object(w, Cupboard.Deodorant).visible).toBe(false);
      w.selectVerb(Verb.None);
      w.goTo(Cupboard.Exit);
      expect(w.room).toBe(34);
      w.goTo(Study.Wardrobe);
      expect(w.room).toBe(35);
      expect(object(w, Cupboard.Deodorant).visible).toBe(false);
    });

    it("le déodorant n'est pas à la portée de la main tant que le cerveau est là", () => {
      const w = enter();
      const hidden = object(w, Cupboard.Deodorant);
      w.selectVerb(Verb.Pick);
      w.clickAt(hidden.rect.x1 + 1, hidden.rect.y1 + 1);
      expect(w.flags[Flag.DeodorantVisible]).toBe(0);
    });
  });

  describe("le dessin", () => {
    it("update_35_pre : l'étagère vide, une fois le cerveau et le déodorant pris ; le fond (roomUpdates) est par-dessus", () => {
      const w = enter({ [Flag.BrainTaken]: 1, [Flag.DeodorantVisible]: 0 });
      w.hero.x = 250;
      const gfx = render(w);
      const { compared, mismatches } = comparedPixels(gfx, gfx.draw3, [111, 150, 118, 52, 40, 23], true, 3);
      expect(compared).toBeGreaterThan(30);
      expect(mismatches).toEqual([]);
    });

    it("avec le déodorant encore là (drapeau 17), c'est l'autre rectangle (70, 150) qui est dessiné", () => {
      const w = enter({ [Flag.BrainTaken]: 1, [Flag.DeodorantVisible]: 1 });
      w.hero.x = 250;
      const gfx = render(w);
      const { compared, mismatches } = comparedPixels(gfx, gfx.draw3, [70, 150, 118, 52, 40, 23], true, 3);
      expect(compared).toBeGreaterThan(30);
      expect(mismatches).toEqual([]);
    });
  });
});
