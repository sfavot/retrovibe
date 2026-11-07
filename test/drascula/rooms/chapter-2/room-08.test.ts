import { describe, expect, it } from "vitest";
import { Alley, Flag, Item } from "../../../../src/games/drascula/engine/rooms/chapter-2/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { go, objectIds, startIn } from "./route";

/** Pièce 8, l'impasse aux poubelles : les mouchoirs. */
describe.skipIf(!hasOriginalFiles)("chapitre 2 : l'impasse aux poubelles (pièce 8)", () => {
  it("les objets sont ceux de la fiche", () => {
    const w = startIn(8, { arrival: Alley.ToArch });
    expect(objectIds(w)).toEqual([160, 147, 161]);
    expect(w.host.music.at(-1)).toBe(6);
    expect([w.hero.width, w.hero.height]).toEqual([39, 64]);
  });

  it("regarder la poubelle : « un paquet de Clinex » (58), les mouchoirs en main, drapeau 7 ; ensuite « rien de plus » (59)", () => {
    const w = startIn(8);
    let mark = w.mark();
    w.act(Verb.Look, Alley.Bin);
    expect(w.voices(mark)).toEqual(["58.als"]);
    expect(w.state.pickedObject).toBe(Item.Tissues);
    expect(w.flags[Flag.TissuesTaken]).toBe(1);
    w.selectVerb(Verb.None);
    mark = w.mark();
    w.act(Verb.Look, Alley.Bin);
    expect(w.voices(mark)).toEqual(["59.als"]);
  });

  it("les ingrédients sont comptés", () => {
    const w = startIn(8, { flags: { [Flag.CigarettesTaken]: 1, [Flag.GumTaken]: 1, [Flag.CandleTaken]: 1, [Flag.LeavesTaken]: 1 } });
    w.act(Verb.Look, Alley.Bin);
    expect(w.flags[Flag.AllIngredients]).toBe(1);
  });

  it("les sorties : l'arche (12) et la carte (10)", () => {
    go(startIn(8), Alley.ToArch, 12);
    go(startIn(8), Alley.ToMap, 10);
  });
});
