import { describe, expect, it } from "vitest";
import { Flag, Inn } from "../../../../src/games/drascula/engine/rooms/chapter-1/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";

/** Pièce 62, l'auberge du chapitre 1 : verbes, objets, portes, animations de la pièce. */
describe.skipIf(!hasOriginalFiles)("chapitre 1 : l'auberge (pièce 62)", () => {
  it("on arrive dans l'auberge, les objets sont ceux de la fiche", () => {
    const w = new Walkthrough();
    expect(w.room).toBe(62);
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([52, 53, 54, 100, 101, 102, 103, 104, 105, 106]);
    expect(w.flags[Flag.BarmanSpoke]).toBe(0);
    expect(w.host.music[0]).toBe(21);
  });

  it.each([
    [100, "168.als"],
    [101, "171.als"],
    [102, "167.als"],
    [103, "166.als"],
  ])("regarder l'objet %i : la réplique de roomActions", (id, voice) => {
    const w = new Walkthrough();
    const mark = w.mark();
    w.act(Verb.Look, id);
    expect(w.voices(mark)).toEqual([voice]);
  });

  it("la tête de mort : parler (169), prendre (170)", () => {
    const w = new Walkthrough();
    let mark = w.mark();
    w.act(Verb.Talk, Inn.Skull);
    expect(w.voices(mark)).toEqual(["169.als"]);
    mark = w.mark();
    w.act(Verb.Pick, Inn.Skull);
    expect(w.voices(mark)).toEqual(["170.als"]);
  });

  it("un verbe sans réponse propre : la réplique par défaut du chapitre 1 (pièce 0)", () => {
    const w = new Walkthrough();
    const mark = w.mark();
    w.act(Verb.Look, Inn.Barman);
    expect(w.voices(mark)).toEqual(["54.als"]);
    const next = w.mark();
    w.act(Verb.Open, Inn.Pianist);
    expect(w.voices(next)).toEqual(["9.als"]);
  });

  it("parler au barman : le scénario 3, qui lève le drapeau 0 ; la fois suivante, la réplique 109", () => {
    const w = new Walkthrough();
    const mark = w.mark();
    w.act(Verb.Talk, Inn.Barman);
    expect(w.flags[Flag.BarmanSpoke]).toBe(1);
    // Scénario 3 : le héros et le barman en alternance (192, t1, 193, t2…).
    expect(w.voices(mark).slice(0, 4)).toEqual(["192.als", "t1.als", "193.als", "t2.als"]);
    const next = w.mark();
    w.act(Verb.Talk, Inn.Barman);
    expect(w.voices(next)).toEqual(["109.als"]);
  });

  it("parler au pianiste : il se retourne, la musique s'arrête, quatre échanges, tout est remis", () => {
    const w = new Walkthrough();
    const mark = w.mark();
    w.selectVerb(Verb.Talk);
    const { x, y } = w.pointOf(Inn.Pianist);
    w.player.click(x, y);
    // Le pianiste se retourne : première puis seconde image de `an12.alg`.
    w.until(() => w.state.anim.pianistTurn === 1);
    w.until(() => w.state.anim.pianistTurn === 2);
    w.until(() => w.flags[Flag.PianistTalking] === 1);
    expect(w.state.anim.pianistTurn).toBe(0);
    expect(w.host.musicPlaying()).toBe(false);
    w.settle();
    expect(w.voices(mark)).toEqual(["205.als", "p1.als", "206.als", "p2.als", "207.als", "p3.als", "208.als", "p4.als", "209.als"]);
    expect(w.flags[Flag.PianistTalking]).toBe(0);
    // La musique de la pièce reprend.
    w.wait(20);
    expect(w.host.musicPlaying()).toBe(true);
  });

  it("parler à l'ivrogne : le menu de dialogue OP_13, les trois choix puis la sortie", () => {
    const w = new Walkthrough();
    const mark = w.mark();
    w.selectVerb(Verb.Talk);
    const { x, y } = w.pointOf(Inn.Drunk);
    w.player.click(x, y);
    w.waitForChoices();
    expect(w.engine.choices?.phrases).toHaveLength(4);
    expect(w.choose(0)).toBe(true);
    expect(w.choose(1)).toBe(true);
    expect(w.choose(2)).toBe(true);
    expect(w.choose(3)).toBe(false);
    w.settle();
    const spoken = w.voices(mark);
    for (const drunk of ["b1.als", "b2.als", "b3.als"]) expect(spoken).toContain(drunk);
    expect(w.engine.choices).toBeNull();
  });

  describe("les portes", () => {
    it("la porte du fond est refusée (réplique 442) tant que le barman n'a pas parlé", () => {
      const w = new Walkthrough();
      const mark = w.mark();
      w.goTo(Inn.Back);
      expect(w.voices(mark)).toEqual(["442.als"]);
      expect(w.room).toBe(62);
      expect(w.state.chapter).toBe(1);
    });

    it("la porte de la rue est condamnée : le héros s'en approche, rien d'autre", () => {
      const w = new Walkthrough();
      const mark = w.mark();
      w.goTo(Inn.Street);
      expect(w.room).toBe(62);
      expect(w.voices(mark)).toEqual([]);
      const door = w.engine.room.objects.find((o) => o.id === Inn.Street)!;
      expect(w.hero.x + Math.trunc(w.hero.width / 2)).toBeGreaterThan(door.approach.x - 8);
      expect(w.hero.x + Math.trunc(w.hero.width / 2)).toBeLessThanOrEqual(door.approach.x);
    });

    it("la porte des toilettes mène à la pièce 63, où l'on arrive par la porte 107", () => {
      const w = new Walkthrough();
      w.goTo(Inn.Toilets);
      expect(w.room).toBe(63);
      expect(w.state.objExit).toBe(107);
    });
  });

  describe("le dessin de la pièce", () => {
    it("les bougies, le pianiste, l'ivrogne et le clignement avancent toutes les 70 ms", () => {
      const w = new Walkthrough();
      w.state.savedTime = w.engine.ticks;
      const seen = new Set<number>();
      const changes: number[] = [];
      let previous = w.state.anim.candles ?? 0;
      for (let i = 0; i < 300; i++) {
        w.wait(1);
        const frame = w.state.anim.candles ?? 0;
        seen.add(frame);
        if (frame !== previous) changes.push(w.engine.ticks);
        previous = frame;
      }
      expect([...seen].sort()).toEqual([0, 1, 2]);
      expect(w.state.anim.pianist).toBeGreaterThan(0);
      expect(w.state.anim.blinking).toBeLessThanOrEqual(10);
      // `getTime() - savedTime > 6` : une image tous les 7 ticks.
      expect(changes.length).toBeGreaterThan(30);
      expect(new Set(changes.slice(1).map((tick, i) => tick - changes[i]))).toEqual(new Set([7]));
    });

    it("le geste de l'ivrogne (drapeau 12) dure 8 images puis retombe", () => {
      const w = new Walkthrough();
      w.flags[Flag.DrunkGesture] = 1;
      w.state.anim.drunk = 0;
      const frames: number[] = [];
      for (let i = 0; i < 80 && w.flags[Flag.DrunkGesture] === 1; i++) {
        w.wait(1);
        frames.push(w.state.anim.drunk);
      }
      expect(w.flags[Flag.DrunkGesture]).toBe(0);
      expect(w.state.anim.drunk).toBe(0);
      expect(Math.max(...frames)).toBe(7);
    });

    it("pas de geste pendant que l'ivrogne parle (drapeau 13)", () => {
      const w = new Walkthrough({ seed: 7 });
      w.flags[Flag.DrunkTalking] = 1;
      w.wait(5000);
      expect(w.flags[Flag.DrunkGesture]).toBe(0);
    });

    it("les bougies sont recopiées de la feuille annexe selon l'image courante", () => {
      const w = new Walkthrough();
      w.player.move(319, 199);
      w.wait(40);
      const { dat } = w.engine.data;
      for (const frame of [0, 1, 2]) {
        w.state.anim.candles = frame;
        w.engine.render();
        const { screen, draw3 } = w.engine.gfx;
        // La bougie du haut : 39 x 13 pixels de la feuille annexe à (123, candles[frame].y), dessinés en (142, 14).
        for (const [dx, dy] of [[0, 0], [10, 5], [38, 12]]) {
          expect(screen.at(142 + dx, 14 + dy)).toBe(draw3.at(123 + dx, dat.candles[frame].y + dy));
        }
      }
    });

    it("le premier plan (2aux62.alg) est dessiné par-dessus le héros dans le coin haut gauche", () => {
      const w = new Walkthrough();
      w.player.move(319, 199);
      w.wait(40);
      w.engine.render();
      const { screen, draw2 } = w.engine.gfx;
      let compared = 0;
      for (let y = 1; y < 143; y += 7) {
        for (let x = 1; x < 63; x += 5) {
          const source = draw2.at(x, y);
          if (source === 255) continue;
          expect(screen.at(x - 1, y - 1)).toBe(source);
          compared++;
        }
      }
      expect(compared).toBeGreaterThan(5);
    });
  });
});
