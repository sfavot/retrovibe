import { describe, expect, it } from "vitest";
import { chapter2 } from "../../../../src/games/drascula/engine/rooms/chapter-2";
import { Bedroom, Chapel, Crossroads, Flag, HERO, Hut, Item } from "../../../../src/games/drascula/engine/rooms/chapter-2/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { go, objectOf, startIn } from "./route";

/** Les règles du chapitre 2 qui ne sont pas à une pièce : `checkAction`, `updateDoor`, `roomLoaded`, `leaving`, noms des cinématiques. */
describe("chapitre 2 : le script", () => {
  it("les pièces, les painters et les cinématiques sont ceux du chapitre (pièces 1 à 9, 12, 14 à 18 ; dix-neuf cinématiques de pièce)", () => {
    expect(Object.keys(chapter2.rooms ?? {}).map(Number)).toEqual([1, 3, 4, 5, 6, 7, 8, 9, 12, 14, 15, 16, 17, 18]);
    expect(Object.keys(chapter2.painters ?? {}).map(Number)).toEqual([1, 2, 3, 4, 6, 9, 14, 16, 18]);
    const names = Object.keys(chapter2.animations ?? {});
    expect(names).toHaveLength(21);
    for (const name of names) expect(name).toMatch(/^\d+_2$/);
  });
});

describe.skipIf(!hasOriginalFiles)("chapitre 2 : les règles du chapitre", () => {
  describe("checkAction", () => {
    it("le sac de B.J. regardé dans l'inventaire : « un billet de mille et deux pièces » (164), le billet et les pièces entrent ; la fois suivante 307", () => {
      const w = startIn(14, { items: [Item.Handbag] });
      let mark = w.mark();
      w.verbOnItem(Verb.Look, Item.Handbag);
      expect(w.voices(mark)).toEqual(["164.als"]);
      expect(w.flags[Flag.HandbagOpened]).toBe(1);
      expect(w.state.inventory).toEqual(expect.arrayContaining([Item.Money, Item.TwoCoins]));
      mark = w.mark();
      w.verbOnItem(Verb.Look, Item.Handbag);
      expect(w.voices(mark)).toEqual(["307.als"]);
    });

    it("le sac ouvert avec le verbe Ouvrir donne la même chose", () => {
      const w = startIn(14, { items: [Item.Handbag] });
      w.verbOnItem(Verb.Open, Item.Handbag);
      expect(w.flags[Flag.HandbagOpened]).toBe(1);
      expect(w.state.inventory).toContain(Item.Money);
    });

    it("les objets de l'inventaire regardés : roomActions de la pièce 200 (le téléphone 328)", () => {
      const w = startIn(14);
      const mark = w.mark();
      w.verbOnItem(Verb.Look, Item.Phone);
      expect(w.voices(mark)).toEqual(["328.als"]);
    });

    it("les bouchons d'oreilles sur le héros : « je les mettrai le moment venu » (315) partout sauf au laboratoire", () => {
      const w = startIn(14, { items: [Item.Earplugs] });
      const mark = w.mark();
      w.takeItem(Item.Earplugs);
      w.clickAt(w.hero.x + 12, w.hero.y + 35);
      expect(w.voices(mark)).toEqual(["315.als"]);
      expect(HERO).toBe(50);
    });
  });

  describe("updateDoor", () => {
    it("les portes de la table `doors` suivent leur drapeau à l'entrée dans la pièce", () => {
      const closed = startIn(6);
      expect(objectOf(closed, Bedroom.Door).isDoor).toBe(false);
      const open = startIn(6, { flags: { [Flag.BedroomDoorOpen]: 1 } });
      expect(objectOf(open, Bedroom.Door).isDoor).toBe(true);
      // La porte de la chapelle (164) n'est pas dans la table : elle est toujours ouverte.
      expect(objectOf(startIn(7), Chapel.ToWell).isDoor).toBe(true);
    });

    it("la fenêtre de la pièce 5, la porte de la rue (12), la chambre (16), la cabane (17), le puits (19) : leurs drapeaux", () => {
      expect(objectOf(startIn(5), 136).isDoor).toBe(false);
      expect(objectOf(startIn(5, { flags: { [Flag.ChapelWindowOpen]: 1 } }), 136).isDoor).toBe(true);
      expect(objectOf(startIn(12), 156).isDoor).toBe(true);
      expect(objectOf(startIn(12, { flags: { [Flag.InnDoorOpen]: 0 } }), 156).isDoor).toBe(false);
      expect(objectOf(startIn(16), 163).isDoor).toBe(true);
      expect(objectOf(startIn(17), Hut.Door).isDoor).toBe(false);
      expect(objectOf(startIn(17, { flags: { [Flag.HutDoorOpen]: 1 } }), Hut.Door).isDoor).toBe(true);
      expect(objectOf(startIn(19), 173).isDoor).toBe(false);
      expect(objectOf(startIn(19, { flags: { [Flag.WellOpen]: 1 } }), 173).isDoor).toBe(true);
    });
  });

  describe("roomLoaded (updateVisible, musiques, savedTime)", () => {
    it("les objets cachés selon les drapeaux : la cabane (2), le barreau (3), la bougie (7), le pianiste (14), le livre (18)", () => {
      expect(objectOf(startIn(2), Crossroads.Hut).visible).toBe(false);
      expect(objectOf(startIn(3, { flags: { [Flag.BarsTaken]: 1 } }), 165).visible).toBe(false);
      expect(objectOf(startIn(7, { flags: { [Flag.CandleTaken]: 1 } }), Chapel.Candle).visible).toBe(false);
      expect(objectOf(startIn(14, { flags: { [Flag.PianistGone]: 1 } }), 54).visible).toBe(false);
      expect(objectOf(startIn(18, { flags: { [Flag.BookTaken]: 1 } }), 182).visible).toBe(false);
    });

    it("le tiroir ouvert, le crucifix pas encore pris : le crucifix apparaît et le tiroir disparaît à l'entrée", () => {
      const w = startIn(6, { flags: { [Flag.DrawerOpen]: 1 } });
      expect(objectOf(w, Bedroom.Crucifix).visible).toBe(true);
      expect(objectOf(w, Bedroom.Drawer).visible).toBe(false);
    });

    it("la musique de l'auberge et du couloir : 16 après le livre, rien après le départ du pianiste", () => {
      for (const room of [14, 15]) {
        expect(startIn(room, { flags: { [Flag.BookGiven]: 1 } }).host.music.at(-1)).toBe(16);
        const silent = startIn(room, { flags: { [Flag.BookGiven]: 1, [Flag.PianistGone]: 1 } });
        expect(silent.state.roomMusic).toBe(0);
        expect(silent.host.musicPlaying()).toBe(false);
      }
    });

    it("savedTime est remis à l'entrée des pièces animées (2, 9, 14, 18)", () => {
      for (const room of [2, 9, 14, 18]) {
        const w = startIn(room);
        expect(w.engine.ticks - w.state.savedTime, `pièce ${room}`).toBeLessThan(50);
      }
    });
  });

  describe("leaving (exitRoom)", () => {
    it("sortir du cimetière par la porte 124 : le héros traverse l'écran à droite avant d'arriver dans l'église, tourné vers la gauche", () => {
      const w = startIn(3);
      const mark = w.mark();
      go(w, 124, 1);
      expect(w.voices(mark)).toEqual([]);
      expect(w.hero.track).toBe(0);
    });

    it("sortir de la cabane avec les bouchons d'oreilles : le héros les range (drapeau 29 baisse, l'objet 11 revient)", () => {
      const w = startIn(17, { flags: { [Flag.WearingEarplugs]: 1 }, items: [Item.EarWithEarplug] });
      go(w, Hut.Exit, 2);
      expect(w.flags[Flag.WearingEarplugs]).toBe(0);
      expect(w.state.inventory).toContain(Item.Earplugs);
      expect(w.state.inventory).not.toContain(Item.EarWithEarplug);
    });

    it("quitter les environs du village après avoir donné le livre : le pianiste s'en va, l'auberge est silencieuse au retour", () => {
      const w = startIn(10, { flags: { [Flag.BookGiven]: 1 } });
      go(w, 146, 4);
      expect(w.flags[Flag.PianistGone]).toBe(1);
      const inn = startIn(14, { flags: { [Flag.BookGiven]: 1, [Flag.PianistGone]: 1 } });
      expect(inn.state.roomMusic).toBe(0);
    });
  });
});
