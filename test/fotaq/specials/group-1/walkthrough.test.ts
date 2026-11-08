import { describe, expect, it } from "vitest";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";
import { group1Solution, Item, returnToAmazons } from "./solution";

const START = group1Solution.start!;
const solve = group1Solution.solve!;

/** Les objets d'inventaire d'arrivée du groupe (la batte et le journal sont toujours là). */
const ARRIVAL_ITEMS = [
  1,
  2,
  Item.Knife,
  Item.Comic,
  Item.Beetle,
  Item.Dictionary,
  Item.Record,
  Item.Vacuum,
  Item.Net,
  Item.Lighter,
  Item.Scissors,
  Item.Plans,
  Item.Doll,
];

describe.skipIf(!hasOriginalFiles)(
  "groupe 1 : passage (site du crash, jungle, village, forteresse des Amazones)",
  () => {
    it("se joue du crash (pièce 1) à la cachette des Amazones (pièce 17), à la souris, sans avertissement", () => {
      const w = new Walkthrough({ ...START, voices: false });
      w.settle();
      expect(w.room).toBe(1);
      solve(w);

      // État d'arrivée (specials.md § 7, passage 1c, corrigé : specials-group-1.md).
      expect(w.room).toBe(17);
      expect([w.engine.state.joe.x, w.engine.state.joe.y]).toEqual([309, 73]);
      for (const item of ARRIVAL_ITEMS)
        expect(w.engine.inventory.has(item), `objet d'inventaire ${item}`).toBe(
          true,
        );
      const states: Record<number, number> = {
        1: 1,
        2: 1,
        5: 1,
        6: 1,
        7: 1,
        11: 1,
        14: 2,
        15: 1,
        16: 2,
        20: 1,
        25: 2,
        26: 1,
        31: 1,
        51: 1,
        54: 1,
        56: 3,
        83: 1,
        101: 1,
        103: 1,
        115: 2,
        120: 2,
        123: 2,
        130: 1,
        136: 1,
        163: 1,
        195: 1,
      };
      for (const [index, value] of Object.entries(states))
        expect(w.engine.gameState(Number(index)), `gs${index}`).toBe(value);

      // Les cinématiques de la route, dont celle d'une zone éteinte (pièce 16) ; aucune ne manque.
      const played = w.cutaways.played.map((name) => name.toUpperCase());
      for (const cutaway of [
        "C2B.CUT",
        "C2A.CUT",
        "C5A.CUT",
        "C6A.CUT",
        "C3A.CUT",
        "C14C.CUT",
        "C14A.CUT",
        "C21D.CUT",
        "C21F.CUT",
        "C13E.CUT",
        "C12A.CUT",
        "C21E.CUT",
        "C11A.CUT",
        "C21Q.CUT",
        "C13F.CUT",
        "C8A.CUT",
        "C8B.CUT",
        "C20B.CUT",
        "C20C.CUT",
        "C20F.CUT",
        "C9A.CUT",
        "C21C.CUT",
        "C16A.CUT",
        "C16B.CUT",
        "C19A.CUT",
        "C19B.CUT",
        "C18E.CUT",
      ]) {
        expect(played, cutaway).toContain(cutaway);
      }
      expect(w.engine.warnings).toEqual([]);
      expect(w.talk.warnings).toEqual([]);
      expect(w.idle).toBe(true);
    }, 120_000);

    it("passage 1d : une fois Azura libérée (groupe 2), la cachette lui fait offrir la corne de tyranno", () => {
      const w = new Walkthrough({ ...START, voices: false });
      solve(w);
      // Le groupe 2 pose cet état (sauvetage d'Azura) ; ici seulement lui.
      w.engine.setGameState(40, 1);
      returnToAmazons(w);
      expect(w.cutaways.played.map((name) => name.toUpperCase())).toContain(
        "C18C.CUT",
      );
      expect(w.engine.inventory.has(Item.Horn)).toBe(true);
      expect(w.engine.gameState(102)).toBe(1);
      expect(w.room).toBe(17);
      expect(w.engine.warnings).toEqual([]);
    }, 120_000);
  },
);
