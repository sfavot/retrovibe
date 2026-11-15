import { describe, expect, it } from "vitest";
import type { Cell } from "../../../src/games/croisiere/engine/cells";
import { ObjClass, ObjType } from "../../../src/games/croisiere/engine/ids";
import { getMultipleObjectParam, getSingleObjectParam, objInit, setObjectPosition } from "../../../src/games/croisiere/engine/objects";
import { makeEngine } from "./helpers";
import { asm } from "./ovl-builder";

/** obj 0..3 : VARIABLE (Z modifiable) ; obj 4, 5 : MULTIPLE à deux états chacun. */
function setup() {
  const { e } = makeEngine({
    AUTO00: {
      procs: [{ code: asm.stop() }],
      numObjVars: 4,
      objects: [
        { cls: ObjClass.VARIABLE, varTableIdx: 0 },
        { cls: ObjClass.VARIABLE, varTableIdx: 1 },
        { cls: ObjClass.VARIABLE, varTableIdx: 2 },
        { cls: ObjClass.VARIABLE, varTableIdx: 3 },
        { cls: ObjClass.MULTIPLE, firstStateIdx: 0, stateTableIdx: 0, numStates: 2 },
        { cls: ObjClass.MULTIPLE, firstStateIdx: 2, stateTableIdx: 1, numStates: 2 },
      ],
      states: [
        [1, 10, 0, 0, 0, 7],
        [2, 20, 0, 0, 0, 8],
        [3, 30, 0, 0, 0, 9],
        [4, 40, 0, 0, 0, 6],
      ],
    },
  });
  return e;
}

function order(cells: Iterable<Cell>): string[] {
  return [...cells].map((c) => `${c.idx}:${c.type}`);
}

function backwards(head: Cell): string[] {
  const out: string[] = [];
  for (let c = head.prev; c; c = c.prev) out.unshift(`${c.idx}:${c.type}`);
  return out;
}

describe("objets", () => {
  it("MULTIPLE : état dans globalVars ; indice global négatif ramené à 0, indice d'état négatif lit l'objet précédent", () => {
    const e = setup();
    expect(getSingleObjectParam(e, 1, 5, 1)).toBe(30);
    e.globalVars[1] = -1;
    expect(getSingleObjectParam(e, 1, 5, 1)).toBe(20); // états de l'objet 4
    e.globalVars[0] = -1;
    expect(getSingleObjectParam(e, 1, 4, 1)).toBe(10); // indice -1 -> 0
    expect(getMultipleObjectParam(e, 1, 4)).toMatchObject({ X: 1, state: -1, state2: 7, nbState: 2 });
    setObjectPosition(e, 1, 4, 0, 99); // X d'un MULTIPLE : ignoré
    expect(getSingleObjectParam(e, 1, 4, 0)).toBe(1);
    setObjectPosition(e, 1, 4, 5, 1);
    expect(e.globalVars[0]).toBe(1);
    expect(getSingleObjectParam(e, 1, 9, 0)).toBeNull();
  });

  it("VARIABLE : objInit copie l'état, setObjectPosition écrit le champ", () => {
    const e = setup();
    objInit(e, 1, 0, 3);
    expect(getMultipleObjectParam(e, 1, 0)).toMatchObject({ X: 4, Y: 40, state: 3, state2: 6 });
    setObjectPosition(e, 1, 0, 1, 70000);
    expect(getSingleObjectParam(e, 1, 0, 1)).toBe(70000 - 65536);
  });
});

describe("cellules", () => {
  it("insertion triée par Z, refus des doublons, messages en queue, chaînage arrière cohérent", () => {
    const e = setup();
    const z = (obj: number, value: number) => setObjectPosition(e, 1, obj, 2, value);
    z(0, 30);
    z(1, 10);
    z(2, 20);
    for (const obj of [0, 1, 2]) e.cells.add(e, 1, obj, ObjType.SPRITE, 0, 1, 0, 20);
    expect(e.cells.add(e, 1, 1, ObjType.SPRITE, 0, 1, 0, 20)).toBeNull();
    e.cells.add(e, 1, 1, ObjType.MASK, 0, 1, 0, 20);
    e.cells.addText(1, 3, 0, 0, 100, 1, 0, 1, 0);
    expect(order(e.cells)).toEqual(["1:1", "1:4", "2:4", "0:4", "3:5"]);
    expect(backwards(e.cells.head)).toEqual(order(e.cells));
  });

  it("sortCells déplace toutes les cellules de l'objet après la dernière de Z inférieur", () => {
    const e = setup();
    const z = (obj: number, value: number) => setObjectPosition(e, 1, obj, 2, value);
    z(0, 10);
    z(1, 20);
    z(2, 30);
    for (const obj of [0, 1, 2]) e.cells.add(e, 1, obj, ObjType.SPRITE, 0, 1, 0, 20);
    z(0, 25); // appelle sortCells
    expect(order(e.cells)).toEqual(["1:4", "0:4", "2:4"]);
    expect(backwards(e.cells.head)).toEqual(order(e.cells));
    z(2, 5);
    expect(order(e.cells)).toEqual(["2:4", "1:4", "0:4"]);
  });

  it("removeCell avec jokers, dernière cellule comprise", () => {
    const e = setup();
    for (const obj of [0, 1, 2]) e.cells.add(e, 1, obj, ObjType.SPRITE, 0, 1, 0, 20);
    // Z égaux : chaque cellule est insérée devant la première de Z supérieur ou égal, donc en tête.
    expect(order(e.cells)).toEqual(["2:4", "1:4", "0:4"]);
    e.cells.remove(1, 0, -1, 0);
    expect(order(e.cells)).toEqual(["2:4", "1:4"]);
    expect(backwards(e.cells.head)).toEqual(order(e.cells));
    e.cells.remove(-1, -1, ObjType.SPRITE, -1);
    expect(order(e.cells)).toEqual([]);
    expect(e.cells.head.prev).toBeNull();
  });
});
