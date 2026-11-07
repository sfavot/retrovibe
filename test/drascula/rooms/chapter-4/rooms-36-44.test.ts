import { describe, expect, it } from "vitest";
import { Flag, Maze, Study } from "../../../../src/games/drascula/engine/rooms/chapter-4/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { speech, startIn } from "./support";

/**
 * Pièces 36 à 44, le passage secret derrière l'étagère du bureau : un couloir de huit pièces qui ne se traverse que de porte en
 * porte (ni `room_N` ni `update_N` dans ScummVM) et ramène au bureau. Les portes sont des portes ordinaires, toujours ouvertes
 * (elles ne sont pas dans la table `doors` du chapitre 4).
 */
describe.skipIf(!hasOriginalFiles)("chapitre 4 : le passage secret (pièces 36 à 44)", () => {
  /** [pièce, porte vers la gauche, pièce de gauche, porte vers la droite, pièce de droite]. */
  const corridor = [
    [36, 123, 34, 124, 37],
    [37, 125, 36, 126, 38],
    [38, 127, 37, 128, 39],
    [39, 129, 38, 130, 40],
    [40, 131, 39, 132, 41],
    [41, 133, 40, 134, 42],
    [42, 135, 41, 136, 43],
    [43, 137, 42, 138, 44],
  ] as const;

  it.each(corridor)("pièce %i : ses deux portes mènent aux pièces voisines", (room, left, leftRoom, right, rightRoom) => {
    const w = startIn(room, { exit: left });
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([left, right]);
    expect(w.engine.room.objects.every((o) => o.isDoor)).toBe(true);
    expect(w.host.music.at(-1)).toBe(19);
    w.goTo(right);
    expect(w.room).toBe(rightRoom);
    expect(w.state.objExit).toBe(right + 1);

    const back = startIn(room, { exit: right });
    back.goTo(left);
    expect(back.room).toBe(leftRoom);
  });

  it("la pièce 41 a sa propre feuille annexe (AUX2.ALG), les autres AUX1.ALG", () => {
    expect(startIn(41, { exit: 133 }).engine.room.disk).toBe("AUX2.ALG");
    expect(startIn(40, { exit: 131 }).engine.room.disk).toBe("AUX1.ALG");
  });

  it("de l'étagère du bureau (pièce 34) à la pièce 44 puis retour au bureau, de porte en porte", () => {
    const w = startIn(34, { exit: Study.DoorToCorridor, flags: { [Flag.Bookcase]: 1 } });
    w.goTo(Study.Bookcase);
    expect(w.room).toBe(36);
    const path = [124, 126, 128, 130, 132, 134, 136, 138];
    for (const [i, door] of path.entries()) {
      w.goTo(door);
      expect(w.room).toBe(37 + i);
    }
    expect(w.room).toBe(44);
    w.goTo(Maze.Exit);
    expect(w.room).toBe(34);
    expect(w.state.objExit).toBe(122);
  });

  it("l'étagère (122) vue de la pièce 36 : la porte 123 ramène au bureau, au pied de l'étagère", () => {
    const w = startIn(36, { exit: 123 });
    w.goTo(123);
    expect(w.room).toBe(34);
    expect(w.state.objExit).toBe(122);
  });

  it("l'affiche de la pièce 44 : « Le passage vers les donjons est fermé pour cause de travaux » (428)", () => {
    const w = startIn(44, { exit: Maze.Exit });
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([139, 172]);
    expect(speech(w, () => w.act(Verb.Look, Maze.Poster))).toEqual(["428.als"]);
    expect(speech(w, () => w.act(Verb.Talk, Maze.Poster))).toEqual(["16.als"]);
  });
});
