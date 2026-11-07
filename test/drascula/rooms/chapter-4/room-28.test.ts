import { describe, expect, it } from "vitest";
import { Corridor, Flag, Item } from "../../../../src/games/drascula/engine/rooms/chapter-4/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { speech, startIn } from "./support";

/**
 * Pièce 28, trop sombre : pas de `room_28` ni de `update_28` dans ScummVM ; c'est `checkAction` du chapitre 4 qui répond la même
 * chose à tout verbe sur tout objet de la pièce (« Cette pièce est trop sombre », 178), sauf au héros (`roomActions` 201).
 */
describe.skipIf(!hasOriginalFiles)("chapitre 4 : la pièce sombre (pièce 28)", () => {
  const enter = () => startIn(28, { exit: 111, flags: { [Flag.DoorCellar]: 1 }, items: [Item.Rope, Item.Branch] });

  it("objets de la fiche ; la sortie 111 est la seule porte", () => {
    const w = enter();
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([111, 200, 999, 999, 999, 999, 999, 999, 999, 999]);
    expect(w.engine.room.objects.filter((o) => o.isDoor).map((o) => o.id)).toEqual([111]);
    expect(w.host.music.at(-1)).toBe(15);
  });

  it.each([
    [Verb.Look, 200],
    [Verb.Open, 200],
    [Verb.Pick, 200],
    [Verb.Talk, 200],
    [Verb.Look, 999],
    [Verb.Move, 999],
  ])("le verbe %i sur l'objet %i : « Cette pièce est trop sombre » (178)", (verb, id) => {
    const w = enter();
    expect(speech(w, () => w.act(verb, id))).toEqual(["178.als"]);
  });

  it("toutes les caisses, coffres, tiroirs et le baril (objet 999) répondent pareil", () => {
    const w = enter();
    const crates = w.engine.room.objects.filter((o) => o.id === 999);
    expect(crates.length).toBeGreaterThan(5);
    for (const crate of crates) {
      w.selectVerb(Verb.Look);
      const mark = w.mark();
      // Le point d'un objet visible en tête de pile : on clique au milieu de chacun (les zones se recouvrent, la réponse est la même).
      w.clickAt(Math.trunc((crate.rect.x1 + crate.rect.x2) / 2), Math.trunc((crate.rect.y1 + crate.rect.y2) / 2));
      expect(w.voices(mark).includes("178.als")).toBe(true);
    }
  });

  it("le héros garde ses propres répliques (roomActions 201) : « Plus je me regarde, plus je me plais » (309)", () => {
    const w = enter();
    w.selectVerb(Verb.Look);
    const hero = w.hero;
    const mark = w.mark();
    w.clickAt(hero.x + Math.trunc(hero.width / 2), hero.y + Math.trunc(hero.height / 2));
    expect(w.voices(mark)).toEqual(["309.als"]);
  });

  it("l'inventaire reste lisible : regarder la corde (494, 495) et combiner branche et corde ne passent pas par la réplique 178", () => {
    const w = enter();
    expect(speech(w, () => w.verbOnItem(Verb.Look, Item.Rope))).toEqual(["494.als", "495.als"]);
    w.combine(Item.Branch, Item.Rope);
    expect(w.state.pickedObject).toBe(Item.Grapnel);
    expect(w.state.inventory).not.toContain(Item.Branch);
    expect(w.state.inventory).not.toContain(Item.Rope);
  });

  it("la sortie 111 ramène au couloir (sortie 110)", () => {
    const w = enter();
    w.goTo(111);
    expect(w.room).toBe(27);
    expect(w.state.objExit).toBe(Corridor.DoorToCellar);
  });
});
