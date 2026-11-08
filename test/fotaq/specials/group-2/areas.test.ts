import { describe, expect, it } from "vitest";
import { GROUPS } from "../../../../src/games/fotaq/engine/specials";
import { Direction } from "../../../../src/games/fotaq/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";

/** Joe marche dans la zone éteinte `area` de la pièce `room` : `handleSpecialArea` ; rend les cinématiques jouées. */
function walkIn(room: number, area: number, states: Record<number, number> = {}, facing = Direction.Left): { w: Walkthrough; played: string[] } {
  const w = new Walkthrough({ room, voices: false, states });
  w.settle();
  w.engine.state.newRoom = 99;
  w.engine.state.entryObject = 123;
  w.engine.run(w.engine.handleSpecialArea(facing, area, 1));
  w.settle(2_000);
  return { w, played: w.cutaways.played.slice() };
}

describe.skipIf(!hasOriginalFiles)("groupe 2 : zones éteintes de Floda (handleSpecialArea)", () => {
  it("définit les cinq pièces du groupe, et elles seules", () => {
    expect(Object.keys(GROUPS[2].specialAreas!).map(Number)).toEqual([22, 26, 30, 32, 103]);
  });

  it.each([
    [22, "C22A.CUT"],
    [26, "C26B.CUT"],
    [30, "C30A.CUT"],
    [32, "C32C.CUT"],
  ])("pièce %i : la zone éteinte joue %s, la pièce demandée est annulée", (room, cutaway) => {
    const { w, played } = walkIn(room, 1);
    expect(played).toEqual([cutaway]);
    expect(w.engine.state.newRoom).toBe(0);
    expect(w.engine.state.entryObject).toBe(0);
    expect(w.room).toBe(room);
    expect(w.engine.warnings).toEqual([]);
  });

  it("pièce 103, zone 3 : la secrétaire arrête Joe (C103B, état 35 à 1), puis le rappelle à l'ordre (C103E) à chaque fois", () => {
    const first = walkIn(103, 3);
    expect(first.played).toEqual(["C103B.CUT"]);
    expect(first.w.engine.gameState(35)).toBe(1);
    const again = walkIn(103, 3, { 35: 1 });
    expect(again.played).toEqual(["C103E.CUT"]);
    expect(again.w.engine.gameState(35)).toBe(1);
  });

  it("pièce 103, zone 3 : un état 35 supérieur à 1 ne joue rien ; les autres zones non plus", () => {
    expect(walkIn(103, 3, { 35: 2 }).played).toEqual([]);
    expect(walkIn(103, 5).played).toEqual([]);
    expect(walkIn(103, 7, { 35: 1 }).played).toEqual([]);
  });
});
