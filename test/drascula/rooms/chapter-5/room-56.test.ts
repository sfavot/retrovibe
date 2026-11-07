import { describe, expect, it } from "vitest";
import { CoffinRoom, Flag, Room } from "../../../../src/games/drascula/engine/rooms/chapter-5/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";

/**
 * Pièces 56 (chambre du cercueil) et 57 (couloir) : on n'y entre que par `animation_12_5` (fin du laboratoire). Les tests de pièce
 * chargent la pièce directement (`engine.enterRoom`, permis hors du test de passage) ; l'arrivée par la cinématique est dans
 * `room-53.test.ts` et `walkthrough.test.ts`.
 */
describe.skipIf(!hasOriginalFiles)("chapitre 5 : le couloir (57) et la chambre du cercueil (56)", () => {
  const enter = (room: number, exit: number) => {
    const w = new Walkthrough({ chapter: 5 });
    w.state.objExit = exit;
    w.state.hero.x = -1;
    w.engine.run(w.engine.enterRoom(room));
    w.settle();
    expect(w.room).toBe(room);
    return w;
  };

  describe("le couloir (pièce 57)", () => {
    it("une seule porte, la 104, vers la chambre du cercueil (arrivée par la porte 105) ; la musique est la 15", () => {
      const w = enter(Room.Corridor, 104);
      expect(w.engine.room.objects.map((o) => o.id)).toEqual([104]);
      expect(w.host.music.at(-1)).toBe(15);
      expect(w.hero.visible).toBe(true);
      w.goTo(104);
      expect(w.room).toBe(Room.Coffin);
      expect(w.state.objExit).toBe(105);
      expect(w.host.music.at(-1)).toBe(14);
    });
  });

  describe("la chambre du cercueil (pièce 56)", () => {
    it("les objets sont ceux de la fiche, la porte ramène au couloir", () => {
      const w = enter(Room.Coffin, 105);
      expect(w.engine.room.objects.map((o) => o.id)).toEqual([105, 124, 207, 208]);
      w.goTo(CoffinRoom.Door);
      expect(w.room).toBe(Room.Corridor);
      expect(w.state.objExit).toBe(104);
    });

    it.each([
      [Verb.Look, CoffinRoom.Coffin, "450.als"],
      [Verb.Open, CoffinRoom.Clock, "141.als"],
      [Verb.Look, CoffinRoom.Table, "142.als"],
    ])("verbe %i sur l'objet %i : la réplique de roomActions (une fois)", (verb, id, voice) => {
      const w = enter(Room.Coffin, 105);
      const mark = w.mark();
      w.act(verb, id);
      expect(w.voices(mark)).toEqual([voice]);
      expect(w.state.chapter).toBe(5);
    });

    it("un verbe sans réponse sur le cercueil (fermer) : la réponse par défaut", () => {
      const w = enter(Room.Coffin, 105);
      const mark = w.mark();
      w.act(Verb.Close, CoffinRoom.Coffin);
      expect(w.voices(mark)).toEqual(["9.als"]);
      expect(w.state.chapter).toBe(5);
    });

    it("ouvrir le cercueil (animation_14_5) : il est vide, l'horloge s'ouvre, Drascula parle, le chapitre 6 commence", () => {
      const w = enter(Room.Coffin, 105);
      const mark = w.mark();
      w.selectVerb(Verb.Open);
      const { x, y } = w.pointOf(CoffinRoom.Coffin);
      w.player.click(x, y);
      w.until(() => w.flags[Flag.CoffinOpen] === 1);
      expect(w.flags[Flag.ClockOpen]).toBe(0);
      w.until(() => w.flags[Flag.ClockOpen] === 1);
      // Le cercueil ouvert et la porte de l'horloge ouverte sont dessinés par `roomPreUpdates` (60, 160 -> 128, 97 ; 2, 126 -> 42, 67).
      w.engine.render();
      const { screen, draw3 } = w.engine.gfx;
      expect(screen.at(128 + 5, 97 + 5)).toBe(draw3.at(60 + 5, 160 + 5));
      w.until(() => w.state.chapter === 6 && w.room === 58, 60_000);
      const voices = w.voices(mark);
      // Le son 3 (le couvercle), « C'est vide ! », le son 7 (l'horloge), la voix de Drascula, puis le chapitre 6.
      expect(voices.indexOf("s3.als")).toBeGreaterThanOrEqual(0);
      expect(voices.indexOf("246.als")).toBeGreaterThan(voices.indexOf("s3.als"));
      expect(voices.indexOf("s7.als")).toBeGreaterThan(voices.indexOf("246.als"));
      expect(voices.indexOf("d18.als")).toBeGreaterThan(voices.indexOf("s7.als"));
      expect(voices.indexOf("d19.als")).toBeGreaterThan(voices.indexOf("d18.als"));
    });

    it("le héros marche jusqu'à l'horloge entre « C'est vide ! » et l'ouverture de sa porte", () => {
      const w = enter(Room.Coffin, 105);
      w.selectVerb(Verb.Open);
      const { x, y } = w.pointOf(CoffinRoom.Coffin);
      w.player.click(x, y);
      w.until(() => w.flags[Flag.ClockOpen] === 1);
      expect(Math.abs(w.hero.x + Math.trunc(w.hero.width / 2) - 89)).toBeLessThanOrEqual(8);
      expect(Math.abs(w.hero.y + w.hero.height - 160)).toBeLessThanOrEqual(3);
    });
  });
});
