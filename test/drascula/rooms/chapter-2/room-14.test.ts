import { describe, expect, it } from "vitest";
import { Anim, Flag, Inn, Item } from "../../../../src/games/drascula/engine/rooms/chapter-2/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { go, objectIds, objectOf, startIn, talkAndWaitForChoices } from "./route";

/** Pièce 14, l'auberge (départ du chapitre) : le barman, le pianiste, l'ivrogne, le livre, l'histoire de Von Braun. */
describe.skipIf(!hasOriginalFiles)("chapitre 2 : l'auberge (pièce 14)", () => {
  it("le chapitre commence ici : les objets sont ceux de la fiche, le téléphone dans l'inventaire, la musique 21", () => {
    const w = startIn(14, { arrival: Inn.Rooms });
    expect(objectIds(w)).toEqual([159, 162, 171, 52, 54, 53, 199, 200, 203, 202, 201, 204]);
    expect(w.state.inventory).toContain(Item.Phone);
    expect(w.host.music.at(-1)).toBe(21);
  });

  it("regarder les objets de roomActions : l'affiche (165), la tête (168), la corbeille (171) ; parler à la tête (169)", () => {
    const w = startIn(14);
    for (const [verb, id, voice] of [
      [Verb.Look, 200, "165.als"],
      [Verb.Look, 203, "168.als"],
      [Verb.Talk, 203, "169.als"],
      [Verb.Look, 204, "171.als"],
    ] as const) {
      const mark = w.mark();
      w.act(verb, id);
      expect(w.voices(mark), `objet ${id}`).toEqual([voice]);
    }
  });

  describe("le barman", () => {
    it("lui parler : le scénario 11 (352 et t1, 353 et t17, 354 et t18, 355 puis la voix de Drascula d82)", () => {
      const w = startIn(14);
      const mark = w.mark();
      w.act(Verb.Talk, Inn.Barman);
      expect(w.voices(mark)).toEqual(["352.als", "t1.als", "353.als", "t17.als", "354.als", "t18.als", "355.als", "d82.als"]);
      expect(w.engine.gfx.extra.pixels).toEqual(w.engine.gfx.sheet("974.alg").pixels); // sa feuille est rendue
    });

    it("le pianiste parti : « que s'est-il passé avec le pianiste ? » (404) et ses trois réponses", () => {
      const w = startIn(14, { flags: { [Flag.PianistGone]: 1 } });
      const mark = w.mark();
      w.act(Verb.Talk, Inn.Barman);
      expect(w.voices(mark)).toEqual(["404.als", "t19.als", "t20.als", "t21.als", "355.als", "d82.als"]);
    });
  });

  describe("le pianiste", () => {
    it("lui parler : il se retourne (deux images), la musique s'arrête, 356, p5, puis le menu OP_1 ; tout est remis à la sortie", () => {
      const w = startIn(14);
      const mark = w.mark();
      w.selectVerb(Verb.Talk);
      const { x, y } = w.pointOf(Inn.Pianist);
      w.player.click(x, y);
      w.until(() => w.state.anim[Anim.PianistTurn] === 1);
      w.until(() => w.state.anim[Anim.PianistTurn] === 2);
      w.until(() => w.flags[Flag.PianistTalking] === 1);
      expect(w.host.musicPlaying()).toBe(false);
      w.waitForChoices(60_000);
      expect(w.voices(mark).slice(0, 2)).toEqual(["356.als", "p5.als"]);
      expect(w.engine.choices?.phrases).toHaveLength(4);
      expect(w.choose(3)).toBe(false);
      w.settle();
      expect(w.flags[Flag.PianistTalking]).toBe(0);
      expect(w.state.anim[Anim.PianistTurn]).toBe(0);
    });

    it("le livre rendu : la scène du piano (le héros reçoit les bouchons d'oreilles), le drapeau 39, la musique 16 ; ensuite « cela ne vaut mieux pas » (109)", () => {
      const w = startIn(14, { items: [Item.Book] });
      const mark = w.mark();
      w.useItem(Item.Book, Inn.Pianist, 60_000);
      expect(w.voices(mark)).toEqual(["392.als", "p5.als", "393.als", "p17.als", "p18.als", "p19.als", "s9.als"]);
      expect(w.flags[Flag.BookGiven]).toBe(1);
      expect(w.flags[Flag.PianistTalking]).toBe(0);
      expect(w.state.pickedObject).toBe(Item.Earplugs);
      expect(w.state.inventory).not.toContain(Item.Book);
      expect(w.state.roomMusic).toBe(16);
      expect(w.engine.gfx.owner).toBe("room");
      w.selectVerb(Verb.None);
      const next = w.mark();
      w.act(Verb.Talk, Inn.Pianist);
      expect(w.voices(next)).toEqual(["109.als"]);
    });

    it("le pianiste parti : il n'est plus dans l'auberge et la musique se tait", () => {
      const w = startIn(14, { flags: { [Flag.PianistGone]: 1, [Flag.BookGiven]: 1 } });
      expect(objectOf(w, Inn.Pianist).visible).toBe(false);
      expect(w.state.roomMusic).toBe(0);
      expect(w.host.musicPlaying()).toBe(false);
    });
  });

  describe("l'ivrogne", () => {
    it("lui parler la première fois : le scénario 13 puis le menu OP_2 (flag 41)", () => {
      const w = startIn(14);
      const mark = w.mark();
      talkAndWaitForChoices(w, Inn.Drunk);
      expect(w.flags[Flag.DrunkSpoke]).toBe(1);
      expect(w.voices(mark).slice(0, 4)).toEqual(["103.als", "b4.als", "367.als", "b5.als"]);
      expect(w.engine.choices?.phrases).toHaveLength(4);
      expect(w.choose(3)).toBe(false);
      w.settle();
    });

    it("la fois suivante : le menu OP_2 tout de suite ; « où trouver Von Braun ? » : la cabane (drapeau 40)", () => {
      const w = startIn(14, { flags: { [Flag.DrunkSpoke]: 1 } });
      const mark = w.mark();
      talkAndWaitForChoices(w, Inn.Drunk);
      expect(w.voices(mark)).toEqual([]);
      expect(w.choose(2)).toBe(true);
      expect(w.flags[Flag.HutKnown]).toBe(1);
      expect(w.voices(mark)).toContain("372.als");
      expect(w.choose(3)).toBe(false);
      w.settle();
      expect(w.engine.gfx.front.pixels).toEqual(w.engine.gfx.sheet("964.alg").pixels); // sa feuille est rendue
    });

    it("l'histoire de Von Braun : cinq écrans sur l'image libre, musique 32, puis la pièce revient en fondu", () => {
      const w = startIn(14, { flags: { [Flag.DrunkSpoke]: 1 } });
      talkAndWaitForChoices(w, Inn.Drunk);
      w.player.move(100, 12);
      w.player.run(2);
      w.player.move(100, 12, 1);
      w.player.move(100, 12, 0);
      w.until(() => w.engine.gfx.owner === "canvas", 60_000);
      expect(w.host.music.at(-1)).toBe(32);
      w.until(() => w.engine.gfx.owner === "room", 60_000);
      // La pièce est de retour (fondu depuis le noir, musique de la pièce) et le menu reprend.
      w.waitForChoices(60_000);
      expect(w.host.music.at(-1)).toBe(21);
      expect(w.engine.gfx.palette.shown.some((value) => value !== 0)).toBe(true);
      expect(w.choose(3)).toBe(false);
      w.settle();
    });

    it("Échap saute l'histoire : la pièce revient aussitôt", () => {
      const w = startIn(14, { flags: { [Flag.DrunkSpoke]: 1 } });
      talkAndWaitForChoices(w, Inn.Drunk);
      w.player.move(100, 12);
      w.player.run(2);
      w.player.move(100, 12, 1);
      w.player.move(100, 12, 0);
      w.until(() => w.engine.gfx.owner === "canvas", 60_000);
      w.wait(200);
      w.key("Escape");
      w.waitForChoices(60_000);
      expect(w.engine.gfx.owner).toBe("room");
      expect(w.host.music.at(-1)).toBe(21);
    });
  });

  describe("update_14_pre", () => {
    it("les bougies, le pianiste et le clignement avancent toutes les 70 ms", () => {
      const w = startIn(14);
      const candles = new Set<number>();
      const pianist = new Set<number>();
      for (let i = 0; i < 200; i++) {
        w.wait(1);
        candles.add(w.state.anim[Anim.Candles] ?? 0);
        pianist.add(w.state.anim[Anim.Pianist] ?? 0);
      }
      expect([...candles].sort()).toEqual([0, 1, 2]);
      expect(pianist.size).toBe(9);
    });

    it("le pianiste est dessiné d'après la feuille de la pièce (29 x 42 en (245, 130))", () => {
      const w = startIn(14);
      w.state.anim[Anim.Pianist] = 1;
      w.engine.render();
      const gfx = w.engine.gfx;
      const x0 = gfx.dat.pianistX[1];
      let same = 0;
      for (let y = 0; y < 42; y++) for (let x = 0; x < 29; x++) if (w.host.screen![(130 + y) * 320 + 245 + x] === gfx.draw3.at(x0 + x, 157 + y)) same++;
      expect(same).toBe(29 * 42);
    });

    it("l'ivrogne fait son geste (drapeau 12) : il attend la fin du geste, que seul `tickInn` baisse, avant de parler", () => {
      const w = startIn(14);
      w.engine.flags[Flag.DrunkGesture] = 1;
      const mark = w.mark();
      w.engine.run(w.engine.talkers.drunk(1));
      w.wait(5);
      expect(w.voices(mark)).toEqual([]);
      expect(w.flags[Flag.DrunkTalking]).toBe(1);
      w.until(() => w.flags[Flag.DrunkGesture] === 0);
      w.settle();
      expect(w.voices(mark)).toEqual(["b1.als"]);
      expect(w.flags[Flag.DrunkTalking]).toBe(0);
    });
  });

  it("frame : le héros arrêté en (246, 112) ou (214, 121) est écarté de la tête du pianiste", () => {
    const w = startIn(14);
    w.hero.x = 246;
    w.hero.y = 112 - w.hero.height;
    w.wait(40);
    w.settle();
    expect([w.hero.x, w.hero.y + w.hero.height]).not.toEqual([246, 112]);
    expect(w.hero.x).toBeLessThan(214);
  });

  it("les sorties : l'escalier (12), les chambres (16), la porte du couloir (15)", () => {
    go(startIn(14), Inn.Stairs, 12);
    go(startIn(14), Inn.Rooms, 16);
    go(startIn(14), Inn.Hallway, 15);
  });
});
