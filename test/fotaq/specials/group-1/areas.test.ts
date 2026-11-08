import { describe, expect, it } from "vitest";
import { GROUPS } from "../../../../src/games/fotaq/engine/specials";
import { Direction } from "../../../../src/games/fotaq/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";

/** Un joueur entré dans une pièce du groupe par l'objet `entry`. */
function enter(
  entry: number,
  states: Record<number, number> = {},
): Walkthrough {
  const w = new Walkthrough({ entryObject: entry, voices: false, states });
  w.settle();
  return w;
}

/** Clique un point du sol, sur un objet de la pièce sans commande, et rend les cinématiques et voix qui ont suivi. */
function walkTo(
  w: Walkthrough,
  x: number,
  y: number,
): { cutaways: string[]; voices: string[] } {
  const played = w.cutaways.played.length;
  const mark = w.mark();
  w.click(x, y);
  return { cutaways: w.cutaways.played.slice(played), voices: w.voices(mark) };
}

/** Appelle `handleSpecialArea` directement (pour une zone que le jeu n'éteint jamais, ou pour vérifier qu'une zone ne fait rien). */
function enterArea(
  w: Walkthrough,
  area: number,
  walkStep: number,
): { cutaways: string[]; voices: string[] } {
  const played = w.cutaways.played.length;
  const mark = w.mark();
  w.engine.run(w.engine.handleSpecialArea(Direction.Left, area, walkStep));
  w.settle();
  return { cutaways: w.cutaways.played.slice(played), voices: w.voices(mark) };
}

describe.skipIf(!hasOriginalFiles)(
  "groupe 1 : zones éteintes (handleSpecialArea)",
  () => {
    it("ne définit que les zones éteintes des pièces 4, 6, 14, 16 et 17", () => {
      const group = GROUPS[1];
      expect(Object.keys(group.specialAreas ?? {}).map(Number)).toEqual([
        4, 6, 14, 16, 17,
      ]);
      expect(group.specialMoves).toBeUndefined();
      expect(group.specialRooms).toBeUndefined();
      expect(group.roomUpdates).toBeUndefined();
    });

    it("pièce 4 : marcher vers le pont éteint arrête Joe devant (zone 4) et lui fait dire la réplique 16, sans cinématique", () => {
      const w = enter(27);
      const { cutaways, voices } = walkTo(w, 260, 110);
      expect(cutaways).toEqual([]);
      expect(voices).toEqual(["JOE00161"]);
      expect([w.engine.state.joe.x, w.engine.state.joe.y]).toEqual([15, 87]);
      expect(w.room).toBe(4);
      expect(w.engine.state.newRoom).toBe(0);
      expect(w.engine.warnings).toEqual([]);
    });

    it("pièce 6 : marcher vers le gorille (zone 6) joue C6C et laisse Joe dans la pièce", () => {
      const w = enter(38);
      const { cutaways } = walkTo(w, 138, 131);
      expect(cutaways).toEqual(["C6C.CUT"]);
      expect(w.room).toBe(6);
      expect(w.engine.warnings).toEqual([]);
    });

    it("pièce 14 : marcher à travers le faux dinosaure (zone 9) joue C14B", () => {
      const w = enter(87);
      const { cutaways, voices } = walkTo(w, 270, 60);
      expect(cutaways).toEqual(["C14B.CUT"]);
      expect(voices[0]).toBe("C14B_011");
      expect(w.room).toBe(14);
      expect(w.engine.warnings).toEqual([]);
    });

    it("pièce 16 : la zone 3 (devant la forteresse) joue C16A, par la marche", () => {
      const w = enter(99);
      const { cutaways } = walkTo(w, 214, 140);
      expect(cutaways).toEqual(["C16A.CUT"]);
      expect(w.room).toBe(16);
      expect(w.engine.warnings).toEqual([]);
    });

    it("pièce 16 : la zone 1 (éteinte aussi, au fond) ne joue rien", () => {
      const w = enter(99);
      expect(enterArea(w, 1, 1)).toEqual({ cutaways: [], voices: [] });
      expect(enterArea(w, 3, 1).cutaways).toEqual(["C16A.CUT"]);
    });

    it("pièce 17 : C17A à la 4e étape de marche, rien aux autres (ScummVM teste le rang de l'étape, non la zone)", () => {
      for (const [step, expected] of [
        [4, ["C17A.CUT"]],
        [1, []],
        [3, []],
        [5, []],
      ] as const) {
        const w = enter(105);
        expect(w.room, `étape ${step}`).toBe(17);
        expect(enterArea(w, 7, step).cutaways, `étape ${step}`).toEqual(
          expected,
        );
        expect(w.engine.warnings).toEqual([]);
      }
    });

    it("pièce 17 : la 2e étape demande C17B, que les données du jeu ne contiennent pas (code mort de ScummVM aussi : aucune zone de la pièce 17 n'est éteinte)", () => {
      const w = enter(105);
      const asked: string[] = [];
      w.engine.playCutaway = function* (file: string) {
        asked.push(file);
        return "";
      };
      w.engine.run(w.engine.handleSpecialArea(Direction.Left, 7, 2));
      w.settle();
      expect(asked).toEqual(["C17B.CUT"]);
      // Aucune zone de la pièce n'est éteinte au départ, et aucune commande de la pièce ne l'éteint : la marche n'y arrive jamais.
      const off = w.engine.state.areas[17].filter(
        (area, i) => i > 0 && area.mapNeighbors < 0,
      );
      expect(off).toEqual([]);
    });

    it("le moteur remet à zéro le changement de pièce et l'objet d'entrée avant la réaction de la pièce", () => {
      const w = enter(105);
      w.engine.state.newRoom = 19;
      w.engine.state.entryObject = 134;
      enterArea(w, 7, 1);
      expect(w.engine.state.newRoom).toBe(0);
      expect(w.engine.state.entryObject).toBe(0);
    });
  },
);
