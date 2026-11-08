import { describe, expect, it } from "vitest";
import { GROUPS } from "../../../../src/games/fotaq/engine/specials";
import { Direction } from "../../../../src/games/fotaq/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";

/** Joe entre dans la zone éteinte `area` de la pièce `room` ; rend les cinématiques jouées et les voix. */
function enter(room: number, area: number, states: Record<number, number> = {}, walkData = 0, w = new Walkthrough({ room, states, voices: false })) {
  w.settle();
  const played = w.cutaways.played.length;
  const mark = w.mark();
  w.engine.run(w.engine.handleSpecialArea(Direction.Left, area, walkData));
  w.settle(3_000);
  return { w, cutaways: w.cutaways.played.slice(played), voices: w.voices(mark) };
}

describe.skipIf(!hasOriginalFiles)("groupe 3 : zones éteintes (handleSpecialArea)", () => {
  it("définit les pièces 50, 53, 55, 100 et 101, et elles seules", () => {
    expect(Object.keys(GROUPS[3].specialAreas!).map(Number)).toEqual([50, 53, 55, 100, 101]);
  });

  it("50, zone 6 : la première fois C50D (et ce qui s'enchaîne) puis l'état 21 passe à 1", () => {
    const { w, cutaways } = enter(50, 6);
    expect(cutaways[0]).toBe("C50D.CUT");
    // La cinématique finit sur le dialogue des zombies (`zombie1.DOG`) : l'état n'est posé qu'après lui.
    expect(w.engine.gameState(21)).toBe(0);
    w.skipUntil(() => w.idle && w.engine.gameState(21) === 1);
    expect(w.engine.input.dialogueRunning).toBe(false);
    expect(w.engine.warnings).toEqual([]);
  });

  it("50, zone 6 : ensuite C50H à chaque passage, sans changer l'état", () => {
    const { w, cutaways } = enter(50, 6, { 21: 1 });
    expect(cutaways[0]).toBe("C50H.CUT");
    expect(w.engine.gameState(21)).toBe(1);
  });

  it("50, zone 6 : état 21 supérieur à 1 ou autre zone : rien", () => {
    expect(enter(50, 6, { 21: 2 }).cutaways).toEqual([]);
    expect(enter(50, 5).cutaways).toEqual([]);
  });

  it("53 : C53B, quelle que soit la zone", () => {
    expect(enter(53, 1).cutaways[0]).toBe("C53B.CUT");
    expect(enter(53, 4).cutaways[0]).toBe("C53B.CUT");
  });

  it("55 : Joe dit sa réplique 19, aucune cinématique", () => {
    const { cutaways, voices } = enter(55, 8);
    expect(cutaways).toEqual([]);
    expect(voices).toEqual(["JOE00191"]);
  });

  it("100, zone 7 : Joe parle ; autre zone : rien", () => {
    const talk = (area: number) => {
      return enter(100, area).voices;
    };
    expect(talk(7)).toEqual(["JOE00171"]);
    expect(talk(3)).toEqual([]);
  });

  it("101, zone 5 : C101B tant que le levier n'est pas tiré (état 187 à 0), sinon rien ; autre zone : rien", () => {
    expect(enter(101, 5).cutaways[0]).toBe("C101B.CUT");
    expect(enter(101, 5, { 187: 1 }).cutaways).toEqual([]);
    expect(enter(101, 3).cutaways).toEqual([]);
  });

  it("le moteur annule la pièce demandée et l'objet d'entrée (Joe reste où il est)", () => {
    const w = new Walkthrough({ room: 55, voices: false });
    w.settle();
    w.engine.state.newRoom = 99;
    w.engine.state.entryObject = 5;
    w.engine.run(w.engine.handleSpecialArea(Direction.Left, 8, 0));
    w.settle(3_000);
    expect(w.engine.state.newRoom).toBe(0);
    expect(w.room).toBe(55);
  });
});

/** Joe marche vraiment vers `object` depuis la porte d'entrée `entry` : la marche traverse la zone éteinte, le moteur appelle le groupe. */
function walk(entry: number, object: number, states: Record<number, number> = {}) {
  const w = new Walkthrough({ entryObject: entry, states, voices: false });
  w.settle();
  w.goTo(object);
  return w;
}

describe.skipIf(!hasOriginalFiles)("groupe 3 : zones éteintes traversées à la marche", () => {
  it("50 : marcher vers le sarcophage traverse la zone 6 : C50D, le dialogue des zombies puis l'état 21 ; la fois suivante C50H", () => {
    const w = walk(366, 377);
    expect(w.cutaways.played[0]).toBe("C50D.CUT");
    expect(w.engine.gameState(21)).toBe(0);
    w.skipUntil(() => w.idle && w.engine.gameState(21) === 1);
    expect(w.engine.state.joe.x).toBeLessThan(200);
    const again = walk(366, 377, { 21: 1 });
    expect(again.cutaways.played).toEqual(["C50H.CUT"]);
    expect(again.engine.gameState(21)).toBe(1);
  });

  it("53 : tant que le serpent est là, la porte du fond est une zone éteinte : C53B", () => {
    const w = walk(395, 396);
    expect(w.cutaways.played).toEqual(["C53B.CUT"]);
    expect(w.room).toBe(53);
    expect(w.voices()).toContain("C53B_021");
  });

  it("55 : la porte du côté des rayons mortels : Joe dit sa réplique 19 et reste dans la pièce", () => {
    const w = walk(416, 409);
    expect(w.voices()).toEqual(["JOE00191"]);
    expect(w.room).toBe(55);
    expect(w.cutaways.played).toEqual([]);
  });

  it("100 : le sol du fond fermé par le bloc de pierre (zone 7 éteinte) : Joe dit sa réplique 17", () => {
    const w = new Walkthrough({ entryObject: 671, voices: false });
    w.settle();
    // Le bloc est descendu (poulie de la pièce 99, `AREA r100 off 7`).
    w.engine.state.areas[100][7].mapNeighbors = -Math.abs(w.engine.state.areas[100][7].mapNeighbors);
    w.goTo(676);
    expect(w.voices()).toEqual(["JOE00171"]);
    expect(w.room).toBe(100);
  });

  it("101 : la passerelle des rayons : C101B tant que le levier n'est pas tiré, rien ensuite", () => {
    const before = new Walkthrough({ entryObject: 683, voices: false });
    before.settle();
    before.click(20, 74);
    expect(before.cutaways.played).toEqual(["C101B.CUT"]);
    const after = new Walkthrough({ entryObject: 683, states: { 187: 1 }, voices: false });
    after.settle();
    after.click(20, 74);
    expect(after.cutaways.played).toEqual([]);
  });
});
