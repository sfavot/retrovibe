/**
 * Sauvegarde et reprise (vague S, D5) : à plusieurs points des scénarios du banc, la partie est sauvegardée, passée par
 * `JSON.stringify` / `JSON.parse`, reprise dans un moteur neuf (construit seulement pour la reprise), puis le rejeu continue : la trace
 * (`FR`, `NF`, `SS`, `PL`/`RL`/`CL`, `AC`, `VH`, et `SC` à partir du tour 3501 quand la fixture les a) doit rester celle du banc
 * ininterrompu.
 *
 * Ce que le test reporte du moteur ininterrompu au moteur neuf, et qui n'est pas dans une sauvegarde : le numéro de tour (compteur du
 * banc), l'état du RNG (D5 : non sauvegardé, comme dans ScummVM), et l'état des entrées (position et boutons de la souris, dernier
 * niveau rejoué). La cadence n'est pas reportée : le moteur neuf repart de son temps virtuel 0 (premier tour après 50 ms au lieu de
 * 100, puis `gameSpeed` revient à 100 au premier tour, avant la ligne `FR`).
 */
import { describe, expect, it } from "vitest";
import { canSave, captureSave, describeSave, parseSave, restoreSave } from "../../../src/games/croisiere/engine/save";
import { ObjType } from "../../../src/games/croisiere/engine/ids";
import type { CroisiereEngine } from "../../../src/games/croisiere/engine/main-loop";
import { replayBench, type EngineSwap } from "./replay";
import { hasOriginalFiles } from "./support";

/** Ce que le banc garde d'un tour à l'autre hors de la partie (voir l'en-tête). */
interface BenchInputState {
  prevLevel: { x: number; y: number; b: number };
  escReleaseTick: number;
}

function saveAndResume(frame: number, check?: (engine: CroisiereEngine) => void): EngineSwap & { saved: { size: number; place: string } } {
  const saved = { size: 0, place: "" };
  return {
    frame,
    saved,
    swap(old, make) {
      check?.(old);
      const text = JSON.stringify(captureSave(old.state));
      saved.size = text.length;
      saved.place = describeSave(old.state);
      const save = parseSave(JSON.parse(text));
      if (!save) throw new Error("sauvegarde refusée par parseSave");
      const fresh = make();
      restoreSave(fresh.state, save);
      fresh.frameNumber = old.frameNumber;
      fresh.state.rnd.seed(old.state.rnd.state);
      const o = old.state;
      const f = fresh.state;
      f.currentMouseX = o.currentMouseX;
      f.currentMouseY = o.currentMouseY;
      f.currentMouseButton = o.currentMouseButton;
      Object.assign(fresh.input, { hoverX: old.input.hoverX, hoverY: old.input.hoverY, mouseButtonDown: old.input.mouseButtonDown, endPause: old.input.endPause });
      const from = old as unknown as BenchInputState;
      const to = fresh as unknown as BenchInputState;
      to.prevLevel = { ...from.prevLevel };
      to.escReleaseTick = from.escReleaseTick;
      return fresh;
    },
  };
}

const CASES: { name: string; trace: string[]; inputs: string; keys?: string; at: number; last: number; place: string; screens?: boolean; message?: boolean }[] = [
  { name: "première pièce, au repos", trace: ["bench-first-room-l2.trace.gz", "bench-walk-s33-l2.trace.gz"], inputs: "walk-s33.in", at: 3500, last: 3800, place: "S33" },
  { name: "en pleine marche", trace: ["bench-first-room-l2.trace.gz", "bench-walk-s33-l2.trace.gz"], inputs: "walk-s33.in", at: 3530, last: 3900, place: "S33" },
  { name: "marche relancée en pleine marche", trace: ["bench-first-room-l2.trace.gz", "bench-walk-s33-l2.trace.gz"], inputs: "walk-s33.in", at: 5026, last: 5300, place: "S33" },
  { name: "après le gros plan du livre (menu d'objet, REL)", trace: ["bench-first-room-l2.trace.gz", "bench-look-s33-l2.trace.gz"], inputs: "look-s33.in", at: 3730, last: 3900, place: "S33", screens: true },
  { name: "message à l'écran", trace: ["bench-first-room-l2.trace.gz", "bench-look-s33-l2.trace.gz"], inputs: "look-s33.in", at: 3830, last: 3900, place: "S33", screens: true, message: true },
  { name: "S36 après la porte, puis Recommencer", trace: ["bench-first-room-l2.trace.gz", "bench-menu-s33-l2.trace.gz"], inputs: "menu-s33.in", keys: "menu-s33.keys", at: 3940, last: 4400, place: "S36", screens: true },
];

describe.skipIf(!hasOriginalFiles)("sauvegarde : reprise identique au banc", () => {
  for (const c of CASES) {
    it(`${c.name} : sauvegarde au tour ${c.at}, trace identique jusqu'au tour ${c.last}`, () => {
      const swap = saveAndResume(c.at, (engine) => {
        expect(canSave(engine.state)).toBe(true);
        if (c.message) expect(engine.state.cells.toArray().some((cell) => cell.type === ObjType.MESSAGE && cell.gfx)).toBe(true);
      });
      const { engine, mismatch } = replayBench(c.trace, c.inputs, c.keys ?? null, c.last, c.screens ? 3501 : 0, swap);
      if (mismatch) throw new Error(mismatch);
      expect(engine.frameNumber).toBe(c.last);
      expect(swap.saved.place).toBe(c.place);
      expect(swap.saved.size).toBeGreaterThan(0);
      expect(swap.saved.size).toBeLessThan(200_000);
    });
  }
});

describe.skipIf(!hasOriginalFiles)("sauvegarde : refus", () => {
  it("refuse pendant l'intro, puis accepte dans la première pièce", () => {
    const seen: boolean[] = [];
    replayBench("bench-first-room-l2.trace.gz", null, null, 3000, 0, { frame: 3000, swap: (e) => (seen.push(canSave(e.state)), e) });
    const idle = replayBench("bench-first-room-l2.trace.gz", null, null, 3500).engine;
    expect(seen).toEqual([false]);
    expect(canSave(idle.state)).toBe(true);
  });

  it("refuse après le chargement de DGF1.PI1 et quand un menu du jeu est ouvert", () => {
    const { engine } = replayBench("bench-first-room-l2.trace.gz", null, null, 3500);
    const e = engine.state;
    expect(canSave(e)).toBe(true);
    e.currentActiveMenu = 0;
    expect(canSave(e)).toBe(false);
    e.currentActiveMenu = -1;
    e.display.backgroundNames[1] = "DGF1.PI1";
    expect(canSave(e)).toBe(false);
  });

  it("parseSave refuse une autre version", () => {
    const { engine } = replayBench("bench-first-room-l2.trace.gz", null, null, 3500);
    const save = JSON.parse(JSON.stringify(captureSave(engine.state)));
    expect(parseSave(save)).not.toBeNull();
    expect(parseSave({ ...save, version: 2 })).toBeNull();
    expect(parseSave(null)).toBeNull();
  });
});
