import { describe, expect, it } from "vitest";
import { Corridor, Flag, Item } from "../../../../src/games/drascula/engine/rooms/chapter-4/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { comparedPixels, render, speech, startIn } from "./support";

/** Pièce 27, le grand couloir : les portes 110 et 116, l'aile ouest, les départs vers toutes les pièces du château (`room_27`). */
describe.skipIf(!hasOriginalFiles)("chapitre 4 : le grand couloir (pièce 27)", () => {
  const enter = (flags: Record<number, number> = {}, items: readonly number[] = []) => startIn(27, { exit: Corridor.Stairs, flags, items });
  const object = (w: ReturnType<typeof enter>, id: number) => w.engine.room.objects.find((o) => o.id === id)!;

  it("objets de la fiche ; la porte 116 (salon) est condamnée, la 110 aussi ; les trois autres sont ouvertes", () => {
    const w = enter();
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([109, 110, 112, 116, 118, 150, 175, 166, 166, 166, 166]);
    expect(object(w, Corridor.DoorToCellar).isDoor).toBe(false);
    expect(object(w, Corridor.DoorToLivingRoom).isDoor).toBe(false);
    for (const id of [Corridor.Stairs, Corridor.DoorToKitchen, Corridor.DoorToStudy]) expect(object(w, id).isDoor, String(id)).toBe(true);
    expect(w.host.music.at(-1)).toBe(15);
  });

  it.each([
    [Corridor.Stairs, 24, 108],
    [Corridor.DoorToKitchen, 29, 113],
    [Corridor.DoorToStudy, 34, 119],
  ])("la porte %i mène à la pièce %i par la sortie %i", (door, room, exit) => {
    const w = enter();
    w.goTo(door);
    expect(w.room).toBe(room);
    expect(w.state.objExit).toBe(exit);
  });

  describe("la porte 110 vers la pièce 28", () => {
    it("s'ouvre (drapeau 6, son 3), mène à la pièce 28 ; se ferme (son 4)", () => {
      const w = enter();
      let mark = w.mark();
      w.act(Verb.Open, Corridor.DoorToCellar);
      expect(w.voices(mark)).toEqual(["s3.als"]);
      expect(w.flags[Flag.DoorCellar]).toBe(1);
      expect(object(w, Corridor.DoorToCellar).isDoor).toBe(true);
      w.goTo(Corridor.DoorToCellar);
      expect(w.room).toBe(28);
      expect(w.state.objExit).toBe(111);

      const closed = enter({ [Flag.DoorCellar]: 1 });
      mark = closed.mark();
      closed.act(Verb.Close, Corridor.DoorToCellar);
      expect(closed.voices(mark)).toEqual(["s4.als"]);
      expect(object(closed, Corridor.DoorToCellar).isDoor).toBe(false);
    });
  });

  describe("la porte 116 vers le salon", () => {
    it("fermée à clé : « C'est fermé à clé » (419), rien ne bouge", () => {
      const w = enter();
      expect(speech(w, () => w.act(Verb.Open, Corridor.DoorToLivingRoom))).toEqual(["419.als"]);
      expect(w.flags[Flag.DoorLivingRoom]).toBe(0);
      w.goTo(Corridor.DoorToLivingRoom);
      expect(w.room).toBe(27);
    });

    it("la clé du salon (17) la déverrouille et l'ouvre ; on passe au salon (sortie 117)", () => {
      const w = enter({}, [Item.LivingRoomKey]);
      const mark = w.mark();
      w.useItem(Item.LivingRoomKey, Corridor.DoorToLivingRoom);
      expect(w.voices(mark)).toEqual(["s3.als"]);
      expect(w.flags[Flag.LivingRoomUnlocked]).toBe(1);
      expect(w.flags[Flag.DoorLivingRoom]).toBe(1);
      expect(w.state.takeObject).toBe(false);
      expect(object(w, Corridor.DoorToLivingRoom).isDoor).toBe(true);
      w.goTo(Corridor.DoorToLivingRoom);
      expect(w.room).toBe(31);
      expect(w.state.objExit).toBe(117);
    });

    it("déverrouillée : s'ouvre avec le verbe ; de ce côté elle ne se ferme pas (pas de « fermer » dans room_27 ; une porte n'a pas de nom survolé, donc pas de réplique par défaut)", () => {
      const w = enter({ [Flag.LivingRoomUnlocked]: 1, [Flag.DoorLivingRoom]: 1 });
      expect(object(w, Corridor.DoorToLivingRoom).isDoor).toBe(true);
      expect(speech(w, () => w.act(Verb.Close, Corridor.DoorToLivingRoom))).toEqual([]);
      expect(w.flags[Flag.DoorLivingRoom]).toBe(1);
      expect(object(w, Corridor.DoorToLivingRoom).isDoor).toBe(true);

      const closed = enter({ [Flag.LivingRoomUnlocked]: 1 });
      expect(object(closed, Corridor.DoorToLivingRoom).isDoor).toBe(false);
      const mark = closed.mark();
      closed.act(Verb.Open, Corridor.DoorToLivingRoom);
      expect(closed.voices(mark)).toEqual(["s3.als"]);
      expect(object(closed, Corridor.DoorToLivingRoom).isDoor).toBe(true);
    });

    it("la clé ordinaire (7) ne sert à rien sur cette porte", () => {
      const w = enter({}, [Item.Key]);
      expect(speech(w, () => w.useItem(Item.Key, Corridor.DoorToLivingRoom))).toEqual(["11.als"]);
      expect(w.flags[Flag.LivingRoomUnlocked]).toBe(0);
    });
  });

  it("l'aile ouest (150) est interdite, quel que soit le verbe (460)", () => {
    const w = enter();
    for (const verb of [Verb.Look, Verb.Pick, Verb.Open, Verb.Talk]) {
      expect(speech(w, () => w.act(verb, Corridor.WestWing)), String(verb)).toEqual(["460.als"]);
    }
  });

  it("le portrait de Drascula (175) : regarder (429)", () => {
    const w = enter();
    expect(speech(w, () => w.act(Verb.Look, 175))).toEqual(["429.als"]);
  });

  it("la porte 118 (bureau) et les portraits décoratifs 166 : réponses par défaut", () => {
    const w = enter();
    expect(speech(w, () => w.act(Verb.Talk, 166))).toEqual(["16.als"]);
  });

  describe("le dessin", () => {
    it("la porte 116 ouverte (drapeau 5) est recopiée de la feuille annexe, sans les pixels transparents", () => {
      const w = enter({ [Flag.DoorLivingRoom]: 1, [Flag.LivingRoomUnlocked]: 1 });
      w.hero.x = 200;
      const gfx = render(w);
      const { compared, mismatches } = comparedPixels(gfx, gfx.draw3, [1, 175, 59, 109, 17, 24], false, 2);
      expect(compared).toBeGreaterThan(20);
      expect(mismatches).toEqual([]);
    });
  });
});
