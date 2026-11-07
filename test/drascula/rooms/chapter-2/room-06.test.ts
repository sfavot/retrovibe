import { describe, expect, it } from "vitest";
import { Bedroom, Flag, Item } from "../../../../src/games/drascula/engine/rooms/chapter-2/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { go, objectIds, objectOf, startIn } from "./route";

/** Pièce 6, la chambre : le tiroir et le crucifix, l'armoire, la porte de la chapelle, la lumière. */
describe.skipIf(!hasOriginalFiles)("chapitre 2 : la chambre (pièce 6)", () => {
  it("les objets sont ceux de la fiche ; le crucifix est caché ; la porte est fermée", () => {
    const w = startIn(6, { arrival: Bedroom.Window });
    expect(objectIds(w)).toEqual([137, 138, 139, 143, 140, 144, 999]);
    expect(objectOf(w, Bedroom.Crucifix).visible).toBe(false);
    expect(objectOf(w, Bedroom.Door).isDoor).toBe(false);
    expect(w.host.music.at(-1)).toBe(27);
  });

  it("le candélabre : deux répliques (41, 42) ; prendre le candélabre : roomActions (43)", () => {
    const w = startIn(6);
    let mark = w.mark();
    w.act(Verb.Look, Bedroom.Candelabra);
    expect(w.voices(mark)).toEqual(["41.als", "42.als"]);
    mark = w.mark();
    w.act(Verb.Pick, Bedroom.Candelabra);
    expect(w.voices(mark)).toEqual(["43.als"]);
  });

  it("ouvrir la porte : le son 3, le drapeau 0 ; la fermer : le son 4 ; fermée, elle ne laisse pas passer", () => {
    const w = startIn(6);
    w.goTo(Bedroom.Door);
    expect(w.room).toBe(6);
    let mark = w.mark();
    w.act(Verb.Open, Bedroom.Door);
    expect(w.voices(mark)).toEqual(["s3.als"]);
    expect(w.flags[Flag.BedroomDoorOpen]).toBe(1);
    mark = w.mark();
    w.act(Verb.Close, Bedroom.Door);
    expect(w.voices(mark)).toEqual(["s4.als"]);
    expect(w.flags[Flag.BedroomDoorOpen]).toBe(0);
    w.act(Verb.Open, Bedroom.Door);
    go(w, Bedroom.Door, 7);
  });

  it("ouvrir le tiroir : le son 3, le crucifix apparaît et le tiroir disparaît ; ouvrir le crucifix : rien", () => {
    const w = startIn(6);
    const mark = w.mark();
    w.act(Verb.Open, Bedroom.Drawer);
    expect(w.voices(mark)).toEqual(["s3.als"]);
    expect(w.flags[Flag.DrawerOpen]).toBe(1);
    expect(objectOf(w, Bedroom.Crucifix).visible).toBe(true);
    expect(objectOf(w, Bedroom.Drawer).visible).toBe(false);
    const next = w.mark();
    w.act(Verb.Open, Bedroom.Crucifix);
    expect(w.voices(next)).toEqual([]);
  });

  it("prendre le crucifix : en main (objet 9), drapeau 10, il disparaît ; il reste caché au retour dans la pièce", () => {
    const w = startIn(6, { flags: { [Flag.DrawerOpen]: 1 } });
    expect(objectOf(w, Bedroom.Crucifix).visible).toBe(true);
    w.act(Verb.Pick, Bedroom.Crucifix);
    expect(w.state.pickedObject).toBe(Item.Cross);
    expect(w.flags[Flag.CrucifixTaken]).toBe(1);
    expect(objectOf(w, Bedroom.Crucifix).visible).toBe(false);
    w.selectVerb(Verb.None);
    w.player.perform(w.engine.enterRoom(6));
    expect(objectOf(w, Bedroom.Crucifix).visible).toBe(false);
    // Comme dans l'original, `updateVisible` ne cache plus le tiroir une fois le crucifix pris : l'objet du tiroir revient à la fiche.
    expect(objectOf(w, Bedroom.Drawer).visible).toBe(true);
  });

  it("l'armoire : ouvrir (son 3, drapeau 2), puis la fermer (son 4)", () => {
    const w = startIn(6);
    let mark = w.mark();
    w.act(Verb.Open, Bedroom.Wardrobe);
    expect(w.voices(mark)).toEqual(["s3.als"]);
    expect(w.flags[Flag.WardrobeOpen]).toBe(1);
    mark = w.mark();
    w.act(Verb.Close, Bedroom.Wardrobe);
    expect(w.voices(mark)).toEqual(["s4.als"]);
    expect(w.flags[Flag.WardrobeOpen]).toBe(0);
    expect(w.engine.gfx.owner).toBe("room");
  });

  it("la fenêtre mène au mur de la chapelle (5)", () => {
    go(startIn(6), Bedroom.Window, 5);
  });

  it("update_6_pre : la lumière est claire devant l'armoire (x entre 149 et 220, pieds entre 160 et 188), sombre ailleurs", () => {
    const w = startIn(6);
    const { palette } = w.engine.gfx;
    const light = (source: Int8Array) => Array.from(source.subarray(235 * 3, 253 * 3));
    w.hero.x = 180;
    w.hero.y = 170 - w.hero.height;
    w.engine.render();
    expect(light(palette.game)).toEqual(light(palette.bright));
    w.hero.x = 120;
    w.hero.y = 165 - w.hero.height;
    w.engine.render();
    expect(light(palette.game)).toEqual(light(palette.dark));
  });
});
