import { describe, expect, it } from "vitest";
import { Outfit } from "../../../../src/games/fotaq/engine/services";
import { BamFlag } from "../../../../src/games/fotaq/engine/specials/bam";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";
import { group4Solution, solveGroup4c, startGroup4c } from "./solution";

describe.skipIf(!hasOriginalFiles)("groupe 4 : passage 4a, de la chambre d'hôtel à l'avion (solution jouée à la souris)", () => {
  it("de la pièce 70 à la pièce 75 : hôtel, Lola, robe, hall, course de voiture, huile sur Rico", () => {
    const w = new Walkthrough({ ...group4Solution.start, voices: false });
    expect(w.room).toBe(70);
    let animated = 0;
    const { bam } = w.stage;
    const updateCar = bam.updateCar.bind(bam);
    bam.updateCar = (g, data) => {
      if (bam.flag === BamFlag.Play) animated++;
      updateCar(g, data);
    };

    group4Solution.solve!(w);

    // L'arrivée : l'avion (75), le dialogue d'Anderson attend un choix (groupe 5).
    expect(w.room).toBe(75);
    expect(w.awaitingChoice).toBe(true);
    // Les cinématiques de la solution, dans l'ordre.
    expect(w.cutaways.played).toEqual(["c70h.CUT", "c70e.CUT", "c70b.CUT", "c71a.CUT", "c72c.CUT", "c72a.CUT", "c71c.CUT", "c70a.CUT", "c70b.CUT", "c72b.CUT", "CDRES.CUT", "c39a.CUT", "c73e.CUT", "c74a.CUT"]);
    // La course : animée pendant le séjour en pièce 74, arrêtée par le mouvement 8 de C74A.
    expect(animated).toBeGreaterThan(20);
    expect(bam.flag).toBe(BamFlag.Stop);
    // États d'arrivée (§ 7, corrigés : voir specials-group-4.md).
    const states = { 10: 1, 13: 1, 49: 2, 91: 1, 92: 1, 94: 1, 95: 2, 119: 1, 129: 1, 145: 1, 147: 1 };
    for (const [index, value] of Object.entries(states)) expect(w.engine.gameState(Number(index)), `gs${index}`).toBe(value);
    // Tenue normale (mouvement 3 de C74A) ; la robe, les faux seins, la perruque et la clef ont été rendus au jeu.
    expect(w.engine.gameState(19)).toBe(Outfit.Normal);
    expect(w.stage.outfit).toBe(Outfit.Normal);
    for (const item of [49, 55, 56, 57, 58]) expect(w.engine.inventory.has(item), `I${item}`).toBe(false);
    for (const item of [54, 59, 60, 61]) expect(w.engine.inventory.has(item), `I${item}`).toBe(true);
    expect(w.engine.warnings).toEqual([]);
  }, 120_000);
});

describe.skipIf(!hasOriginalFiles)("groupe 4 : passage 4c, du lancement à la vallée (pièces 76 et 64 à 68)", () => {
  it("de la pièce 76 à la pièce 69 : fusée dorsale, dinosaures, branches, corne de tyranno, c69z", () => {
    const w = new Walkthrough({ ...startGroup4c, voices: false });
    expect(w.room).toBe(76);
    solveGroup4c(w);

    expect(w.room).toBe(69);
    expect(w.cutaways.played).toEqual(["c76b.CUT", "c64a.CUT", "c66a.CUT", "c67a.CUT", "c67b.CUT", "c69z.CUT"]);
    expect(w.engine.state.joe.x).toBe(147);
    expect(w.engine.state.joe.y).toBe(145);
    const states = { 3: 1, 50: 1, 104: 1, 105: 1, 138: 1, 139: 2, 154: 1 };
    for (const [index, value] of Object.entries(states)) expect(w.engine.gameState(Number(index)), `gs${index}`).toBe(value);
    // La fusée dorsale et les branches ont servi.
    expect(w.engine.inventory.has(23)).toBe(false);
    expect(w.engine.inventory.has(48)).toBe(false);
    expect(w.engine.warnings).toEqual([]);
  }, 120_000);
});
