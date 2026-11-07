import { describe, expect, it } from "vitest";
import { Flag, Landing } from "../../../../src/games/drascula/engine/rooms/chapter-4/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { comparedPixels, render, speech, startIn } from "./support";

/** Pièce 24, le palier : les portes 105 et 106, l'escalier (`room_24`, `leaving` du chapitre). */
describe.skipIf(!hasOriginalFiles)("chapitre 4 : le palier (pièce 24)", () => {
  const enter = (flags: Record<number, number> = {}) => startIn(24, { exit: Landing.DoorToHall, flags: { [Flag.DoorLanding]: 1, ...flags } });
  const object = (w: ReturnType<typeof enter>, id: number) => w.engine.room.objects.find((o) => o.id === id)!;

  it("objets de la fiche ; on arrive par la porte 105 (ouverte) ; l'escalier est toujours franchissable", () => {
    const w = enter();
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([105, 106, 108, 151, 151]);
    expect(object(w, Landing.DoorToHall).isDoor).toBe(true);
    expect(object(w, Landing.DoorToBedroom).isDoor).toBe(false);
    expect(object(w, Landing.Stairs).isDoor).toBe(true);
    expect(w.host.music.at(-1)).toBe(15);
  });

  it("la porte 105 se ferme et se rouvre (le drapeau 1 est celui de la porte 104 du hall)", () => {
    const w = enter();
    let mark = w.mark();
    w.act(Verb.Close, Landing.DoorToHall);
    expect(w.voices(mark)).toEqual(["s4.als"]);
    expect(w.flags[Flag.DoorLanding]).toBe(0);
    expect(object(w, Landing.DoorToHall).isDoor).toBe(false);
    mark = w.mark();
    w.act(Verb.Open, Landing.DoorToHall);
    expect(w.voices(mark)).toEqual(["s3.als"]);
    expect(w.flags[Flag.DoorLanding]).toBe(1);
    expect(object(w, Landing.DoorToHall).isDoor).toBe(true);
  });

  it("la porte 105 mène au hall (sortie 104), la 106 ouverte à la chambre d'Igor (sortie 107)", () => {
    const w = enter();
    w.goTo(Landing.DoorToHall);
    expect(w.room).toBe(23);
    expect(w.state.objExit).toBe(104);

    const second = enter();
    second.act(Verb.Open, Landing.DoorToBedroom);
    expect(second.flags[Flag.DoorBedroom]).toBe(1);
    expect(object(second, Landing.DoorToBedroom).isDoor).toBe(true);
    second.goTo(Landing.DoorToBedroom);
    expect(second.room).toBe(26);
    expect(second.state.objExit).toBe(107);
  });

  it("la porte 106 fermée ne se franchit pas, on peut la fermer après l'avoir ouverte", () => {
    const w = enter();
    w.goTo(Landing.DoorToBedroom);
    expect(w.room).toBe(24);
    w.act(Verb.Open, Landing.DoorToBedroom);
    const mark = w.mark();
    w.act(Verb.Close, Landing.DoorToBedroom);
    expect(w.voices(mark)).toEqual(["s4.als"]);
    expect(object(w, Landing.DoorToBedroom).isDoor).toBe(false);
  });

  it("l'escalier : le héros monte d'abord jusqu'en (171, 78), puis la pièce 27 (sortie 109)", () => {
    const w = enter();
    const walks: number[][] = [];
    const walk = w.engine.walkToPoint.bind(w.engine);
    w.engine.walkToPoint = function* (x: number, y: number) {
      walks.push([x, y]);
      yield* walk(x, y);
    };
    w.goTo(Landing.Stairs);
    expect(walks.at(-1)).toEqual([171, 78]);
    expect(walks).toContainEqual([141, 137]); // d'abord le point d'approche de l'escalier
    expect(w.room).toBe(27);
    expect(w.state.objExit).toBe(109);
  });

  it("la tapisserie (151) : roomActions (461) ; les autres verbes, les excuses", () => {
    const w = enter();
    expect(speech(w, () => w.act(Verb.Look, Landing.Tapestry))).toEqual(["461.als"]);
    expect(speech(w, () => w.act(Verb.Pick, Landing.Tapestry))).toEqual(["11.als"]);
  });

  it("la perspective se prolonge au-dessus de la zone de marche (pièce 24) : le héros de l'escalier est réduit", () => {
    const w = enter();
    const { factors, walk } = w.engine.room;
    expect(factors).not.toBeNull();
    expect(factors![walk.y1 - 1]).toBeLessThan(factors![walk.y1]);
    expect(factors![75]).toBeGreaterThan(0);
  });

  describe("le dessin", () => {
    it("les portes ouvertes (drapeaux 1 et 2) sont des rectangles de roomPreUpdates recopiés de la feuille annexe", () => {
      const w = enter({ [Flag.DoorBedroom]: 1 });
      w.hero.x = 150;
      const gfx = render(w);
      for (const rect of [[1, 163, 225, 124, 12, 36], [14, 153, 30, 107, 23, 46]] as const) {
        const { compared, mismatches } = comparedPixels(gfx, gfx.draw3, rect, true, 3);
        expect(compared).toBeGreaterThan(20);
        expect(mismatches).toEqual([]);
      }
    });
  });
});
