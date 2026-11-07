import { describe, expect, it } from "vitest";
import { pauseTicks } from "../../../../src/games/drascula/engine/cadence";
import { Flag, Gate, Item, Start } from "../../../../src/games/drascula/engine/rooms/chapter-3/ids";
import { Plane } from "../../../../src/games/drascula/render/plane";
import { Track, Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";

/** Pièce 13, le vampire du chapitre 3 : `room_13`, `update_13`, `animation_6_3` (réveil) et `animation_2_3` (la croix). */
describe.skipIf(!hasOriginalFiles)("chapitre 3 : le vampire (pièce 13)", () => {
  const enter = () => {
    const w = new Walkthrough({ chapter: 3 });
    w.goTo(Start.Door);
    expect(w.room).toBe(13);
    return w;
  };
  /** Dans la pièce 13 avec le vampire réveillé (le héros a marché jusqu'à lui). */
  const awake = () => {
    const w = enter();
    w.goTo(Gate.Vampire);
    // Le réveil est joué par l'image suivante de la boucle principale (`frame`) : on le laisse finir.
    w.until(() => w.flags[Flag.VampireWoke] === 1).settle();
    expect(w.flags[Flag.AsleepHidden]).toBe(1);
    return w;
  };

  it("on arrive par la porte 101 : les objets sont ceux de la fiche, le vampire dort", () => {
    const w = enter();
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([Gate.Door, Gate.Vampire]);
    expect(w.flags.slice(0, 4)).toEqual([0, 1, 0, 0]);
    expect(w.hero.x).toBe(45);
    expect(w.hero.track).toBe(Track.Right);
  });

  describe("le réveil (animation_6_3)", () => {
    it("tant que le héros reste à gauche de x = 55, le vampire dort", () => {
      const w = enter();
      w.player.move(60, 160);
      w.wait(200);
      expect(w.flags[Flag.VampireWoke]).toBe(0);
      expect(w.state.anim.vampireSheet ?? 0).toBe(0);
    });

    it("le héros qui marche au-delà de x = 55 s'arrête : le vampire se réveille en six images, le héros reste là", () => {
      const w = enter();
      const mark = w.mark();
      w.clickAt(250, 160);
      w.until(() => w.flags[Flag.VampireWoke] === 1).settle();
      expect(w.flags[Flag.VampireWoke]).toBe(1);
      expect(w.hero.x).toBeGreaterThan(55);
      expect(w.hero.x).toBeLessThanOrEqual(55 + 8);
      expect(w.hero.moving).toBe(false);
      expect(w.voices(mark)).toEqual([]);
      // Le vampire réveillé a remplacé le vampire endormi, qui a disparu.
      expect(w.flags.slice(1, 3)).toEqual([0, 1]);
      expect(w.state.anim.vampireSheet).toBe(0);
    });

    it("les six images de la feuille an4y.alg se succèdent dans le rectangle (112, 62, 78, 90)", () => {
      const w = enter();
      w.player.click(250, 160);
      const seen: Array<[number, number]> = [];
      w.until(() => {
        const a = w.state.anim;
        if (a.vampireSheet) {
          const key: [number, number] = [a.vampireSX, a.vampireSY];
          if (seen.length === 0 || seen[seen.length - 1][0] !== key[0] || seen[seen.length - 1][1] !== key[1]) seen.push(key);
          expect([a.vampireX, a.vampireY, a.vampireW, a.vampireH]).toEqual([112, 62, 78, 90]);
        }
        return w.flags[Flag.AsleepHidden] === 1;
      });
      // La dernière image est remplacée dans le même tick par l'image du vampire réveillé.
      expect(seen).toEqual([[3, 3], [82, 3], [161, 3], [240, 3], [3, 94], [82, 94]].slice(0, seen.length));
      expect(seen.length).toBeGreaterThanOrEqual(5);
    });

    it("le rectangle d'une image est dessiné : décor, puis feuille", () => {
      const w = enter();
      w.player.click(250, 160);
      w.until(() => w.state.anim.vampireSheet === 4 && w.state.anim.vampireSX === 161);
      w.engine.render();
      const { screen, draw2 } = w.engine.gfx;
      let compared = 0;
      for (let y = 0; y < 90; y += 9) {
        for (let x = 0; x < 78; x += 7) {
          const source = draw2.at(161 + x, 3 + y);
          if (source === 255) continue;
          expect(screen.at(112 + x, 62 + y)).toBe(source);
          compared++;
        }
      }
      expect(compared).toBeGreaterThan(10);
    });

    it("parler au vampire d'un clic : l'animation passe avant le dialogue, qui se joue depuis le point où le héros s'est arrêté", () => {
      const w = enter();
      w.selectVerb(Verb.Talk);
      const { x, y } = w.pointOf(Gate.Vampire);
      w.player.click(x, y);
      w.until(() => w.flags[Flag.VampireWoke] === 1);
      w.waitForChoices();
      expect(w.hero.x).toBeLessThanOrEqual(63);
    });

    it("le vampire réveillé est dessiné à (121, 65) depuis (185, 110)", () => {
      const w = awake();
      w.player.move(319, 0);
      w.wait(40);
      w.engine.render();
      const { screen, draw3 } = w.engine.gfx;
      let compared = 0;
      // Au-dessus de l'avant-plan (qui commence à la ligne 102) : le vampire seul.
      for (let y = 0; y < 36; y += 4) {
        for (let x = 0; x < 67; x += 6) {
          const source = draw3.at(185 + x, 110 + y);
          if (source === 255) continue;
          expect(screen.at(121 + x, 65 + y)).toBe(source);
          compared++;
        }
      }
      expect(compared).toBeGreaterThan(10);
    });

    it("l'avant-plan (3, 127, 181 x 71) est dessiné en (99, 102) par-dessus le vampire", () => {
      const w = awake();
      w.player.move(319, 0);
      w.wait(40);
      w.engine.render();
      const { screen, draw3 } = w.engine.gfx;
      let compared = 0;
      for (let y = 0; y < 71; y += 7) {
        for (let x = 0; x < 181; x += 9) {
          const source = draw3.at(3 + x, 127 + y);
          if (source === 255) continue;
          expect(screen.at(99 + x, 102 + y)).toBe(source);
          compared++;
        }
      }
      expect(compared).toBeGreaterThan(20);
    });

    it("endormi, le vampire est dessiné à (121, 63) depuis (185, 21)", () => {
      const w = enter();
      w.player.move(319, 0);
      w.wait(40);
      w.engine.render();
      const { screen, draw3 } = w.engine.gfx;
      let compared = 0;
      for (let y = 0; y < 30; y += 5) {
        for (let x = 0; x < 67; x += 6) {
          const source = draw3.at(185 + x, 21 + y);
          if (source === 255) continue;
          expect(screen.at(121 + x, 63 + y)).toBe(source);
          compared++;
        }
      }
      expect(compared).toBeGreaterThan(10);
    });
  });

  describe("les verbes", () => {
    it("regarder le vampire : 411, le héros se tourne vers nous, 412 ; le vampire s'appelle « yoda » au survol", () => {
      const w = enter();
      expect(w.engine.room.objects[1].name).not.toBe("yoda");
      const mark = w.mark();
      w.act(Verb.Look, Gate.Vampire);
      expect(w.voices(mark)).toEqual(["411.als", "412.als"]);
      expect(w.hero.track).toBe(Track.Down);
      expect(w.engine.room.objects[1].name).toBe("yoda");
    });

    it("parler au vampire : le dialogue 7, chaque réponse du vampire est suivie du grognement du héros", () => {
      const w = enter();
      const mark = w.mark();
      w.selectVerb(Verb.Talk);
      const { x, y } = w.pointOf(Gate.Vampire);
      w.player.click(x, y);
      w.waitForChoices();
      expect(w.engine.choices!.phrases.length).toBeGreaterThan(0);
      expect(w.choose(0)).toBe(true);
      expect(w.voices(mark)).toContain("s10.als");
    });

    it("la pièce (19) au vampire : 413, le grognement, une attente, 414 ; le chapitre continue", () => {
      const w = enter();
      const mark = w.mark();
      w.useItem(Item.Coin, Gate.Vampire);
      expect(w.voices(mark)).toEqual(["413.als", "s10.als", "414.als"]);
      expect(w.state.chapter).toBe(3);
      expect(w.room).toBe(13);
    });

    it.each([
      [Verb.Pick, "318.als"],
      [Verb.Move, "317.als"],
      [Verb.Open, "319.als"],
      [Verb.Close, "319.als"],
    ])("verbe %i sur le vampire : réponse par défaut du chapitre 3 (%s)", (verb, voice) => {
      const w = awake();
      const mark = w.mark();
      w.act(verb, Gate.Vampire);
      expect(w.voices(mark)).toEqual([voice]);
    });

    it("un autre objet de l'inventaire sur le vampire : réponse par défaut (318)", () => {
      const w = awake();
      const mark = w.mark();
      w.useItem(14, Gate.Vampire);
      expect(w.voices(mark)).toEqual(["318.als"]);
      expect(w.state.chapter).toBe(3);
    });

    it("regarder le vampire après son réveil : même réponse", () => {
      const w = awake();
      const mark = w.mark();
      w.act(Verb.Look, Gate.Vampire);
      expect(w.voices(mark)).toEqual(["411.als", "412.als"]);
    });
  });

  describe("les portes", () => {
    it("la porte 101 ramène à la pièce 20, par le point d'arrivée de la porte 100", () => {
      const w = enter();
      w.goTo(Gate.Door);
      expect(w.room).toBe(20);
      expect(w.state.objExit).toBe(Start.Door);
      expect(w.state.chapter).toBe(3);
    });

    it("après le réveil, le vampire reste réveillé quand on revient (le drapeau 3 est gardé), mais pas l'image de la pièce rechargée", () => {
      const w = awake();
      w.goTo(Gate.Door);
      expect(w.room).toBe(20);
      w.goTo(Start.Door);
      expect(w.room).toBe(13);
      expect(w.flags.slice(0, 4)).toEqual([0, 0, 1, 1]);
      w.wait(300);
      expect(w.flags[Flag.VampireWoke]).toBe(1);
    });
  });

  describe("la croix (animation_2_3)", () => {
    it("la croix sur le vampire joue les trois temps puis le chapitre 4 commence", () => {
      const w = enter();
      w.takeItem(Item.Cross);
      const { x, y } = w.pointOf(Gate.Vampire);
      w.player.click(x, y);
      // Le héros brandit la croix : pose fixe (drapeau 0), musique 13, cadres de la feuille an2y_1.
      w.until(() => w.flags[Flag.Attacking] === 1);
      expect(w.host.music.at(-1)).toBe(13);
      w.until(() => (w.state.anim.heroSheet ?? 0) > 0);
      expect(w.state.anim.heroSheet).toBe(1);
      expect([w.state.anim.heroW, w.state.anim.heroH]).toEqual([71, 72]);
      expect(w.state.anim.heroX).toBe(w.hero.x - 20);
      expect(w.state.anim.heroY).toBe(w.hero.y - 1);
      // Le vampire se tord (any_*), puis disparaît : plus aucune image fixe.
      w.until(() => (w.state.anim.vampireSheet ?? 0) > 0);
      expect([w.state.anim.vampireX, w.state.anim.vampireY, w.state.anim.vampireW, w.state.anim.vampireH]).toEqual([120, 63, 77, 89]);
      w.until(() => !w.state.anim.vampireSheet);
      expect(w.flags.slice(0, 3)).toEqual([1, 1, 1]);
      // Le héros range la croix (an3y_*), reprend sa marche et sort par la droite.
      w.until(() => w.flags[Flag.Attacking] === 0, 60_000);
      expect(w.state.chapter).toBe(3);
      w.settle(60_000);
      expect(w.state.chapter).toBe(4);
      expect(w.room).toBe(21);
    });

    it("la croix est jouée à plein temps : 72 images (3 feuilles x 2 rangées x 4 images x 3 temps), 3 pauses chacune", () => {
      const w = enter();
      w.takeItem(Item.Cross);
      const { x, y } = w.pointOf(Gate.Vampire);
      w.player.click(x, y);
      w.until(() => w.flags[Flag.Attacking] === 1);
      const start = w.engine.ticks;
      w.until(() => w.flags[Flag.Attacking] === 0, 60_000);
      const duration = w.engine.ticks - start;
      // 72 pauses de 3, avant la marche finale.
      expect(duration).toBe(72 * pauseTicks(3));
    });

    /** Le rectangle du héros à l'écran : le décor, puis `sheet` en (`sourceX`, `sourceY`) (`updateAnim` : `copyBackground`, `copyRect`). */
    const expectedHeroRect = (w: Walkthrough, sheet: string, sourceX: number, sourceY: number): Plane => {
      const expected = new Plane();
      const x = w.hero.x - 20;
      const y = w.hero.y - 1;
      expected.copyBackground(w.engine.gfx.bg, x, y, x, y, 71, 72);
      expected.copyRect(w.engine.gfx.sheet(sheet), sourceX, sourceY, x, y, 71, 72);
      return expected;
    };
    const sameRect = (w: Walkthrough, expected: Plane): boolean => {
      const screen = w.host.screen!;
      const x = w.hero.x - 20;
      const y = w.hero.y - 1;
      for (let j = 0; j < 72; j++) for (let i = 0; i < 71; i++) if (screen[(y + j) * 320 + x + i] !== expected.at(x + i, y + j)) return false;
      return true;
    };

    it("le héros reste dessiné pendant que le vampire se tord : ses pixels sont ceux de sa dernière image, sans traits de découpe", () => {
      const w = enter();
      w.takeItem(Item.Cross);
      const { x, y } = w.pointOf(Gate.Vampire);
      w.player.click(x, y);
      w.until(() => w.flags[Flag.Attacking] === 1);
      // Dernière image du héros avant le vampire : an2y_3.alg, rangée 75, quatrième image. `front`, `extra` et `back` reçoivent ensuite
      // les feuilles du vampire (any_*), qui ne doivent pas servir à redessiner le héros.
      const expected = expectedHeroRect(w, "an2y_3.alg", 217, 75);
      let frames = 0;
      let cuts = 0;
      w.until(() => {
        w.engine.render();
        const screen = w.host.screen!;
        for (let i = 0; i < screen.length; i++) if (screen[i] === 254) cuts++;
        if (w.state.anim.vampireSheet) {
          frames++;
          expect(sameRect(w, expected), `image ${frames} du vampire`).toBe(true);
        }
        return w.flags[Flag.Attacking] === 0;
      }, 60_000);
      expect(frames).toBeGreaterThanOrEqual(24);
      // 254 est la couleur des traits qui découpent les feuilles et l'image fixe du héros (`draw3`, 77 x 89) : jamais à l'écran.
      expect(cuts).toBe(0);
    });

    it("le héros range la croix : chaque image (an3y_*) est celle de la feuille, ses pixels ne viennent d'aucune autre", () => {
      const w = enter();
      w.takeItem(Item.Cross);
      const { x, y } = w.pointOf(Gate.Vampire);
      w.player.click(x, y);
      w.until(() => w.flags[Flag.Attacking] === 1);
      w.until(() => w.flags[Flag.AwakeHidden] === 1 && !w.state.anim.vampireSheet && w.state.anim.heroSX === 1 && w.state.anim.heroSY === 2 && w.state.anim.heroSheet === 1, 60_000);
      const sheets = ["an3y_1.alg", "an3y_2.alg", "an3y_3.alg"];
      let checked = 0;
      w.until(() => {
        w.engine.render();
        const a = w.state.anim;
        if (a.heroSheet) {
          expect(sameRect(w, expectedHeroRect(w, sheets[a.heroSheet - 1], a.heroSX, a.heroSY)), `image ${checked + 1}`).toBe(true);
          checked++;
        }
        return w.flags[Flag.Attacking] === 0;
      }, 60_000);
      expect(checked).toBeGreaterThanOrEqual(24);
    });

    it("les feuilles du héros sont remises après l'animation (96, 97, 99)", () => {
      const w = enter();
      w.takeItem(Item.Cross);
      const { x, y } = w.pointOf(Gate.Vampire);
      w.player.click(x, y);
      w.until(() => w.flags[Flag.Attacking] === 0 && w.flags[Flag.VampireWoke] === 1 && !w.state.anim.heroSheet, 60_000);
      const { front, extra, back } = w.engine.gfx;
      expect(front.at(0, 0)).toBe(w.engine.gfx.sheet(96).at(0, 0));
      expect(extra.at(10, 10)).toBe(w.engine.gfx.sheet(97).at(10, 10));
      expect(back.at(10, 10)).toBe(w.engine.gfx.sheet(99).at(10, 10));
    });
  });
});
