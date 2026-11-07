import { describe, expect, it } from "vitest";
import { Corridor, Dungeon, Flag, Item } from "../../../../src/games/drascula/engine/rooms/chapter-6/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { startChapter6 } from "./start";

/**
 * Pièce 102, le cachot : le héros ligoté sous le pendule, mis en place par la cinématique de début (`animation_1_6`, `activatePendulum`).
 * On y entre uniquement par cette cinématique (pas de porte) ; `animation_6_6` en sort, par la pièce 58.
 */
describe.skipIf(!hasOriginalFiles)("chapitre 6 : le cachot (pièce 102)", () => {
  it("la cinématique de début arme le pendule : pièce 102, héros invisible et ligoté, chaîne descendue", () => {
    const w = startChapter6();
    expect(w.room).toBe(102);
    expect(w.hero.visible).toBe(false);
    expect([w.flags[Flag.Free], w.flags[Flag.Pendulum], w.flags[Flag.ChainLowered]]).toEqual([0, 2, 1]);
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([100, 101, 50, 102]);
    expect(w.host.music.at(-1)).toBe(24);
    expect(w.state.inventory).toEqual(expect.arrayContaining([Item.Phone, Item.Stake]));
  });

  it("l'introduction : les trois choix de Drascula puis la sortie du dialogue 11 donnent leurs répliques", () => {
    const w = startChapter6();
    const voices = w.voices();
    for (const voice of ["d19.als", "247.als", "d23.als", "250.als", "251.als", "252.als", "253.als", "d35.als"]) expect(voices, voice).toContain(voice);
    expect(voices.at(-1)).toBe("d35.als");
    expect(voices.indexOf("i11.als")).toBeLessThan(voices.indexOf("i12.als"));
  });

  it.each([
    [Verb.Look, Dungeon.Pendulum, "452.als"],
    [Verb.Look, Dungeon.Reach, "123.als"],
  ])("verbe %i sur l'objet %i : la réplique de roomActions, dite par le héros sous le pendule", (verb, id, voice) => {
    const w = startChapter6();
    const mark = w.mark();
    w.act(verb, id);
    expect(w.voices(mark)).toEqual([voice]);
  });

  it("se regarder (objet 50) : « Et après comment je me ferme ? » (310) tant que le héros est ligoté", () => {
    const w = startChapter6();
    const mark = w.mark();
    w.act(Verb.Look, 50);
    expect(w.voices(mark)).toEqual(["310.als"]);
  });

  it("prendre ou ouvrir autre chose que l'objet 101 : les mains sont menottées (453)", () => {
    const w = startChapter6();
    const mark = w.mark();
    w.act(Verb.Pick, Dungeon.Pendulum);
    w.act(Verb.Open, Dungeon.Shackles);
    w.act(Verb.Open, Dungeon.Reach);
    expect(w.voices(mark)).toEqual(["453.als", "453.als", "453.als"]);
    expect(w.state.pickedObject).not.toBe(Item.Blade);
  });

  it("les autres verbes : les réponses du chapitre (pièce 0)", () => {
    const w = startChapter6();
    const mark = w.mark();
    w.act(Verb.Close, Dungeon.Shackles);
    w.act(Verb.Talk, Dungeon.Pendulum);
    w.act(Verb.Move, Dungeon.Pendulum);
    expect(w.voices(mark)).toEqual(["9.als", "16.als", "19.als"]);
  });

  it("prendre l'objet 101 met l'objet 20 en main, sans un mot", () => {
    const w = startChapter6();
    const mark = w.mark();
    w.act(Verb.Pick, Dungeon.Reach);
    expect(w.state.pickedObject).toBe(Item.Blade);
    expect(w.state.takeObject).toBe(true);
    expect(w.voices(mark)).toEqual([]);
  });

  it("l'objet 20 ailleurs que sur le pendule : la réponse par défaut, rien n'est coupé", () => {
    const w = startChapter6();
    w.act(Verb.Pick, Dungeon.Reach);
    const mark = w.mark();
    const { x, y } = w.pointOf(Dungeon.Shackles);
    w.clickAt(x, y);
    expect(w.room).toBe(102);
    expect(w.voices(mark).length).toBe(1);
    expect(w.flags[Flag.Free]).toBe(0);
  });

  describe("le pendule", () => {
    it("il passe à l'image suivante toutes les 90 ms : 17 images, puis retour à la première", () => {
      const w = startChapter6();
      w.player.move(319, 199);
      let last = w.state.anim.pendulum ?? 0;
      const changes: number[] = [];
      const seen: number[] = [];
      for (let i = 0; i < 400; i++) {
        w.wait(1);
        const frame = w.state.anim.pendulum ?? 0;
        if (frame !== last) {
          changes.push(w.engine.ticks);
          seen.push(frame);
          last = frame;
        }
      }
      for (let i = 1; i < changes.length; i++) expect(changes[i] - changes[i - 1]).toBe(9);
      for (let i = 1; i < seen.length; i++) expect(seen[i]).toBe((seen[i - 1] + 1) % 17);
      expect(Math.max(...seen)).toBe(16);
      expect(seen).toContain(0);
    });

    it("son dessin vient de la feuille de l'image : AN_P1 jusqu'à l'image 4, AN_P2 jusqu'à la 11, AN_P3 ensuite", () => {
      const w = startChapter6();
      w.player.move(319, 199);
      w.wait(2);
      const { screen, draw3, extra, front } = w.engine.gfx;
      const columns = [40, 96, 152, 208, 264, 40, 96, 152, 208, 208, 152, 264, 40, 96, 152, 208, 264];
      for (const [frame, sheet] of [[0, draw3], [4, draw3], [5, extra], [11, extra], [12, front], [16, front]] as const) {
        w.state.anim.pendulum = frame;
        w.state.savedTime = w.engine.ticks + 1_000_000; // le pendule reste sur l'image choisie
        w.engine.render();
        let compared = 0;
        // au-dessus du héros ligoté, qui est dessiné par-dessus le bas du pendule
        for (let dy = 0; dy < 100; dy += 7) {
          for (let dx = 0; dx < 55; dx += 6) {
            expect(screen.at(152 + dx, dy), `image ${frame}`).toBe(sheet.at(columns[frame] + dx, 19 + dy));
            compared++;
          }
        }
        expect(compared).toBeGreaterThan(50);
      }
    });

    it("le héros ligoté en bas : une image avant sa première réplique (drapeau 1 à 2), une autre après (drapeau 1 à 0)", () => {
      const w = startChapter6();
      w.player.move(319, 199);
      w.wait(2);
      const { screen, draw3 } = w.engine.gfx;
      const check = (column: number) => {
        w.state.savedTime = w.engine.ticks + 1_000_000;
        w.engine.render();
        let compared = 0;
        for (let dy = 0; dy < 29; dy += 3) {
          for (let dx = 0; dx < 25; dx += 3) {
            const source = draw3.at(column + dx, 145 + dy);
            if (source === 255) continue;
            expect(screen.at(145 + dx, 105 + dy)).toBe(source);
            compared++;
          }
        }
        expect(compared).toBeGreaterThan(20);
      };
      expect(w.flags[Flag.Pendulum]).toBe(2);
      check(18);
      w.act(Verb.Look, 50);
      expect(w.flags[Flag.Pendulum]).toBe(0);
      w.player.move(319, 199);
      w.wait(2);
      check(44);
    });

    it("pendant une réplique le drapeau 1 vaut 1 (la tête qui parle remplace le héros ligoté)", () => {
      const w = startChapter6();
      w.selectVerb(Verb.Look);
      const { x, y } = w.pointOf(50);
      w.player.click(x, y);
      w.until(() => w.flags[Flag.Pendulum] === 1);
      w.settle();
      expect(w.flags[Flag.Pendulum]).toBe(0);
    });
  });

  describe("couper les liens (animation_6_6)", () => {
    it("la lame sur le pendule : le héros tombe dans le couloir (pièce 58), libre ; la lame est consommée", () => {
      const w = startChapter6();
      w.act(Verb.Pick, Dungeon.Reach);
      w.useItem(Item.Blade, Dungeon.Pendulum, 60_000);
      expect(w.room).toBe(58);
      expect(w.state.chapter).toBe(6);
      expect(w.state.objExit).toBe(Corridor.SecretDoor);
      expect([w.flags[Flag.Free], w.flags[Flag.Pendulum], w.flags[Flag.CorridorEmpty]]).toEqual([1, 0, 1]);
      expect(w.hero.visible).toBe(true);
      expect(w.state.inventory).not.toContain(Item.Blade);
      expect(w.state.takeObject).toBe(false);
      expect(w.engine.gfx.owner).toBe("room");
      expect(w.host.music.at(-1)).toBe(4);
    });

    it("Échap saute les deux vidéos, la suite est quand même jouée", () => {
      const w = startChapter6();
      w.act(Verb.Pick, Dungeon.Reach);
      w.takeItem(Item.Blade);
      const { x, y } = w.pointOf(Dungeon.Pendulum);
      w.player.click(x, y);
      w.until(() => w.engine.gfx.owner === "canvas"); // RCT.BIN
      w.key("Escape");
      w.until(() => w.room === 58 && w.engine.gfx.owner === "canvas"); // HBP.BIN
      w.key("Escape");
      w.settle(60_000);
      expect(w.room).toBe(58);
      expect(w.flags[Flag.Free]).toBe(1);
      expect(w.hero.visible).toBe(true);
    });

    it("le héros libre se regarde : « Whaou ! Ne suis-je pas magnifique ! » (308)", () => {
      const w = startChapter6();
      w.act(Verb.Pick, Dungeon.Reach);
      w.useItem(Item.Blade, Dungeon.Pendulum, 60_000);
      const mark = w.mark();
      w.selectVerb(Verb.Look);
      w.player.click(w.hero.x + 20, w.hero.y + 30);
      w.settle();
      expect(w.voices(mark)).toEqual(["308.als"]);
    });
  });
});
