import { describe, expect, it } from "vitest";
import { ChapelWall, Flag, Item } from "../../../../src/games/drascula/engine/rooms/chapter-2/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { go, objectIds, objectOf, startIn } from "./route";

/** Pièce 5, le mur de la chapelle : la fenêtre, le piton, l'escalade (`animation_5_2`, `animation_2_2`). */
describe.skipIf(!hasOriginalFiles)("chapitre 2 : le mur de la chapelle (pièce 5)", () => {
  it("les objets sont ceux de la fiche ; la fenêtre est fermée au départ (pas une porte)", () => {
    const w = startIn(5, { arrival: ChapelWall.ToCemetery });
    expect(objectIds(w)).toEqual([135, 136, 213, 212]);
    expect(objectOf(w, ChapelWall.Window).isDoor).toBe(false);
    expect([w.hero.width, w.hero.height]).toEqual([39, 64]);
  });

  it("regarder la fenêtre bloquée : « si seulement cette fenêtre n'était pas bloquée » (14)", () => {
    const w = startIn(5);
    const mark = w.mark();
    w.act(Verb.Look, ChapelWall.Window);
    expect(w.voices(mark)).toEqual(["14.als"]);
  });

  it("la fenêtre fermée refuse le passage : le héros reste dans la pièce", () => {
    const w = startIn(5);
    w.goTo(ChapelWall.Window);
    expect(w.room).toBe(5);
  });

  it("le piton sur la fenêtre : l'animation, le rire du héros (46), le piton disparaît, la fenêtre s'ouvre", () => {
    const w = startIn(5, { items: [Item.Spike] });
    const mark = w.mark();
    w.useItem(Item.Spike, ChapelWall.Window, 60_000);
    expect(w.flags[Flag.ChapelWindowOpen]).toBe(1);
    expect(w.voices(mark)).toEqual(["s1.als", "46.als"]);
    expect(w.state.inventory).not.toContain(Item.Spike);
    expect(w.state.takeObject).toBe(false);
    expect(w.engine.gfx.owner).toBe("room");
    // `isDoor` est remis à jour au clic sur la porte (`exitRoom` : `updateDoor`) : la fenêtre s'ouvre alors.
    go(w, ChapelWall.Window, 6);
  });

  it("les feuilles du héros sont remises après la cinématique (le héros est de nouveau dessiné)", () => {
    const w = startIn(5, { items: [Item.Spike] });
    const before = Array.from(w.engine.gfx.front.pixels.subarray(0, 4000));
    w.useItem(Item.Spike, ChapelWall.Window, 60_000);
    expect(Array.from(w.engine.gfx.front.pixels.subarray(0, 4000))).toEqual(before);
  });

  it("passer la fenêtre ouverte : animation_2_2 (sons 2 puis 1 pour le hoquet), puis la chambre (6)", () => {
    const w = startIn(5, { flags: { [Flag.ChapelWindowOpen]: 1 } });
    const mark = w.mark();
    go(w, ChapelWall.Window, 6);
    expect(w.voices(mark)).toEqual(["s2.als", "s1.als"]);
    expect(w.engine.gfx.shake).toBeNull();
  });

  it("la lune et l'autre fenêtre : roomActions", () => {
    const w = startIn(5);
    const mark = w.mark();
    w.act(Verb.Look, 212);
    expect(w.voices(mark)).toEqual(["187.als"]);
  });

  it("la sortie mène au cimetière (3)", () => {
    go(startIn(5), ChapelWall.ToCemetery, 3);
  });
});
