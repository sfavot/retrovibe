import { describe, expect, it } from "vitest";
import type { NpcSchedules } from "../../../src/games/lure/data/lure-dat";
import { CurrentAction } from "../../../src/games/lure/engine/ids";
import { DelayList } from "../../../src/games/lure/engine/delay-list";
import { disassembleHotspotScript, S2 } from "../../../src/games/lure/engine/hotspot-script";
import {
  ActionStack,
  ScheduleBook,
  ValueTable,
  clearPathOccupied,
  pathOccupied,
  pathOccupiedWidth,
  setPathOccupied,
  type DelayedSequence,
} from "../../../src/games/lure/engine/state";
import type { LureContext } from "../../../src/games/lure/engine/context";
import { lureData } from "../data/catalog-helper";
import { hasOriginalFiles } from "./test-host";

describe("table des valeurs", () => {
  it("90 champs de 16 bits, hors bornes refusé", () => {
    const fields = new ValueTable();
    fields.set(89, 0x12345);
    expect(fields.get(89)).toBe(0x2345);
    expect(() => fields.get(90)).toThrow();
    expect(fields.hdrFlagMask).toBe(1);
  });
});

describe("emplois du temps et pile d'actions", () => {
  const schedules: NpcSchedules = {
    charOffsets: [0x0801],
    randomActions: [],
    schedules: [
      { id: 1, offset: 0, entries: [{ action: 38, params: [5] }, { action: 34, params: [2] }, { action: 38, params: [7] }] },
      { id: 2, offset: 0, entries: [{ action: 30, params: [0x100] }, { action: 38, params: [1] }] },
    ],
  };
  const book = new ScheduleBook(schedules);

  it("résout un identifiant global, un saut local et 0xFFFF", () => {
    expect(book.resolve(0x0801)).toBe(0x0801);
    expect(book.entry(0x0801)).toEqual({ setId: 2, index: 1, action: 38, params: [1] });
    expect(book.resolve(2, 1)).toBe(0x0402);
    expect(book.resolve(0xffff)).toBeNull();
    expect(() => book.resolve(2)).toThrow(/hors d'un emploi du temps/);
    expect(() => book.resolve(0x0c00)).toThrow(/invalide/);
    expect(book.charOffset(0)).toBe(0x0801);
  });

  it("passe à l'entrée suivante jusqu'à la fin de l'ensemble ; une donnée dynamique n'a pas de suite", () => {
    expect(book.nextSupport({ kind: "schedule", id: 0x0400 })).toEqual({ kind: "schedule", id: 0x0401 });
    expect(book.nextSupport({ kind: "schedule", id: 0x0402 })).toBeNull();
    expect(book.nextSupport({ kind: "dynamic", action: 1, params: [2, 3] })).toBeNull();
    expect(book.param({ kind: "dynamic", action: 1, params: [2, 3] }, 1)).toBe(3);
    expect(() => book.param({ kind: "schedule", id: 0x0400 }, 1)).toThrow(/paramètre 1/);
  });

  it("la tête de pile est la dernière ajoutée devant ; plus de 20 actions est une erreur", () => {
    const stack = new ActionStack();
    expect(stack.action()).toBe(CurrentAction.NO_ACTION);
    stack.addBack(CurrentAction.DISPATCH_ACTION, 3);
    stack.addFront(CurrentAction.START_WALKING, 3);
    stack.addFrontAction(16, 3, 0x40f, 0xffff);
    expect(stack.top().support).toEqual({ kind: "dynamic", action: 16, params: [0x40f, 0xffff] });
    expect(stack.bottom().action).toBe(CurrentAction.DISPATCH_ACTION);
    stack.pop();
    expect(stack.action()).toBe(CurrentAction.START_WALKING);
    for (let i = 0; i < 18; i++) stack.addBack(CurrentAction.WALKING, 1);
    expect(() => stack.addBack(CurrentAction.WALKING, 1)).toThrow(/trop d'actions/);
  });
});

describe("grille de cheminement", () => {
  it("marque et libère des blocs sur une ligne ; le test de largeur avance de 8 blocs comme ScummVM", () => {
    const paths = new Uint8Array(120);
    setPathOccupied(paths, 6, 2, 4);
    expect([5, 6, 7, 8, 9, 10].map((x) => pathOccupied(paths, x, 2))).toEqual([false, true, true, true, true, false]);
    expect(pathOccupied(paths, -1, 2)).toBe(false);
    expect(pathOccupiedWidth(paths, 0, 2, 2)).toBe(true); // blocs 0 et 8
    expect(pathOccupiedWidth(paths, 1, 2, 2)).toBe(true); // blocs 1 et 9
    expect(pathOccupiedWidth(paths, 2, 2, 1)).toBe(false);
    clearPathOccupied(paths, 7, 2, 2);
    expect([6, 7, 8, 9].map((x) => pathOccupied(paths, x, 2))).toEqual([true, false, false, true]);
  });
});

describe("séquences différées", () => {
  function list() {
    const delayList: DelayedSequence[] = [];
    const executed: number[] = [];
    const ctx = { world: { state: { delayList } }, script: { execute: (o: number) => executed.push(o) } } as unknown as LureContext;
    return { delays: new DelayList(ctx), delayList, executed };
  }

  it("décompte 80 ms par image, exécute une seule séquence échue par image, ajoute en tête", () => {
    const { delays, delayList, executed } = list();
    delays.add(1, 0x100, true);
    delays.add(0, 0x200, false);
    expect(delayList.map((e) => e.sequenceOffset)).toEqual([0x200, 0x100]);
    delays.tick();
    expect(executed).toEqual([0x200]);
    expect(delayList[0]!.timeoutCtr).toBe(1000);
    for (let i = 0; i < 12; i++) delays.tick();
    expect(executed).toEqual([0x200]);
    delays.tick();
    expect(executed).toEqual([0x200, 0x100]);
  });

  it("clear ne retire que les séquences effaçables, sauf forcé", () => {
    const { delays, delayList } = list();
    delays.add(5, 1, true);
    delays.add(5, 2, false);
    delays.clear();
    expect(delayList.map((e) => e.sequenceOffset)).toEqual([2]);
    delays.clear(true);
    expect(delayList).toEqual([]);
  });
});

describe.skipIf(!hasOriginalFiles)("scripts d'animation des hotspots (0x3F0D)", () => {
  it("les 24 scripts de la table et ceux des hotspots animés par script se décodent", () => {
    const data = lureData();
    const starts = new Set<number>(data.hotspotScriptOffsets);
    // Seuls les gestionnaires 11 à 22 exécutent le script du hotspot ; ailleurs le champ peut être quelconque (0x46B : 0x6400).
    for (const h of data.hotspots) {
      if (h.hotspotId < 0x7530 && h.tickProcId >= 11 && h.tickProcId <= 22 && h.hotspotScriptOffset !== 0xffff) starts.add(h.hotspotScriptOffset);
    }
    let unloads = 0;
    for (const start of starts) {
      const ops = disassembleHotspotScript(data.scripts2, start);
      expect(ops.length).toBeGreaterThan(0);
      if (ops.some((o) => o.opcode === S2.UNLOAD)) unloads++;
    }
    expect(starts.size).toBeGreaterThan(24);
    expect(unloads).toBeGreaterThan(0);
  });
});
