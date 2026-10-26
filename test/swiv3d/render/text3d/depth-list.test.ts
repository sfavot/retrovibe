import { describe, expect, it } from "vitest";
import { DepthList } from "../../../../src/games/swiv3d/render/text3d";

const drawOrder = (keys: number[]): number[] => {
  const list = new DepthList(16);
  keys.forEach((k, i) => list.insert(i, k));
  const out: number[] = [];
  for (let i = list.first(); i >= 0; i = list.next(i)) out.push(i);
  return out;
};

describe("file des faces du texte 3D (gm_queue_insert)", () => {
  it("trace de la clé la plus grande à la plus petite", () => {
    expect(drawOrder([10, 30, 20, 40])).toEqual([3, 1, 2, 0]);
    expect(drawOrder([])).toEqual([]);
  });

  it("à clé égale, l'ordre dépend du sens de la recherche depuis la dernière insertion", () => {
    // Recherche vers les grandes clés : la nouvelle face se range après celle où l'on s'arrête (ordre d'insertion).
    expect(drawOrder([5, 3, 5, 4, 5])).toEqual([0, 2, 4, 3, 1]);
    // Recherche depuis la tête vers les petites clés : la nouvelle face passe devant (ordre inverse).
    expect(drawOrder([3, 5, 5])).toEqual([2, 1, 0]);
  });

  it("reset vide la liste et repart de la tête", () => {
    const list = new DepthList(4);
    list.insert(0, 1);
    list.reset();
    expect(list.first()).toBe(-1);
    list.insert(1, 7);
    expect(list.first()).toBe(1);
    expect(list.next(1)).toBe(-1);
  });
});
