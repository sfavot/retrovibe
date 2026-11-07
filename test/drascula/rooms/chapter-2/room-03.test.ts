import { describe, expect, it } from "vitest";
import { Cemetery, Flag, Item } from "../../../../src/games/drascula/engine/rooms/chapter-2/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { go, objectIds, objectOf, startIn } from "./route";

/** Pièce 3, le cimetière : le barreau, la plante et la faucille, les tombes. */
describe.skipIf(!hasOriginalFiles)("chapitre 2 : le cimetière (pièce 3)", () => {
  it("les objets sont ceux de la fiche", () => {
    const w = startIn(3, { arrival: Cemetery.Path });
    expect(objectIds(w)).toEqual([124, 128, 129, 130, 131, 132, 133, 134, 165, 166, 211]);
    expect(w.host.music.at(-1)).toBe(10);
  });

  it("parler à la tombe 129 : le héros, puis il rit (voix 50, la bouche suit « 111111… »)", () => {
    const w = startIn(3);
    const mark = w.mark();
    w.act(Verb.Talk, Cemetery.Tomb);
    expect(w.voices(mark)).toEqual(["23.als", "50.als"]);
  });

  it("parler au panthéon : « Hi hi hi » (322), puis 33", () => {
    const w = startIn(3);
    const mark = w.mark();
    w.act(Verb.Talk, Cemetery.Pantheon);
    expect(w.voices(mark)).toEqual(["322.als", "33.als"]);
  });

  it("regarder le barreau : deux répliques (149, 150) ; les bestioles : roomActions puis parler (185, 186)", () => {
    const w = startIn(3);
    let mark = w.mark();
    w.act(Verb.Look, Cemetery.Bars);
    expect(w.voices(mark)).toEqual(["149.als", "150.als"]);
    mark = w.mark();
    w.act(Verb.Talk, Cemetery.Critters);
    expect(w.voices(mark)).toEqual(["185.als", "186.als"]);
  });

  it("prendre le barreau : le piton est en main, le drapeau 3 monte, le barreau disparaît (et reste caché au retour)", () => {
    const w = startIn(3);
    w.act(Verb.Pick, Cemetery.Bars);
    expect(w.state.pickedObject).toBe(Item.Spike);
    expect(w.flags[Flag.BarsTaken]).toBe(1);
    expect(objectOf(w, Cemetery.Bars).visible).toBe(false);
    w.selectVerb(Verb.None);
    w.player.perform(w.engine.enterRoom(3));
    expect(objectOf(w, Cemetery.Bars).visible).toBe(false);
  });

  it("la faucille sur la plante : l'animation 7_2 (feuilles en main, drapeau 37) ; une seconde fois : « je ne veux pas me couper encore »", () => {
    const w = startIn(3, { items: [Item.Sickle] });
    w.useItem(Item.Sickle, Cemetery.Plant, 60_000);
    expect(w.flags[Flag.LeavesTaken]).toBe(1);
    expect(w.state.pickedObject).toBe(Item.Leaves);
    // La faucille reste dans l'inventaire ; le décor a gardé ses feuilles d'origine (feuille annexe remise).
    expect(w.state.inventory).toContain(Item.Sickle);
    expect(w.engine.gfx.owner).toBe("room");
    w.selectVerb(Verb.None);
    const mark = w.mark();
    w.useItem(Item.Sickle, Cemetery.Plant);
    expect(w.voices(mark)).toEqual(["323.als"]);
  });

  it("la cinquième feuille de la potion : les ingrédients sont recomptés après la plante", () => {
    const w = startIn(3, {
      items: [Item.Sickle],
      flags: { [Flag.TissuesTaken]: 1, [Flag.CigarettesTaken]: 1, [Flag.GumTaken]: 1, [Flag.CandleTaken]: 1 },
    });
    expect(w.flags[Flag.AllIngredients]).toBe(0);
    w.useItem(Item.Sickle, Cemetery.Plant, 60_000);
    expect(w.flags[Flag.AllIngredients]).toBe(1);
  });

  it("les sorties : le chemin (2), le mur de la chapelle (5), l'église (1)", () => {
    go(startIn(3), Cemetery.Path, 2);
    go(startIn(3), Cemetery.ToChapel, 5);
    const w = startIn(3);
    go(w, Cemetery.ToChurch, 1);
  });

  it("frame : le héros arrivé en (279, 101) dans la pièce 3 est ramené sur le chemin", () => {
    const w = startIn(3);
    w.hero.x = 279;
    w.hero.y = 101 - w.hero.height;
    w.wait(40);
    w.settle();
    expect(w.hero.x).toBeLessThan(279);
    expect(w.hero.y + w.hero.height).toBeGreaterThan(101);
  });

  it("update_3 : le premier plan (tombe du bas) est dessiné par-dessus le héros", () => {
    const w = startIn(3);
    w.engine.render();
    const gfx = w.engine.gfx;
    let opaque = 0;
    let same = 0;
    for (let y = 0; y < 50; y++) {
      for (let x = 0; x < 43; x++) {
        const source = gfx.draw3.at(47 + x, 57 + y);
        if (source === 255) continue;
        opaque++;
        if (w.host.screen![(143 + y) * 320 + 277 + x] === source) same++;
      }
    }
    expect(opaque).toBeGreaterThan(0);
    expect(same).toBe(opaque);
  });
});
