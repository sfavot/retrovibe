import { describe, expect, it } from "vitest";
import { Outfit } from "../../../../src/games/fotaq/engine/services";
import { GROUPS } from "../../../../src/games/fotaq/engine/specials";
import { Direction, GameVar } from "../../../../src/games/fotaq/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";

/** Joe marche dans la zone éteinte `area` de la pièce `room` : ce que fait la marche (`Walk`) en l'atteignant. */
function enter(w: Walkthrough, area: number): void {
  w.engine.state.newRoom = 99;
  w.engine.state.entryObject = 1;
  w.engine.run(w.engine.handleSpecialArea(Direction.Left, area, 0));
  w.settle(2_000);
}

describe.skipIf(!hasOriginalFiles)("groupe 4 : zones éteintes de l'hôtel (handleSpecialArea)", () => {
  it("définit les pièces 71 et 73, et elles seules", () => {
    expect(Object.keys(GROUPS[4].specialAreas!).map(Number)).toEqual([71, 73]);
  });

  it("pièce 71 : Joe dit qu'il ne peut pas l'atteindre ; la pièce demandée est annulée", () => {
    const w = new Walkthrough({ room: 71, voices: false });
    w.settle();
    const mark = w.mark();
    enter(w, 1);
    expect(w.voices(mark)).toEqual(["JOE00211"]);
    expect(w.engine.state.newRoom).toBe(0);
    expect(w.engine.state.entryObject).toBe(0);
    expect(w.engine.state.joe.facing).toBe(Direction.Left);
    expect(w.cutaways.played).toEqual([]);
  });

  it("pièce 73, état 0 : C73A, Joe en sous-vêtements, l'état passe à 1 ; la cinématique ramène Joe dans la chambre (70)", () => {
    const w = new Walkthrough({ room: 73, voices: false });
    w.settle();
    expect(w.engine.gameState(GameVar.HotelEscapeState)).toBe(0);
    enter(w, 3);
    expect(w.cutaways.played).toEqual(["C73A.CUT"]);
    expect(w.engine.gameState(GameVar.HotelEscapeState)).toBe(1);
    expect(w.engine.gameState(GameVar.JoeDressingMode)).toBe(Outfit.Underwear);
    expect(w.stage.outfit).toBe(Outfit.Underwear);
    expect(w.room).toBe(70);
    expect(w.engine.warnings).toEqual([]);
  });

  it.each([
    [1, "C73B.CUT", 2],
    [2, "C73C.CUT", 2],
  ])("pièce 73, état %i : %s, l'état passe à %i, Joe garde sa tenue", (state, cutaway, next) => {
    const w = new Walkthrough({ room: 73, voices: false, states: { [GameVar.HotelEscapeState]: state } });
    w.settle();
    enter(w, 3);
    expect(w.cutaways.played).toEqual([cutaway]);
    expect(w.engine.gameState(GameVar.HotelEscapeState)).toBe(next);
    expect(w.engine.gameState(GameVar.JoeDressingMode)).toBe(Outfit.Normal);
    expect(w.engine.warnings).toEqual([]);
  });

  it("pièce 73 : l'état du piège (93) passé à 3 ou plus ne joue plus rien", () => {
    const w = new Walkthrough({ room: 73, voices: false, states: { [GameVar.HotelEscapeState]: 3 } });
    w.settle();
    enter(w, 3);
    expect(w.cutaways.played).toEqual([]);
  });

  it("une autre pièce du groupe n'a pas de zone éteinte propre : rien ne se joue", () => {
    const w = new Walkthrough({ room: 72, voices: false });
    w.settle();
    enter(w, 1);
    expect(w.cutaways.played).toEqual([]);
  });
});
