import { describe, expect, it } from "vitest";
import { GROUPS } from "../../../../src/games/fotaq/engine/specials";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";

/** Un moteur dans la pièce `room`, prêt à recevoir un mouvement spécial. */
function start(room: number): Walkthrough {
  const w = new Walkthrough({ room, voices: false });
  w.settle();
  return w;
}

/** Joue le mouvement spécial `n` jusqu'au bout. */
function play(w: Walkthrough, n: number): void {
  w.engine.run(w.engine.executeSpecialMove(n));
  w.settle(2_000);
}

/** Somme des composantes des couleurs `from` à `to` de la palette de l'écran. */
const lightOf = (w: Walkthrough, from: number, to: number) => w.stage.display.palette.screen.subarray(from * 3, (to + 1) * 3).reduce((a, b) => a + b, 0);

describe.skipIf(!hasOriginalFiles)("groupe 2 : mouvements spéciaux de Floda", () => {
  it("définit les cinq mouvements du groupe, et eux seuls", () => {
    expect(Object.keys(GROUPS[2].specialMoves!).map(Number)).toEqual([19, 21, 22, 23, 25]);
  });

  it("19 : Azura est amoureuse (état 167)", () => {
    const w = start(41);
    expect(w.engine.gameState(167)).toBe(0);
    play(w, 19);
    expect(w.engine.gameState(167)).toBe(1);
  });

  it("25 : les gardes sont allumés (état 85)", () => {
    const w = start(41);
    play(w, 25);
    expect(w.engine.gameState(85)).toBe(1);
  });

  it("21 puis 22 : la pièce 25 passe au noir de la couleur 16 à 223, sans défilement de palette, puis retrouve ses couleurs", () => {
    const w = start(25);
    const room = w.stage.display.palette.room.subarray(16 * 3, 224 * 3).reduce((a, b) => a + b, 0);
    expect(room).toBeGreaterThan(0);
    play(w, 21);
    expect(lightOf(w, 16, 223)).toBe(0);
    expect(w.stage.display.palette.scrollable).toBe(false);
    play(w, 22);
    expect(lightOf(w, 16, 223)).toBe(room);
    expect(w.stage.display.palette.scrollable).toBe(true);
  });

  it("21 : à la réception (103), les 32 premières couleurs gardent leur lumière", () => {
    const w = start(103);
    const dark = lightOf(w, 0, 31);
    expect(dark).toBeGreaterThan(0);
    play(w, 21);
    expect(lightOf(w, 32, 223)).toBe(0);
    expect(lightOf(w, 0, 31)).toBe(dark);
    play(w, 22);
    expect(lightOf(w, 32, 223)).toBeGreaterThan(0);
  });

  it("23 : la zone 7 de la réception, éteinte, s'allume sans changer de voisines", () => {
    const w = start(103);
    const area = w.engine.grid.area(103, 7);
    area.mapNeighbors = -Math.abs(area.mapNeighbors || 1);
    const neighbors = Math.abs(area.mapNeighbors);
    play(w, 23);
    expect(area.mapNeighbors).toBe(neighbors);
    // Déjà allumée : reste telle quelle.
    play(w, 23);
    expect(area.mapNeighbors).toBe(neighbors);
  });
});
