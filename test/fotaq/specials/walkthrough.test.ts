import { describe, expect, it } from "vitest";
import { Item } from "../../../src/games/fotaq/engine/state";
import { hasOriginalFiles } from "../helpers";
import { Walkthrough } from "../walkthrough";

/** Le joueur scripté, éprouvé sur le hall de l'hôtel (pièce 73) : le portier, sa clef (solution du groupe 4, passage 4a, étapes 12 et 13). */
describe.skipIf(!hasOriginalFiles)("joueur scripté (test/fotaq/walkthrough.ts)", () => {
  it("clique un verbe puis un objet, choisit les options d'un dialogue, prend un objet et l'utilise depuis l'inventaire", () => {
    const w = new Walkthrough({ entryObject: 584, voices: false });
    w.settle();
    expect(w.room).toBe(73);

    w.act("Talk", 585);
    const first = w.waitForChoices();
    expect(first.length).toBeGreaterThan(1);
    w.chooseText("au sujet de cette clef");
    w.chooseText("emprunter");
    w.chooseText("encore au sujet");
    w.chooseText("ami de Lola");
    // Le dernier choix est suivi du « Merci. » de Joe, seul choix restant, dit sans menu.
    w.settle();
    expect(w.engine.gameState(145)).toBe(1);

    w.act("PickUp", 581);
    expect(w.engine.inventory.has(Item.Journal + 55)).toBe(true);
    // La clef est dans l'inventaire : on la trouve dans une case (les flèches font défiler jusqu'à elle) et on l'examine.
    const lines = w.talk.warnings.length;
    w.verbOnItem("Look", Item.Journal + 55);
    expect(w.talk.warnings.length).toBe(lines);
    expect(w.slotOf(Item.Journal + 55)).toBeGreaterThanOrEqual(0);
  });

  it("Échap passe un dialogue ; un objet hors de l'écran est signalé par une erreur claire", () => {
    const w = new Walkthrough({ entryObject: 584, voices: false });
    w.settle();
    w.act("Talk", 585);
    w.waitForChoices();
    w.skip();
    w.settle();
    expect(w.engine.input.dialogueRunning).toBe(false);
    expect(() => w.pointOf(1)).toThrow();
  });
});
