import { describe, expect, it } from "vitest";
import { Flag, Hut, Item } from "../../../../src/games/drascula/engine/rooms/chapter-2/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { go, objectIds, objectOf, startIn, talkAndWaitForChoices } from "./route";

/** Pièce 17, la cabane de Von Braun : sonner, parler à travers la porte, l'épreuve (`animation_20_2`). */
describe.skipIf(!hasOriginalFiles)("chapitre 2 : la cabane de Von Braun (pièce 17)", () => {
  it("les objets sont ceux de la fiche ; la porte est fermée ; la musique est la 5", () => {
    const w = startIn(17, { arrival: Hut.Exit });
    expect(objectIds(w)).toEqual([176, 177]);
    expect(objectOf(w, Hut.Door).isDoor).toBe(false);
    expect(w.host.music.at(-1)).toBe(5);
    expect([w.hero.width, w.hero.height]).toEqual([39, 64]);
  });

  it("regarder la porte (35), lui parler avant d'avoir sonné (6)", () => {
    const w = startIn(17);
    let mark = w.mark();
    w.act(Verb.Look, Hut.Door);
    expect(w.voices(mark)).toEqual(["35.als"]);
    mark = w.mark();
    w.act(Verb.Talk, Hut.Door);
    expect(w.voices(mark)).toEqual(["6.als"]);
  });

  it("l'ouvrir la première fois : on sonne (scénario 22), Von Braun répond derrière la porte (drapeau 18) ; la porte reste fermée (346)", () => {
    const w = startIn(17);
    const mark = w.mark();
    w.act(Verb.Open, Hut.Door);
    expect(w.voices(mark)).toEqual(["374.als", "s13.als", "vb1.als", "375.als", "vb2.als", "376.als", "vb3.als"]);
    expect(w.flags[Flag.VonBraunAnswered]).toBe(1);
    expect(w.hero.track).toBe(1);
    const next = w.mark();
    w.act(Verb.Open, Hut.Door);
    expect(w.voices(next)).toEqual(["346.als"]);
  });

  it("lui parler après avoir sonné : « Professeur ! », « Va-t'en ! », puis le menu OP_3 ; les choix 1 et 3 sont de simples répliques", () => {
    const w = startIn(17, { flags: { [Flag.VonBraunAnswered]: 1 } });
    const mark = w.mark();
    talkAndWaitForChoices(w, Hut.Door);
    expect(w.voices(mark)).toEqual(["378.als", "vb4.als"]);
    expect(w.choose(0)).toBe(true);
    expect(w.voices(mark).slice(2)).toEqual(["379.als", "vb5.als"]);
    expect(w.choose(2)).toBe(true);
    expect(w.voices(mark).slice(4)).toEqual(["380.als", "vb6.als"]);
    expect(w.choose(3)).toBe(false);
    w.settle();
  });

  it("animation_20_2 sans avoir ouvert le sac de B.J. : « c'est que je suis fauché » ; la porte reste fermée et le menu revient", () => {
    const w = startIn(17, { flags: { [Flag.VonBraunAnswered]: 1 } });
    talkAndWaitForChoices(w, Hut.Door);
    const mark = w.mark();
    expect(w.choose(1)).toBe(true);
    expect(w.voices(mark)).toEqual(["382.als", "vb7.als", "vb8.als", "383.als", "vb9.als", "384.als", "vb10.als", "385.als", "vb11.als", "350.als", "vb57.als"]);
    expect(w.room).toBe(17);
    expect(w.flags[Flag.HutDoorOpen]).toBe(0);
    expect(w.flags[Flag.VonBraunLetsIn]).toBe(0);
    expect(w.choose(3)).toBe(false);
    w.settle();
  });

  it("animation_20_2 avec le sac ouvert : il ouvre, l'épreuve dans le laboratoire, le héros ressort ; la porte reste ouverte et on peut y retourner", () => {
    const w = startIn(17, { flags: { [Flag.VonBraunAnswered]: 1, [Flag.HandbagOpened]: 1 }, items: [Item.Money, Item.TwoCoins, Item.OneCoin] });
    talkAndWaitForChoices(w, Hut.Door);
    const mark = w.mark();
    expect(w.choose(1)).toBe(false);
    w.settle(60_000);
    const spoken = w.voices(mark);
    for (const voice of ["386.als", "vb12.als", "s3.als", "vb13.als", "vb14.als", "387.als", "vb15.als", "s7.als", "vb17.als", "vb18.als", "s6.als", "vb19.als", "vb20.als", "vb21.als"]) {
      expect(spoken, voice).toContain(voice);
    }
    expect(w.room).toBe(17);
    expect(w.flags[Flag.VonBraunLetsIn]).toBe(1);
    expect(w.flags[Flag.VonBraunAnswered]).toBe(0);
    expect(w.flags[Flag.HutDoorOpen]).toBe(1);
    expect(w.flags[Flag.MetVonBraun]).toBe(1);
    expect(w.flags[Flag.VonBraunAwake]).toBe(0);
    expect(w.flags[Flag.Machine]).toBe(0);
    // Il a gardé l'argent : le billet, les deux pièces et la pièce.
    for (const item of [Item.Money, Item.TwoCoins, Item.OneCoin]) expect(w.state.inventory, `objet ${item}`).not.toContain(item);
    expect([w.flags[Flag.MoneyKept], w.flags[Flag.TwoCoinsKept], w.flags[Flag.OneCoinKept]]).toEqual([1, 1, 1]);
    expect(w.state.vonBraun).toMatchObject({ track: 1, x: 120 });
    go(w, Hut.Door, 18);
  });

  it("la porte ouverte (drapeau 14) : fermer (son 4) puis rouvrir (son 3)", () => {
    const w = startIn(17, { flags: { [Flag.VonBraunLetsIn]: 1, [Flag.HutDoorOpen]: 1 } });
    let mark = w.mark();
    w.act(Verb.Close, Hut.Door);
    expect(w.voices(mark)).toEqual(["s4.als"]);
    expect(w.flags[Flag.HutDoorOpen]).toBe(0);
    mark = w.mark();
    w.act(Verb.Open, Hut.Door);
    expect(w.voices(mark)).toEqual(["s3.als"]);
    go(w, Hut.Door, 18);
  });

  it("les bouchons d'oreilles sur le héros hors du laboratoire : « je les mettrai le moment venu » (315)", () => {
    const w = startIn(17, { items: [Item.Earplugs] });
    const mark = w.mark();
    w.takeItem(Item.Earplugs);
    w.clickAt(w.hero.x + 12, w.hero.y + 35);
    expect(w.voices(mark)).toEqual(["315.als"]);
    expect(w.flags[Flag.WearingEarplugs]).toBe(0);
  });

  it("la sortie mène au carrefour (2)", () => {
    go(startIn(17), Hut.Exit, 2);
  });
});
