import { describe, expect, it } from "vitest";
import { Crypt, Flag, Item, Room, Towers } from "../../../../src/games/drascula/engine/rooms/chapter-5/ids";
import { Track, Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";

/** Pièce 54, la crypte : le squelette (menu 10), l'os, la cellule de B.J. (`animation_1_5`, menu 8), l'épingle et le cadenas. */
describe.skipIf(!hasOriginalFiles)("chapitre 5 : la crypte (pièce 54)", () => {
  const enter = () => {
    const w = new Walkthrough({ chapter: 5 });
    w.goTo(Towers.Tower2);
    w.goTo(113);
    expect(w.room).toBe(Room.Crypt);
    return w;
  };
  /** Clique sur l'objet avec le verbe déjà choisi, sans attendre la fin (un dialogue attend les choix). */
  const start = (w: Walkthrough, verb: number, id: number) => {
    w.selectVerb(verb);
    const { x, y } = w.pointOf(id);
    w.player.click(x, y);
  };

  it("les objets sont ceux de la fiche ; la musique est la 20", () => {
    const w = enter();
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([115, 118, 119, 9999, 53, 118]);
    expect(w.host.music.at(-1)).toBe(20);
  });

  it.each([
    [Verb.Look, Crypt.Skeleton, "127.als"],
    [Verb.Open, Crypt.Padlock, "125.als"],
    [Verb.Look, Crypt.Padlock, "126.als"],
  ])("verbe %i sur l'objet %i : la réplique de roomActions", (verb, id, voice) => {
    const w = enter();
    const mark = w.mark();
    w.act(verb, id);
    expect(w.voices(mark)).toEqual([voice]);
  });

  describe("l'os", () => {
    it("le prendre : en main (objet 8), la voix du squelette (E10), l'os disparaît de la crypte", () => {
      const w = enter();
      const mark = w.mark();
      w.act(Verb.Pick, Crypt.Bone);
      expect(w.state.pickedObject).toBe(Item.Bone);
      expect(w.state.takeObject).toBe(true);
      expect(w.voices(mark)).toEqual(["e10.als"]);
      expect(w.flags[Flag.BoneTaken]).toBe(1);
      expect(w.engine.room.objects.find((o) => o.id === Crypt.Bone)?.visible).toBe(false);
    });

    it("à l'entrée suivante l'os n'est plus là", () => {
      const w = enter();
      w.act(Verb.Pick, Crypt.Bone);
      w.goTo(Crypt.Door);
      w.goTo(113);
      expect(w.room).toBe(Room.Crypt);
      expect(w.engine.room.objects.find((o) => o.id === Crypt.Bone)?.visible).toBe(false);
      expect(w.state.inventory).toContain(Item.Bone);
    });
  });

  describe("le squelette (objet 53)", () => {
    it("parler : sa voix s'éveille (drapeau 12), puis le menu 10 et ses trois réponses ; ensuite « Cela ne vaut mieux pas » (109)", () => {
      const w = enter();
      const mark = w.mark();
      start(w, Verb.Talk, Crypt.Skeleton);
      w.until(() => w.flags[Flag.SkeletonTalking] === 1);
      w.waitForChoices();
      expect(w.voices(mark).slice(0, 5)).toEqual(["288.als", "e1.als", "289.als", "e2.als", "e3.als"]);
      expect(w.engine.choices?.phrases).toHaveLength(4);
      expect(w.choose(0)).toBe(true);
      expect(w.choose(1)).toBe(true);
      expect(w.choose(2)).toBe(true);
      expect(w.choose(3)).toBe(false);
      w.settle();
      const spoken = w.voices(mark);
      for (const voice of ["290.als", "e4.als", "291.als", "e7.als", "292.als", "e8.als", "293.als", "e9.als"]) expect(spoken, voice).toContain(voice);
      expect(w.flags[Flag.SkeletonTalking]).toBe(0);
      expect(w.flags[Flag.SkeletonSpoke]).toBe(1);
      const next = w.mark();
      w.act(Verb.Talk, Crypt.Skeleton);
      expect(w.voices(next)).toEqual(["109.als"]);
    });
  });

  describe("B.J. derrière la porte (animation_1_5)", () => {
    it("la première fois : la scène de 12 répliques, le héros s'écarte puis revient, le drapeau 0, puis le menu 8", () => {
      const w = enter();
      const mark = w.mark();
      start(w, Verb.Talk, Crypt.Cell);
      w.waitForChoices();
      expect(w.voices(mark)).toEqual(["430.als", "bj16.als", "bj17.als", "bj18.als", "217.als", "bj19.als", "229.als", "431.als", "bj20.als", "438.als", "bj21.als", "229.als"]);
      expect(w.flags[Flag.BjMet]).toBe(1);
      expect(w.hero.track).toBe(Track.Right);
      // Le héros est revenu vers (120, 157), les pieds au point visé (à un pas près).
      expect(Math.abs(w.hero.x + Math.trunc(w.hero.width / 2) - 120)).toBeLessThanOrEqual(8);
      expect(Math.abs(w.hero.y + w.hero.height - 157)).toBeLessThanOrEqual(3);
      expect(w.engine.choices?.phrases).toHaveLength(4);
    });

    it("les deux premiers choix : B.J. refuse (scénario 2) ; le troisième : l'épingle (scénario 3) et le menu se ferme", () => {
      const w = enter();
      start(w, Verb.Talk, Crypt.Cell);
      w.waitForChoices();
      const mark = w.mark();
      expect(w.choose(0)).toBe(true);
      expect(w.choose(1)).toBe(true);
      expect(w.voices(mark)).toEqual(["432.als", "bj22.als", "433.als", "bj22.als"]);
      expect(w.choose(2)).toBe(false);
      w.settle();
      expect(w.voices(mark).slice(4)).toEqual(["434.als", "bj23.als"]);
      // `pickObject(10)` : l'épingle est en main.
      expect(w.state.pickedObject).toBe(Item.Pin);
      expect(w.state.takeObject).toBe(true);
    });

    it("les fois suivantes : le menu 8 seul, sans la scène ; regarder la porte : réplique 124", () => {
      const w = enter();
      w.flags[Flag.BjMet] = 1;
      const mark = w.mark();
      start(w, Verb.Talk, Crypt.Cell);
      w.waitForChoices();
      expect(w.voices(mark)).toEqual([]);
      expect(w.choose(3)).toBe(false);
      w.settle();
      const next = w.mark();
      w.act(Verb.Look, Crypt.Cell);
      expect(w.voices(next)).toEqual(["124.als"]);
    });

    it("regarder la porte la première fois joue la scène aussi", () => {
      const w = enter();
      const mark = w.mark();
      start(w, Verb.Look, Crypt.Cell);
      w.waitForChoices();
      expect(w.voices(mark)[0]).toBe("430.als");
      expect(w.flags[Flag.BjMet]).toBe(1);
    });
  });

  it("l'épingle sur le cadenas : « Zut ! C'est cassée ! » (436), l'épingle est perdue", () => {
    const w = enter();
    w.engine.addObject(Item.Pin);
    const mark = w.mark();
    w.useItem(Item.Pin, Crypt.Padlock);
    expect(w.voices(mark)).toEqual(["436.als"]);
    expect(w.state.inventory).not.toContain(Item.Pin);
    expect(w.state.takeObject).toBe(false);
  });

  it("l'épingle sur autre chose : une excuse, elle reste en main", () => {
    const w = enter();
    w.engine.addObject(Item.Pin);
    const mark = w.mark();
    w.useItem(Item.Pin, Crypt.Skeleton);
    expect(w.voices(mark)).toEqual(["11.als"]);
    expect(w.state.pickedObject).toBe(Item.Pin);
  });
});
