import { describe, expect, it } from "vitest";
import { Flag, Item, Tavern } from "../../../../src/games/drascula/engine/rooms/chapter-6/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { startInTavern } from "./start";

/** Pièce 60, la taverne : les regards, le piano, le barman, Drascula, la boisson, la fin du jeu, l'animation de la pièce. */
describe.skipIf(!hasOriginalFiles)("chapitre 6 : la taverne (pièce 60)", () => {
  it("on y arrive par la porte 109 de la chambre ; les objets sont ceux de la fiche ; Drascula est au comptoir", () => {
    const w = startInTavern();
    expect(w.state.objExit).toBe(109);
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([52, 56, 109, 110, 112, 113, 114, 115]);
    expect(w.host.music.at(-1)).toBe(14);
    expect(w.state.drascula).toEqual({ x: 155, y: 69, track: 0 });
  });

  it.each([
    [Verb.Look, Tavern.Piano, "440.als"],
    [Verb.Look, Tavern.Poster, "167.als"],
    [Verb.Look, Tavern.Skull, "168.als"],
    [Verb.Talk, Tavern.Skull, "169.als"],
    [Verb.Pick, Tavern.Skull, "170.als"],
    [Verb.Move, Tavern.Skull, "170.als"],
    [Verb.Talk, Tavern.Fans, "455.als"],
    [Verb.Talk, Tavern.Drascula, "455.als"],
  ])("verbe %i sur l'objet %i : la réplique de roomActions", (verb, id, voice) => {
    const w = startInTavern();
    const mark = w.mark();
    w.act(verb, id);
    expect(w.voices(mark)).toEqual([voice]);
  });

  it("les portes : la chambre (109, sortie 108) et l'arrière-salle (110, sortie 111)", () => {
    const w = startInTavern();
    w.goTo(Tavern.BackroomDoor);
    expect(w.room).toBe(61);
    expect(w.state.objExit).toBe(111);
    w.goTo(111);
    expect(w.room).toBe(60);
    expect(w.state.objExit).toBe(110);
    w.goTo(Tavern.BedroomDoor);
    expect(w.room).toBe(59);
    expect(w.state.objExit).toBe(108);
  });

  it("pousser le piano : le son 14 sur une image fixe du comptoir, le barman crie (23), le drapeau 7 est levé", () => {
    const w = startInTavern();
    const mark = w.mark();
    w.selectVerb(Verb.Move);
    const { x, y } = w.pointOf(Tavern.Piano);
    w.player.click(x, y);
    w.until(() => w.state.anim.pianoShot === 1);
    expect(w.hero.visible).toBe(false);
    w.player.move(319, 199);
    w.wait(2);
    w.engine.render();
    const { screen, draw3 } = w.engine.gfx;
    let compared = 0;
    for (let dy = 0; dy < 114; dy += 6) {
      for (let dx = 0; dx < 113; dx += 7) {
        expect(screen.at(155 + dx, 48 + dy)).toBe(draw3.at(164 + dx, 85 + dy));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(200);
    w.settle();
    expect(w.state.anim.pianoShot).toBe(0);
    expect(w.hero.visible).toBe(true);
    expect(w.flags[Flag.PianoMoved]).toBe(1);
    expect(w.voices(mark)).toEqual(["s14.als", "t23.als"]);
  });

  describe("le barman (OP_12)", () => {
    it("parler au barman : 266, sa réponse, le menu de quatre choix ; les trois premiers donnent chacun leur réponse, le quatrième quitte", () => {
      const w = startInTavern();
      const mark = w.mark();
      w.selectVerb(Verb.Talk);
      const { x, y } = w.pointOf(Tavern.Barman);
      w.player.click(x, y);
      w.waitForChoices();
      expect(w.voices(mark)).toEqual(["266.als", "t1.als"]);
      expect(w.engine.choices?.phrases).toHaveLength(4);
      expect(w.engine.choices?.phrases[2]).not.toBe(w.engine.data.text("text", 273));
      expect(w.choose(0)).toBe(true);
      expect(w.choose(1)).toBe(true);
      expect(w.choose(2)).toBe(true);
      expect(w.choose(3)).toBe(false);
      w.settle();
      expect(w.engine.choices).toBeNull();
      expect(w.state.takeObject).toBe(false);
      expect(w.state.pickedObject).toBe(0);
      expect(w.state.inventory).not.toContain(Item.Drink);
      expect(w.flags[Flag.DrinkGiven]).toBe(0);
    });

    it("une fois le piano poussé (drapeau 7), le troisième choix devient « 273 » et la réponse 14 donne l'objet 21 (drapeau 10), qui ferme le dialogue", () => {
      const w = startInTavern();
      w.act(Verb.Move, Tavern.Piano);
      w.selectVerb(Verb.Talk);
      const { x, y } = w.pointOf(Tavern.Barman);
      w.player.click(x, y);
      w.waitForChoices();
      expect(w.engine.choices?.phrases[2]).toBe(w.engine.data.text("text", 273));
      const mark = w.mark();
      expect(w.choose(2)).toBe(false);
      w.settle();
      expect(w.state.inventory).toContain(Item.Drink);
      expect(w.flags[Flag.DrinkGiven]).toBe(1);
      expect(w.voices(mark).at(-1)).toBe("t24.als");
      // Le barman ne donne l'objet qu'à ce choix : au prochain dialogue le troisième choix est « 274 » (réponse 15).
      w.selectVerb(Verb.Talk);
      w.player.click(x, y);
      w.waitForChoices();
      expect(w.engine.choices?.phrases[2]).toBe(w.engine.data.text("text", 274));
      expect(w.choose(2)).toBe(true);
      expect(w.voices(mark).at(-1)).toBe("t16.als");
      expect(w.state.inventory.filter((item) => item === Item.Drink)).toHaveLength(1);
    });
  });

  describe("Drascula", () => {
    it("l'objet 21 sur Drascula : il boit (drapeau 6), l'objet est consommé, la vidéo BEB.BIN joue", () => {
      const w = startInTavern();
      w.engine.addObject(Item.Drink);
      const mark = w.mark();
      w.useItem(Item.Drink, Tavern.Drascula, 60_000);
      expect(w.flags[Flag.DrasculaDrank]).toBe(1);
      expect(w.state.inventory).not.toContain(Item.Drink);
      expect(w.state.takeObject).toBe(false);
      expect(w.voices(mark)).toEqual([]);
      expect(w.engine.gfx.owner).toBe("room");
    });

    it("l'objet 9 sur Drascula avant qu'il ait bu : CNF.BIN puis « Ils m'ignorent » (455) ; l'objet reste en main", () => {
      const w = startInTavern();
      const mark = w.mark();
      w.useItem(Item.Stake, Tavern.Drascula, 60_000);
      expect(w.voices(mark)).toEqual(["455.als"]);
      expect(w.state.pickedObject).toBe(Item.Stake);
      expect(w.host.exits).toBe(0);
      expect(w.room).toBe(60);
    });

    it("l'objet 9 sur Drascula après qu'il a bu : la fin du jeu (animation_9_6, générique), puis l'hôte est prévenu", () => {
      const w = startInTavern();
      w.engine.addObject(Item.Drink);
      w.useItem(Item.Drink, Tavern.Drascula, 60_000);
      const mark = w.mark();
      w.useItem(Item.Stake, Tavern.Drascula, 100_000);
      expect(w.host.exits).toBe(1);
      expect(w.engine.ended).toBe(true);
      const voices = w.voices(mark);
      expect(voices.slice(0, 5)).toEqual(["bj24.als", "bj25.als", "bj26.als", "bj27.als", "bj28.als"]);
      expect(voices.slice(-1)).toEqual(["301.als"]);
      expect(w.flags[Flag.DrasculaGone]).toBe(1);
    });
  });

  describe("l'animation de la pièce", () => {
    it("les bougies avancent toutes les 70 ms, sur trois images", () => {
      const w = startInTavern();
      w.player.move(319, 199);
      const seen = new Set<number>();
      const times: number[] = [];
      let last = w.state.anim.candles ?? 0;
      for (let i = 0; i < 200; i++) {
        w.wait(1);
        const frame = w.state.anim.candles ?? 0;
        seen.add(frame);
        if (frame !== last) {
          times.push(w.engine.ticks);
          last = frame;
        }
      }
      expect([...seen].sort()).toEqual([0, 1, 2]);
      for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBe(7);
    });

    it("la télévision scintille : son écran (8 x 23 en (8, 30)) apparaît et disparaît", () => {
      const w = startInTavern();
      w.player.move(319, 199);
      const states = new Set<number>();
      for (let i = 0; i < 3000 && states.size < 2; i++) {
        w.wait(1);
        states.add(w.state.anim.television ?? 0);
      }
      expect([...states].sort()).toEqual([0, 1]);
      w.state.anim.television = 1;
      w.engine.render();
      const { screen, draw3 } = w.engine.gfx;
      let compared = 0;
      for (let dy = 0; dy < 23; dy += 3) {
        for (let dx = 0; dx < 8; dx += 3) {
          expect(screen.at(8 + dx, 30 + dy)).toBe(draw3.at(114 + dx, 158 + dy));
          compared++;
        }
      }
      expect(compared).toBeGreaterThan(10);
    });

    it("les bougies sont dessinées depuis la feuille annexe : (123, y) copié en (142, 14)", () => {
      const w = startInTavern();
      w.player.move(319, 199);
      w.wait(40);
      w.engine.render();
      const { screen, draw3, dat } = w.engine.gfx;
      const y = dat.candles[w.state.anim.candles ?? 0].y;
      for (let dy = 0; dy < 13; dy += 3) for (let dx = 0; dx < 39; dx += 5) expect(screen.at(142 + dx, 14 + dy)).toBe(draw3.at(123 + dx, y + dy));
    });

    it("Drascula n'est plus dessiné (ni devant, ni derrière le héros) une fois parti (drapeau 5)", () => {
      const w = startInTavern();
      w.player.move(319, 199);
      w.wait(40);
      const sample = () => {
        w.engine.render();
        const out: number[] = [];
        for (let y = 69; y < 146; y += 3) for (let x = 155; x < 200; x += 3) out.push(w.engine.gfx.screen.at(x, y));
        return out.join(",");
      };
      const present = sample();
      w.flags[Flag.DrasculaGone] = 1;
      expect(sample()).not.toBe(present);
    });
  });
});
