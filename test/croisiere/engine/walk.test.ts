import { describe, expect, it } from "vitest";
import { addAnimation, isAnimFinished, removeAnimation } from "../../../src/games/croisiere/engine/actors";
import {
  computePathfinding,
  freeCtp,
  getPixel,
  loadCt,
  setNodeColor,
  setNodeState,
  type MovementEntry,
} from "../../../src/games/croisiere/engine/walk";
import { makeEngine } from "./helpers";
import { asm } from "./ovl-builder";
import { hasOriginalFiles, volumes } from "./support";

function engineWithCtp() {
  return makeEngine({ AUTO00: { procs: [{ code: asm.stop() }] } }, { "S33.CTP": volumes().readFile("S33.CTP"), "FOO.CTP": new Uint8Array(24) });
}

describe.skipIf(!hasOriginalFiles)("zones de marche (S33.CTP)", () => {
  it("LoadCt rastérise les zones de la dernière à la première, sans vider les listes précédentes", () => {
    const { e } = engineWithCtp();
    expect(loadCt(e, "absent.ctp")).toBe(-18);
    expect(loadCt(e, "foo.ctp")).toBe(0);
    expect(loadCt(e, "s33.ctp")).toBe(1);
    expect(e.currentCtpName).toBe("s33.ctp");
    expect(e.walk.polyStructNorm.map((c) => c.num)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(e.walk.polyStructExp).toHaveLength(11);
    loadCt(e, "s33.ctp");
    expect(e.walk.polyStructNorm).toHaveLength(22);
    freeCtp(e);
    expect(e.walk.polyStructNorm).toHaveLength(0);
    expect(e.currentCtpName).toBe("");
  });

  it("getPixel : couleur de la première zone qui contient le point, numPoly sur la dernière parcourue sinon", () => {
    const { e } = engineWithCtp();
    loadCt(e, "S33.CTP");
    getPixel(e, 200, 170);
    expect([e.flagObstacle, e.walk.numPoly]).toEqual([1, 0]);
    getPixel(e, 180, 115);
    expect([e.flagObstacle, e.walk.numPoly]).toEqual([2, 2]);
    getPixel(e, 5, 5);
    expect([e.flagObstacle, e.walk.numPoly]).toEqual([0, 0]);
  });

  it("SetNodeColor reproduit le bogue de ScummVM ; les indices sont bornés par le nombre de nœuds", () => {
    const { e } = engineWithCtp();
    loadCt(e, "S33.CTP");
    expect(setNodeColor(e, 3, 1)).toBe(0);
    expect(e.walk.walkboxColor[3]).toBe(0);
    expect(setNodeColor(e, 3, -1)).toBe(-1);
    expect(e.walk.walkboxColor[3]).toBe(-1);
    expect(setNodeColor(e, 15, -1)).toBe(-1);
    expect(setNodeState(e, 12, 1)).toBe(0);
    expect(setNodeState(e, 12, -1)).toBe(1);
  });

  it("trajet direct ou par le graphe, refusé sur place", () => {
    const { e } = engineWithCtp();
    loadCt(e, "S33.CTP");
    e.flagCt = 1;
    const move: MovementEntry = { x: 0, y: 0, direction: 0, zoom: 0, poly: 0 };
    expect(computePathfinding(e, move, 119, 134, 200, 170, 5, 2, -1)).toBe(0);
    expect([move.x, move.y]).toEqual([200, 170]);
    expect(computePathfinding(e, move, 119, 134, 119, 134, 5, 2, 0)).toBe(-1);
    expect(e.walk.persoTable[0]).toBeNull();
  });
});

describe("liste des acteurs", () => {
  it("RemoveAnimation rend la direction du dernier acteur retiré ; EndAnim suit pathId", () => {
    const { e } = makeEngine({ AUTO00: { procs: [{ code: asm.stop() }] } });
    addAnimation(e, 1, 0, 2, 0);
    addAnimation(e, 1, 1, 3, 1);
    expect(isAnimFinished(e, 1, -1, -1)).toBe(false);
    e.actors[0]!.pathId = -2;
    expect(isAnimFinished(e, 1, 0, 0)).toBe(true);
    expect(removeAnimation(e, 1, -1, -1)).toBe(3);
    expect(e.actors).toHaveLength(0);
    expect(removeAnimation(e, 1, -1, -1)).toBe(0);
  });
});
