import { describe, expect, it } from "vitest";
import { Flag, Hotel, Item } from "../../../../src/games/drascula/engine/rooms/chapter-2/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { go, objectIds, startIn } from "./route";

/** Pièce 16, la chambre d'hôtel : le coffre et le sac de B.J., le miroir, la porte. */
describe.skipIf(!hasOriginalFiles)("chapitre 2 : la chambre d'hôtel (pièce 16)", () => {
  it("les objets sont ceux de la fiche ; la musique est la 12 ; la porte est ouverte (drapeau 17 levé au début du chapitre)", () => {
    const w = startIn(16, { arrival: Hotel.Door });
    expect(objectIds(w)).toEqual([163, 183, 184, 185, 186, 187]);
    expect(w.host.music.at(-1)).toBe(12);
    expect(w.flags[Flag.HotelDoorOpen]).toBe(1);
  });

  it("l'armoire (37, 7, 38), le coffre regardé (340), la porte parlée (6) : roomActions", () => {
    const w = startIn(16);
    for (const [verb, id, voice] of [
      [Verb.Look, 185, "37.als"],
      [Verb.Pick, 185, "7.als"],
      [Verb.Talk, 185, "38.als"],
      [Verb.Look, Hotel.Chest, "340.als"],
      [Verb.Talk, Hotel.Door, "6.als"],
      [Verb.Talk, Hotel.Mirror, "345.als"],
    ] as const) {
      const mark = w.mark();
      w.act(verb, id);
      expect(w.voices(mark), `verbe ${verb} sur ${id}`).toEqual([voice]);
    }
  });

  it("ouvrir le coffre : le son 3, le drapeau 19, « j'ai trouvé le sac de B.J. » (342), le sac en main ; la seconde fois rien de plus", () => {
    const w = startIn(16);
    let mark = w.mark();
    w.act(Verb.Open, Hotel.Chest);
    expect(w.voices(mark)).toEqual(["s3.als", "342.als"]);
    expect(w.flags[Flag.ChestOpen]).toBe(1);
    expect(w.flags[Flag.HandbagTaken]).toBe(1);
    expect(w.state.pickedObject).toBe(Item.Handbag);
    w.selectVerb(Verb.None);
    mark = w.mark();
    w.act(Verb.Close, Hotel.Chest);
    expect(w.voices(mark)).toEqual(["s4.als"]);
    expect(w.flags[Flag.ChestOpen]).toBe(0);
    mark = w.mark();
    w.act(Verb.Open, Hotel.Chest);
    expect(w.voices(mark)).toEqual(["s3.als"]);
    expect(w.state.inventory.filter((item) => item === Item.Handbag).length).toBe(1);
  });

  it("parler au coffre : 341, le héros rit (50), puis le coffre répond (d83) ; le drapeau 19 est remis comme avant", () => {
    const w = startIn(16);
    const mark = w.mark();
    w.act(Verb.Talk, Hotel.Chest);
    expect(w.voices(mark)).toEqual(["341.als", "50.als", "d83.als"]);
    expect(w.flags[Flag.ChestOpen]).toBe(0);
  });

  it("le miroir : « je n'ai pas de reflet, je suis un vampire ! » (343), puis « ah non ! ce n'est qu'un dessin » (344)", () => {
    const w = startIn(16);
    const mark = w.mark();
    w.act(Verb.Look, Hotel.Mirror);
    expect(w.voices(mark)).toEqual(["343.als", "344.als"]);
    expect(w.hero.track).toBe(3);
  });

  it("la porte : la fermer (le son 4, elle ne laisse plus passer), l'ouvrir (le son 3), puis la franchir vers l'auberge (14)", () => {
    const w = startIn(16);
    let mark = w.mark();
    w.act(Verb.Close, Hotel.Door);
    expect(w.voices(mark)).toEqual(["s4.als"]);
    expect(w.flags[Flag.HotelDoorOpen]).toBe(0);
    w.goTo(Hotel.Door);
    expect(w.room).toBe(16);
    mark = w.mark();
    w.act(Verb.Open, Hotel.Door);
    expect(w.voices(mark)).toEqual(["s3.als"]);
    go(w, Hotel.Door, 14);
  });

  it("update_16_pre : le coffre ouvert est dessiné (drapeau 19), la porte fermée aussi (drapeau 17 bas)", () => {
    const w = startIn(16);
    const gfx = w.engine.gfx;
    const same = (dx: number, dy: number, sx: number, sy: number, width: number, height: number) => {
      let n = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (w.host.screen![(dy + y) * 320 + dx + x] === gfx.draw3.at(sx + x, sy + y)) n++;
      return n;
    };
    w.engine.render();
    expect(same(224, 115, 37, 151, 56, 47)).toBeLessThan(56 * 47);
    w.engine.flags[Flag.ChestOpen] = 1;
    w.engine.render();
    expect(same(224, 115, 37, 151, 56, 47)).toBe(56 * 47);
    w.engine.flags[Flag.HotelDoorOpen] = 0;
    w.engine.render();
    expect(same(24, 72, 1, 103, 33, 95)).toBe(33 * 95);
  });
});
