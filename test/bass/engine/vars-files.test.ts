import { describe, expect, it } from "vitest";
import { ItemCache } from "../../../src/games/bass/engine/files";
import {
  FORWARD_LIST_1,
  FORWARD_LIST_1B,
  FORWARD_LIST_2,
  FORWARD_LIST_3,
  FORWARD_LIST_4,
  FORWARD_LIST_5,
  NUM_SCRIPT_VARS,
  Var,
} from "../../../src/games/bass/engine/ids";
import { createScriptVars, initScriptVariables } from "../../../src/games/bass/engine/vars";

describe("variables de script (initScriptVariables)", () => {
  it("838 mots u32, valeurs initiales de logic.cpp:1146", () => {
    const vars = createScriptVars();
    expect(vars).toHaveLength(NUM_SCRIPT_VARS);
    expect(vars[Var.LOGIC_LIST_NO]).toBe(141);
    expect(vars[Var.LAMB_GREET]).toBe(62);
    expect(vars[Var.S15_FLOOR]).toBe(8371);
    expect(vars[Var.SC70_IRIS_FLAG]).toBe(3);
    expect(vars[Var.SC36_NEXT_DEALER]).toBe(16731);
    expect(vars[Var.SC37_DOOR_FLAG]).toBe(2);
    expect(vars[Var.SCREEN]).toBe(0);
    vars[Var.RESULT] = -1;
    expect(vars[Var.RESULT]).toBe(0xffffffff);
  });

  it("recopie les cinq listes « en avant » à leurs rangs (352, 656, 721, 663, 505)", () => {
    const vars = createScriptVars();
    expect(Array.from(vars.subarray(FORWARD_LIST_1, FORWARD_LIST_1 + FORWARD_LIST_1B.length))).toEqual(FORWARD_LIST_1B);
    expect(FORWARD_LIST_1B).toHaveLength(63);
    expect(vars[FORWARD_LIST_1]).toBe(0x1000 + 0xa9); // JOBS_SPEECH
    expect(vars[FORWARD_LIST_2]).toBe(9); // STD_ON
    expect(vars[FORWARD_LIST_3]).toBe(16385); // DANI_SPEECH
    expect(vars[FORWARD_LIST_4]).toBe(20481); // WALTER_SPEECH
    expect(vars[FORWARD_LIST_5]).toBe(24585); // SET_UP_INFO_WINDOW
    // 27 valeurs simples + 112 mots non nuls des listes.
    expect(vars.filter((v) => v !== 0).length).toBe(27 + 61 + 7 + 21 + 14 + 7);
  });

  it("réinitialise tout (y compris des valeurs modifiées)", () => {
    const vars = createScriptVars();
    vars[600] = 5;
    initScriptVariables(vars);
    expect(vars[600]).toBe(0);
    expect(() => initScriptVariables(new Uint32Array(10))).toThrow(RangeError);
  });
});

describe("fichiers chargés (Disk::fnCacheFast / fnCacheChip, _itemList)", () => {
  function cache() {
    const loads: number[] = [];
    const items = new ItemCache({ load: (id) => (loads.push(id), id === 250 ? null : new Uint8Array([id & 0xff])) });
    return { items, loads };
  }

  it("fnCacheFast puis fnCacheChip chargent la liste, rangée à numéro & 2047", () => {
    const { items, loads } = cache();
    items.cacheFast(new Uint16Array([4097, 4098, 0]));
    expect(loads).toEqual([]);
    items.cacheChip(new Uint16Array([4099 | 0x8000, 0]));
    expect(loads).toEqual([4097, 4098, 4099]);
    expect(items.fetch(4097 & 2047)).toEqual(new Uint8Array([4097 & 0xff]));
    expect(items.loadedList()).toEqual([4097, 4098, 4099]);
    expect(items.build[0]).toBe(0);
  });

  it("un nouveau cache garde les fichiers encore demandés et décharge les autres", () => {
    const { items, loads } = cache();
    items.cacheChip(new Uint16Array([10, 11, 12, 0]));
    loads.length = 0;
    items.cacheChip(new Uint16Array([11, 13, 0]));
    expect(loads).toEqual([13]);
    expect(items.loadedList()).toEqual([11, 13]);
    expect(items.fetch(10)).toBeNull();
    expect(items.fetch(11)).not.toBeNull();
  });

  it("fnMiniLoad n'ajoute qu'une fois ; fnFlushBuffers vide ; refreshFilesList recharge ; fichier absent : null", () => {
    const { items, loads } = cache();
    items.miniLoad(20);
    items.miniLoad(20);
    expect(loads).toEqual([20]);
    items.flushBuffers();
    expect(items.fetch(20)).toBeNull();
    expect(items.loadedList()).toEqual([]);
    items.refreshFilesList([30, 31, 0, 32]);
    expect(items.loadedList()).toEqual([30, 31]);
    items.miniLoad(250);
    expect(items.fetch(250)).toBeNull();
  });
});
