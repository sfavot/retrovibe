import { describe, expect, it } from "vitest";
import { Flag, Item, Village } from "../../../../src/games/drascula/engine/rooms/chapter-2/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { go, objectIds, startIn } from "./route";

/** Pièce 4, le village : le tonneau et son chewing-gum, la lumière. */
describe.skipIf(!hasOriginalFiles)("chapitre 2 : le village (pièce 4)", () => {
  it("les objets sont ceux de la fiche ; le héros a la taille de la fiche (34 x 55)", () => {
    const w = startIn(4, { arrival: Village.ToCrossroads });
    expect(objectIds(w)).toEqual([126, 145, 189, 207, 208, 209, 210]);
    expect([w.hero.width, w.hero.height]).toEqual([34, 55]);
  });

  it("pousser le tonneau : « il y a un chewing-gum collé ici », le chewing-gum en main, drapeau 34 ; la fois suivante rien de plus", () => {
    const w = startIn(4);
    const mark = w.mark();
    w.act(Verb.Move, Village.Barrel);
    expect(w.voices(mark)).toEqual(["327.als"]);
    expect(w.state.pickedObject).toBe(Item.BubbleGum);
    expect(w.flags[Flag.GumTaken]).toBe(1);
    w.selectVerb(Verb.None);
    const next = w.mark();
    w.act(Verb.Move, Village.Barrel);
    expect(w.voices(next)).toEqual(["19.als"]); // l'excuse de la pièce 0 pour « pousser »
  });

  it("regarder le tonneau et le château : roomActions", () => {
    const w = startIn(4);
    for (const [id, voice] of [
      [189, "182.als"],
      [207, "175.als"],
    ] as const) {
      const mark = w.mark();
      w.act(Verb.Look, id);
      expect(w.voices(mark), `objet ${id}`).toEqual([voice]);
    }
  });

  it("les ingrédients sont comptés : le dernier ramassé lève le drapeau 38", () => {
    const w = startIn(4, { flags: { [Flag.TissuesTaken]: 1, [Flag.CigarettesTaken]: 1, [Flag.CandleTaken]: 1, [Flag.LeavesTaken]: 1 } });
    w.act(Verb.Move, Village.Barrel);
    expect(w.flags[Flag.AllIngredients]).toBe(1);
  });

  it("les sorties : le carrefour (2) et la carte (10)", () => {
    go(startIn(4), Village.ToCrossroads, 2);
    go(startIn(4), Village.ToMap, 10);
  });

  it("update_4 : la lumière est sombre à droite (x > 190), claire à gauche", () => {
    const w = startIn(4);
    const { palette } = w.engine.gfx;
    const light = (source: Int8Array) => Array.from(source.subarray(235 * 3, 253 * 3));
    w.hero.x = 250;
    w.engine.render();
    expect(light(palette.game)).toEqual(light(palette.dark));
    w.hero.x = 100;
    w.engine.render();
    expect(light(palette.game)).toEqual(light(palette.bright));
  });
});
