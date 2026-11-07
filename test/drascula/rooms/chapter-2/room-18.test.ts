import { describe, expect, it } from "vitest";
import { Anim, Flag, INGREDIENT_ITEMS, Item, Lab } from "../../../../src/games/drascula/engine/rooms/chapter-2/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { go, objectIds, objectOf, startIn, talkAndWaitForChoices } from "./route";

/** Pièce 18, le laboratoire de Von Braun : le livre, les bouchons d'oreilles, les menus OP_4 et OP_5, la potion. */
describe.skipIf(!hasOriginalFiles)("chapitre 2 : le laboratoire (pièce 18)", () => {
  it("les objets sont ceux de la fiche ; la musique est la 22 ; Von Braun dort (drapeau 21 bas)", () => {
    const w = startIn(18, { arrival: Lab.Door });
    expect(objectIds(w)).toEqual([178, 180, 182, 181, 181, 179, 179, 179, 179, 55]);
    expect(w.host.music.at(-1)).toBe(22);
    expect(w.flags[Flag.VonBraunAwake]).toBe(0);
  });

  it("regarder le diplôme (348) et le livre (154) : roomActions", () => {
    const w = startIn(18);
    const mark = w.mark();
    w.act(Verb.Look, 181);
    expect(w.voices(mark)).toEqual(["348.als"]);
    const book = startIn(18);
    const next = book.mark();
    book.act(Verb.Look, Lab.Book);
    expect(book.voices(next)).toEqual(["154.als"]);
  });

  it("prendre le livre : en main (objet 12), drapeau 28, il disparaît ; il reste caché au retour", () => {
    const w = startIn(18);
    w.act(Verb.Pick, Lab.Book);
    expect(w.state.pickedObject).toBe(Item.Book);
    expect(w.flags[Flag.BookTaken]).toBe(1);
    expect(objectOf(w, Lab.Book).visible).toBe(false);
    w.selectVerb(Verb.None);
    w.player.perform(w.engine.enterRoom(18));
    expect(objectOf(w, Lab.Book).visible).toBe(false);
  });

  it("update_18_pre : Von Braun ronfle (une image sur 16, toutes les 10 ticks) et n'est dessiné debout qu'une fois réveillé", () => {
    const w = startIn(18);
    const seen = new Set<number>();
    for (let i = 0; i < 16 * 10 + 20; i++) {
      w.wait(1);
      seen.add(w.state.anim[Anim.Snore] ?? 0);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, n) => n));
    // Endormi : le fauteuil (56 x 61 de AUX18.ALG) est dessiné en (120, 58).
    w.engine.render();
    const gfx = w.engine.gfx;
    let same = 0;
    for (let y = 0; y < 61; y++) for (let x = 0; x < 56; x++) if (w.host.screen![(58 + y) * 320 + 120 + x] === gfx.draw3.at(1 + x, 69 + y)) same++;
    expect(same).toBeGreaterThan(56 * 61 * 0.5);
    // Éveillé : il est dessiné à la place, de la feuille de face.
    w.engine.flags[Flag.VonBraunAwake] = 1;
    w.engine.render();
    let drawn = 0;
    for (let y = 0; y < 61; y++) for (let x = 0; x < 56; x++) if (w.host.screen![(58 + y) * 320 + 120 + x] === gfx.draw3.at(1 + x, 69 + y)) drawn++;
    expect(drawn).toBeLessThan(same);
  });

  describe("les ingrédients montrés à Von Braun", () => {
    it("trop tôt (drapeaux 38 et 33 bas) : « il me manque encore des ingrédients » (349) pour chacun des cinq objets, sans rien d'autre", () => {
      for (const item of INGREDIENT_ITEMS) {
        const w = startIn(18, { items: [item] });
        const mark = w.mark();
        w.useItem(item, Lab.VonBraun);
        expect(w.voices(mark), `objet ${item}`).toEqual(["349.als"]);
      }
    });

    it("tout autre objet ou verbe : la pièce répond sans mot (hasAnswer = 1)", () => {
      const w = startIn(18);
      const mark = w.mark();
      w.act(Verb.Look, Lab.VonBraun);
      expect(w.voices(mark)).toEqual([]);
    });

    it("quand tout est réuni et la recette connue : n'importe quel ingrédient le réveille (menu)", () => {
      const w = startIn(18, { items: [Item.Leaves], flags: { [Flag.AllIngredients]: 1, [Flag.BlindSpokeTwice]: 1 } });
      w.takeItem(Item.Leaves);
      const { x, y } = w.pointOf(Lab.VonBraun);
      w.player.click(x, y);
      w.waitForChoices(60_000);
      expect(w.flags[Flag.VonBraunAwake]).toBe(1);
      expect(w.choose(3)).toBe(false);
      w.settle(60_000);
    });
  });

  describe("les bouchons d'oreilles", () => {
    it("sur le héros : « très bien, j'ai mis les boules Quiès » (347), l'oreille bouchée en main (23), drapeau 29", () => {
      const w = startIn(18, { items: [Item.Earplugs] });
      const mark = w.mark();
      w.takeItem(Item.Earplugs);
      w.clickAt(w.hero.x + 12, w.hero.y + 35, 60_000);
      expect(w.voices(mark)).toEqual(["347.als"]);
      expect(w.flags[Flag.WearingEarplugs]).toBe(1);
      expect(w.state.pickedObject).toBe(Item.EarWithEarplug);
      expect(w.state.inventory).not.toContain(Item.Earplugs);
    });
  });

  describe("Von Braun réveillé", () => {
    it("lui parler : « Hem ! », la cinématique du réveil, « Qu'est-ce que tu veux maintenant ? » (vb22), puis OP_4 ; sortir par la porte", () => {
      const w = startIn(18);
      const mark = w.mark();
      talkAndWaitForChoices(w, Lab.VonBraun);
      expect(w.voices(mark)).toEqual(["356.als", "vb22.als"]);
      expect(w.flags[Flag.VonBraunAwake]).toBe(1);
      expect(w.engine.choices?.phrases[0]).toContain("CABINE DE TORTURE");
      expect(w.choose(3)).toBe(false);
      w.settle(60_000);
      expect(w.room).toBe(17);
      expect(w.flags[Flag.VonBraunAwake]).toBe(0);
      expect(w.state.vonBraun).toMatchObject({ track: 1, x: 120 });
    });

    it("la feuille de face du héros est rendue en sortant (le laboratoire n'est plus à `an24.alg`)", () => {
      const w = startIn(18);
      talkAndWaitForChoices(w, Lab.VonBraun);
      w.choose(3);
      w.settle(60_000);
      expect(w.engine.gfx.front.pixels).toEqual(w.engine.gfx.sheet("964.alg").pixels);
    });

    it("après la scène des bouchons d'oreilles : le menu OP_5 ; la troisième réponse devient « J'ai tous les ingrédients » quand tout est prêt", () => {
      const w = startIn(18, { flags: { [Flag.EarplugsScene]: 1 } });
      expect(w.engine.dialogs.choices(5).phrases[2]).toContain("MAUVAISE POSITION");
      w.engine.flags[Flag.AllIngredients] = 1;
      w.engine.flags[Flag.BlindSpokeTwice] = 1;
      const choices = w.engine.dialogs.choices(5);
      expect(choices.voices[2]).toBe("405.als");
      expect(choices.answers[2]).toBe(31);
    });

    it("OP_5 : « pourquoi Drascula n'a pas pu te tuer ? » (scénario 29, drapeau 33) puis, sans ingrédients, « je m'en vais en chercher » (403) : la conversation s'arrête", () => {
      const w = startIn(18, { flags: { [Flag.EarplugsScene]: 1 } });
      const mark = w.mark();
      talkAndWaitForChoices(w, Lab.VonBraun);
      expect(w.choose(1)).toBe(false);
      w.settle(60_000);
      const spoken = w.voices(mark);
      for (const voice of ["397.als", "vb32.als", "398.als", "vb33.als", "400.als", "vb41.als", "402.als", "vb42.als", "403.als"]) expect(spoken, voice).toContain(voice);
      expect(w.flags[Flag.BlindSpokeTwice]).toBe(1);
      expect(w.room).toBe(17);
    });

    it("OP_5, première fois : l'histoire (scénario 29) une seule fois, sans « Je te l'ai déjà dit ! » (vb43) (écart voulu)", () => {
      const w = startIn(18, { flags: { [Flag.EarplugsScene]: 1 } });
      const mark = w.mark();
      talkAndWaitForChoices(w, Lab.VonBraun);
      w.choose(1);
      w.settle(60_000);
      const spoken = w.voices(mark);
      expect(spoken.filter((voice) => voice === "vb41.als")).toHaveLength(1);
      expect(spoken).not.toContain("vb43.als");
    });

    it("OP_5, fois suivantes : « Je te l'ai déjà dit ! » (vb43) au lieu de l'histoire", () => {
      const w = startIn(18, { flags: { [Flag.EarplugsScene]: 1, [Flag.BlindSpokeTwice]: 1 } });
      const mark = w.mark();
      talkAndWaitForChoices(w, Lab.VonBraun);
      w.choose(1);
      w.settle(60_000);
      const spoken = w.voices(mark);
      expect(spoken).toContain("vb43.als");
      expect(spoken).not.toContain("vb41.als");
      expect(spoken.indexOf("vb43.als")).toBeLessThan(spoken.indexOf("402.als"));
    });
  });

  it("la porte mène à la cabane (17)", () => {
    go(startIn(18), Lab.Door, 17);
  });
});
