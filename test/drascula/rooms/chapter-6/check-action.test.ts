import { describe, expect, it } from "vitest";
import { Corridor, Item } from "../../../../src/games/drascula/engine/rooms/chapter-6/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { startInCorridor } from "./start";

/** La partie du chapitre 6 de `checkAction` : regarder le héros, regarder l'objet 9 dans l'inventaire, les réponses par défaut. */
describe.skipIf(!hasOriginalFiles)("chapitre 6 : checkAction", () => {
  it("le héros libre se regarde : « Whaou ! Ne suis-je pas magnifique ! » (308)", () => {
    const w = startInCorridor();
    const mark = w.mark();
    w.selectVerb(Verb.Look);
    w.player.click(w.hero.x + 20, w.hero.y + 30);
    w.settle();
    expect(w.voices(mark)).toEqual(["308.als"]);
  });

  it("l'objet 9 dans l'inventaire : deux répliques (482, 483), l'inventaire est refermé", () => {
    const w = startInCorridor();
    const mark = w.mark();
    w.verbOnItem(Verb.Look, Item.Stake);
    expect(w.voices(mark)).toEqual(["482.als", "483.als"]);
    expect(w.state.menuScreen).toBe(false);
  });

  it("le téléphone dans l'inventaire : la réplique de roomActions (328)", () => {
    const w = startInCorridor();
    const mark = w.mark();
    w.verbOnItem(Verb.Look, Item.Phone);
    expect(w.voices(mark)).toEqual(["328.als"]);
  });

  it("un objet de l'inventaire sur un objet de la pièce : la réponse par défaut (« Et pourquoi ? »)", () => {
    const w = startInCorridor();
    const mark = w.mark();
    w.useItem(Item.Phone, Corridor.Torch);
    expect(w.voices(mark)).toEqual(["11.als"]);
  });
});
