import { describe, expect, it } from "vitest";
import { Flag, Street } from "../../../../src/games/drascula/engine/rooms/chapter-2/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { go, objectIds, objectOf, startIn } from "./route";

/** Pièce 12, la rue devant l'auberge : la porte, le balcon, le réverbère. */
describe.skipIf(!hasOriginalFiles)("chapitre 2 : la rue (pièce 12)", () => {
  it("les objets sont ceux de la fiche (le balcon a deux zones) ; la porte est ouverte au départ", () => {
    const w = startIn(12, { arrival: Street.ToMap });
    expect(objectIds(w)).toEqual([151, 154, 154, 155, 156, 158]);
    expect(w.flags[Flag.InnDoorOpen]).toBe(1);
    expect(objectOf(w, Street.Door).isDoor).toBe(true);
    expect([w.hero.width, w.hero.height]).toEqual([34, 55]);
  });

  it("regarder le balcon (329), lui parler (330), le réverbère (331 en parlant, 48 en le poussant)", () => {
    const w = startIn(12);
    for (const [verb, id, voice] of [
      [Verb.Look, Street.Balcony, "329.als"],
      [Verb.Talk, Street.Balcony, "330.als"],
      [Verb.Talk, 155, "331.als"],
      [Verb.Move, 155, "48.als"],
    ] as const) {
      const mark = w.mark();
      w.act(verb, id);
      expect(w.voices(mark), `verbe ${verb} sur ${id}`).toEqual([voice]);
    }
  });

  it("fermer la porte : le son 4, le drapeau 16 baisse, la porte ne laisse plus passer ; la rouvrir : le son 3", () => {
    const w = startIn(12);
    let mark = w.mark();
    w.act(Verb.Close, Street.Door);
    expect(w.voices(mark)).toEqual(["s4.als"]);
    expect(w.flags[Flag.InnDoorOpen]).toBe(0);
    w.goTo(Street.Door);
    expect(w.room).toBe(12);
    mark = w.mark();
    w.act(Verb.Open, Street.Door);
    expect(w.voices(mark)).toEqual(["s3.als"]);
    expect(w.flags[Flag.InnDoorOpen]).toBe(1);
    go(w, Street.Door, 14);
  });

  it("ouvrir la porte déjà ouverte : rien ne se passe (ni son ni excuse)", () => {
    const w = startIn(12);
    const mark = w.mark();
    w.act(Verb.Open, Street.Door);
    expect(w.voices(mark)).toEqual([]);
  });

  it("les autres sorties : la carte (10), l'arche (8)", () => {
    go(startIn(12), Street.ToMap, 10);
    go(startIn(12), Street.Arch, 8);
  });
});
