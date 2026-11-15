import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MemoryStorage, prefixedStorage, type HostStorage } from "../../../src/engine/storage";
import { emptyPart, levelParts, readLev, type Level } from "../../../src/games/tim3/data/lev";
import type { Part } from "../../../src/games/tim3/engine/part";
import {
  EditStore,
  LAB_EDIT_KEY,
  NAME_MAX,
  SAVE_VERSION,
  SLOT_COUNT,
  cleanName,
  emptyPuzzle,
  labSaveSlots,
  levelWithParts,
  loadMachine,
  machineLevel,
  machineSettings,
  parseLabSave,
  saveMachine,
  snapshotLab,
  snapshotWorld,
  type LabMachine,
  type PartsSnapshot,
} from "../../../src/games/tim3/engine/save";
import { DEFAULT_LAB, Progress, type LabSettings, Tim3Session, labLevel, puzzleList } from "../../../src/games/tim3/engine/session";
import { baseIndex, original } from "../data/real";
import { realTypes } from "../engine/helpers";
import type { Solution } from "../solutions/apply";
import { replay, run } from "./replay";
import { parseLines } from "../../../src/games/tim3/data/text";
import { parseProgramRows } from "../../../src/games/tim3/engine/program";

/** Un stockage « rechargé » : mêmes données, nouvelle vue (comme une page rouverte). */
const reopen = (store: MemoryStorage): HostStorage => prefixedStorage(store, "tim3:");
const viaJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Machine minimale sans fichiers du jeu : deux balles. */
function toyMachine(overrides: Partial<LabMachine> = {}): LabMachine {
  const ball = emptyPart(0);
  Object.assign(ball, { type: 0, flags1: 0x1000, flags3: 0x40, x: 100, y: 50, width1: 16, height1: 16, width2: 16, height2: 16, connected1: -1, connected2: -1, plugged1: -1, plugged2: -1 });
  const second = { ...ball, x: 200 };
  return { ...DEFAULT_LAB, fixedParts: [], movingParts: [ball, second], placed: [0, 1], ...emptyPuzzle(), ...overrides };
}

describe("progression (D11)", () => {
  it("résolus et dernier puzzle reviennent après rechargement", () => {
    const store = new MemoryStorage();
    const first = new Progress(reopen(store));
    first.markSolved("TLEV3");
    first.markSolved("RLEV29");
    first.last = "ELEV2";
    const again = new Progress(reopen(store));
    expect([again.isSolved("TLEV3"), again.isSolved("RLEV29"), again.isSolved("TLEV4"), again.last]).toEqual([true, true, false, "ELEV2"]);
    expect(again.count(puzzleList().map((p) => p.name))).toBe(2);
  });

  it("ignore les noms qui ne sont pas des puzzles du jeu, à la lecture comme à l'écriture ; les HH se notent résolus, pas « dernier »", () => {
    const store = new MemoryStorage();
    store.set("tim3:solved", "TLEV1,TLEV99,HH1,HH51,<b>,,XLEV2");
    store.set("tim3:last", "TLEV99");
    const p = new Progress(reopen(store));
    expect(p.count(["TLEV1", "TLEV99", "HH1", "HH51"])).toBe(2);
    expect(p.last).toBeNull();
    p.markSolved("TLEV99");
    p.last = "../x";
    p.last = "HH2";
    expect(store.get("tim3:solved")).toBe("TLEV1,TLEV99,HH1,HH51,<b>,,XLEV2");
    expect(store.get("tim3:last")).toBe("TLEV99");
    p.markSolved("TLEV2");
    expect(new Progress(reopen(store)).isSolved("TLEV2")).toBe(true);
  });
});

describe("machines du Labo : emplacements", () => {
  const NOW = 1_700_000_000_000;

  it("aller-retour d'une machine par emplacement, après rechargement du stockage", () => {
    const store = new MemoryStorage();
    const slots = labSaveSlots(reopen(store));
    const machine = toyMachine({ gravity: 120, pressure: 9, background: 7, music: 1003 });
    expect(saveMachine(slots, 4, "  Ma   machine ", machine, NOW)).toBe("saved");
    const back = loadMachine(labSaveSlots(reopen(store)), 4);
    expect(back).toEqual({ status: "loaded", name: "Ma machine", machine });
    expect(machineSettings(machine)).toEqual({ gravity: 120, pressure: 9, background: 7, music: 1003 });
    expect(store.get("tim3:slot04")).toContain(`"version":${SAVE_VERSION}`);
    expect(loadMachine(slots, 5)).toEqual({ status: "empty" });
  });

  it("dix emplacements, hors bornes refusés sans plantage", () => {
    const slots = labSaveSlots(new MemoryStorage());
    expect(slots.count).toBe(SLOT_COUNT);
    for (let i = 1; i <= SLOT_COUNT; i++) expect(saveMachine(slots, i, `m${i}`, toyMachine(), NOW)).toBe("saved");
    expect(saveMachine(slots, 0, "x", toyMachine(), NOW, true)).toBe("failed");
    expect(saveMachine(slots, 11, "x", toyMachine(), NOW, true)).toBe("failed");
    expect(loadMachine(slots, 11)).toEqual({ status: "empty" });
    expect(slots.summaries((s) => s.save.name, (n) => `vide ${n}`).every((s) => !s.empty)).toBe(true);
  });

  it("emplacement plein : refusé sans confirmation, remplacé avec", () => {
    const slots = labSaveSlots(new MemoryStorage());
    expect(saveMachine(slots, 2, "Première", toyMachine(), NOW)).toBe("saved");
    expect(saveMachine(slots, 2, "Seconde", toyMachine({ gravity: 5 }), NOW + 1)).toBe("occupied");
    expect((loadMachine(slots, 2) as { name: string }).name).toBe("Première");
    expect(saveMachine(slots, 2, "Seconde", toyMachine({ gravity: 5 }), NOW + 1, true)).toBe("saved");
    const again = loadMachine(slots, 2);
    expect(again.status === "loaded" && [again.name, again.machine.gravity]).toEqual(["Seconde", 5]);
  });

  it("nom vide ou d'espaces : refusé, rien n'est écrit ; nom trop long : coupé", () => {
    const store = new MemoryStorage();
    const slots = labSaveSlots(reopen(store));
    expect(saveMachine(slots, 1, "", toyMachine(), NOW)).toBe("noName");
    expect(saveMachine(slots, 1, " \t  ", toyMachine(), NOW, true)).toBe("noName");
    expect(store.data.size).toBe(0);
    expect(cleanName("x".repeat(80))).toBe("x".repeat(NAME_MAX));
    expect(saveMachine(slots, 1, "y".repeat(80), toyMachine(), NOW)).toBe("saved");
    expect((loadMachine(slots, 1) as { name: string }).name).toHaveLength(NAME_MAX);
  });

  it("aire sans pièce posée : rien à sauvegarder", () => {
    const slots = labSaveSlots(new MemoryStorage());
    expect(saveMachine(slots, 1, "Vide", toyMachine({ movingParts: [], placed: [] }), NOW)).toBe("empty");
    expect(loadMachine(slots, 1)).toEqual({ status: "empty" });
  });

  it("stockage plein ou bloqué : signalé, sans exception", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const blocked: HostStorage = { get: () => null, set: () => false, remove: () => undefined };
    expect(saveMachine(labSaveSlots(blocked), 1, "Plein", toyMachine(), NOW)).toBe("failed");
    warn.mockRestore();
  });

  it("version inconnue, JSON cassé ou données corrompues : emplacement vide, jamais d'exception", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = new MemoryStorage();
    const slots = labSaveSlots(reopen(store));
    const good = { version: SAVE_VERSION, name: "Bonne", machine: toyMachine() };
    const bad = (save: unknown): string => JSON.stringify({ savedAt: 1, save });
    const corrupt = [
      bad({ ...good, version: 3 }),
      bad({ ...good, version: "1" }),
      bad({ ...good, machine: { ...good.machine, goal: 4 } }),
      bad({ ...good, machine: { ...good.machine, hints: [] } }),
      bad({ ...good, machine: { ...good.machine, hints: good.machine.hints.map((h, i) => (i === 0 ? { ...h, flip: 9 } : h)) } }),
      bad({ ...good, machine: { ...good.machine, solution: { ...good.machine.solution, conditions: [] } } }),
      bad({ ...good, machine: { ...good.machine, solution: { ...good.machine.solution, conditions: good.machine.solution.conditions.map((c, i) => (i === 0 ? { ...c, partIndex: 2 } : c)) } } }),
      bad({ ...good, machine: { ...good.machine, solution: undefined } }),
      bad({ ...good, name: "" }),
      bad({ ...good, name: 7 }),
      bad({ ...good, machine: null }),
      bad({ ...good, machine: { ...good.machine, gravity: "lourde" } }),
      bad({ ...good, machine: { ...good.machine, background: 99 } }),
      bad({ ...good, machine: { ...good.machine, placed: [5] } }),
      bad({ ...good, machine: { ...good.machine, movingParts: [{ type: 0 }] } }),
      bad({ ...good, machine: { ...good.machine, movingParts: [{ ...emptyPart(0), type: 9999 }] } }),
      bad({ ...good, machine: { ...good.machine, movingParts: [{ ...emptyPart(0), kind: "rope" }] } }),
      bad({ ...good, machine: { ...good.machine, movingParts: [{ ...emptyPart(0), x: 1.5 }] } }),
      bad(null),
      bad("texte"),
      JSON.stringify({ save: good }),
      "{pas du json",
      "[]",
      "null",
    ];
    corrupt.forEach((text, i) => {
      store.set("tim3:slot01", text);
      expect(loadMachine(slots, 1), `cas ${i}`).toEqual({ status: "empty" });
    });
    expect(parseLabSave(undefined)).toBeNull();
    expect(parseLabSave(good)).toEqual(good);
    warn.mockRestore();
  });

  it("une valeur d'un autre jeu dans les mêmes clés ne gêne pas la progression", () => {
    const store = new MemoryStorage();
    const slots = labSaveSlots(reopen(store));
    saveMachine(slots, 1, "A", toyMachine(), NOW);
    new Progress(reopen(store)).markSolved("TLEV1");
    expect(loadMachine(slots, 1).status).toBe("loaded");
    expect(new Progress(reopen(store)).isSolved("TLEV1")).toBe(true);
  });
});

describe("état d'édition : stockage", () => {
  const parts: PartsSnapshot = { fixedParts: [], movingParts: toyMachine().movingParts, placed: [0] };

  it("puzzle et Labo : gardés, relus après rechargement, effacés", () => {
    const store = new MemoryStorage();
    const edits = new EditStore(reopen(store));
    expect(edits.puzzle("TLEV7")).toBeNull();
    expect(edits.savePuzzle("TLEV7", parts)).toBe(true);
    expect(edits.saveLab(toyMachine({ gravity: 33 }))).toBe(true);
    const again = new EditStore(reopen(store));
    expect(again.puzzle("TLEV7")).toEqual(parts);
    expect(again.puzzle("TLEV8")).toBeNull();
    expect(again.lab()?.gravity).toBe(33);
    again.clearPuzzle("TLEV7");
    again.clearLab();
    expect([again.puzzle("TLEV7"), again.lab()]).toEqual([null, null]);
  });

  it("nom de puzzle inconnu refusé ; version inconnue ou données corrompues ignorées", () => {
    const store = new MemoryStorage();
    const edits = new EditStore(reopen(store));
    expect(edits.savePuzzle("../x", parts)).toBe(false);
    expect(edits.savePuzzle("HH3", parts)).toBe(false);
    expect(store.data.size).toBe(0);
    for (const text of [
      JSON.stringify({ version: 3, parts }),
      JSON.stringify({ version: 1, parts: { ...parts, placed: [3] } }),
      JSON.stringify({ version: 1, parts: { ...parts, fixedParts: "non" } }),
      JSON.stringify({ version: 1 }),
      "{cassé",
      "12",
    ]) {
      store.set("tim3:edit:TLEV1", text);
      store.set(`tim3:${LAB_EDIT_KEY}`, text);
      expect(edits.puzzle("TLEV1"), text).toBeNull();
      expect(edits.lab(), text).toBeNull();
    }
  });
});

// ------------------------------------------------------------------ avec les fichiers du jeu

/** Ce qui doit revenir à l'identique d'une aire reprise : pièces posées et du bac, avec leur état d'édition et leurs liens. */
function state(s: Tim3Session, originals = Infinity): string[] {
  const label = (p: Part | null): string => (p ? `${p.type}@${p.editX},${p.editY}` : "-");
  const lines = (list: Iterable<Part>, where: string): string[] =>
    [...list].map((p) =>
      [
        where,
        p.levIndex >= 0 && p.levIndex < originals ? `#${p.levIndex}` : "+",
        label(p),
        `f${p.editFrame}`,
        `fl${p.flags10 & 0x32}`,
        `${p.boxW}x${p.boxH}`,
        `lock${p.flags14 & 0x40}`,
        `links${[p.links[0], p.links[1], p.links[4], p.links[5]].map(label).join(",")}`,
        `rope${p.ropes.map((r) => (r ? `${label(r.end1)}/${label(r.end2)}/${r.slot1}${r.slot2}` : "-")).join(",")}`,
        `belt${p.belt ? `${label(p.belt.end1)}/${label(p.belt.end2)}` : "-"}`,
        `prog${p.prog ? [...p.prog].join(",") : "-"}`,
      ].join(" "),
    );
  return [...lines(s.world.statics, "S"), ...lines(s.world.mobiles, "M"), ...lines(s.world.bin, "B")].sort();
}

/** Reprise comme le fait l'application : niveau d'origine + pièces, puis les pièces posées sont déverrouillées. */
function resume(base: Level, parts: PartsSnapshot, puzzle = puzzleList()[0]!): Tim3Session {
  return new Tim3Session(realTypes(), levelWithParts(base, viaJson(parts)), { puzzle, unlock: parts.placed, originalCount: levelParts(base).length });
}

const SOLUTIONS = resolve(import.meta.dirname, "../solutions");
const solution = (name: string) => JSON.parse(readFileSync(resolve(SOLUTIONS, `${name}.json`), "utf8")) as Solution;
const programs = () => parseProgramRows(parseLines(baseIndex().get("PROGPART.RES")));

/** Un puzzle de chaque famille de gestes (voir `replay.test.ts`) : pose libre, courroie, poulies, télécommande, programmation… */
const FAMILIES = ["TLEV1", "TLEV11", "TLEV12", "TLEV31", "ELEV12", "HLEV19", "TLEV4", "RLEV21", "TLEV27", "MLEV24", "RLEV1", "TLEV32", "TLEV38", "HLEV24", "RLEV3"];

describe.skipIf(!original.has)("état d'édition d'un puzzle : photo et reprise", () => {
  for (const name of FAMILIES) {
    it(`${name} : la solution posée à la main est reprise à l'identique et se résout au même pas`, () => {
      const level = readLev(baseIndex().get(`${name}.LEV`));
      const sol = solution(name);
      const ref = puzzleList().find((p) => p.name === name)!;
      const s = new Tim3Session(realTypes(), level, { puzzle: ref });
      expect(replay(s, level, sol, programs())).toEqual([]);
      s.editor.release();
      const photo = snapshotWorld(s.world, level)!;
      expect(photo).not.toBeNull();
      const back = resume(level, photo, ref);
      const n = levelParts(level).length;
      expect(state(back, n)).toEqual(state(s, n));
      // Reprise exacte aussi après le passage par le stockage (JSON).
      const edits = new EditStore(new MemoryStorage());
      expect(edits.savePuzzle(name, photo)).toBe(true);
      const stored = edits.puzzle(name)!;
      expect(stored).toEqual(photo);
      const resumed = resume(level, stored, ref);
      expect(state(resumed, n)).toEqual(state(s, n));
      // Une seconde photo de la reprise redonne la première.
      expect(snapshotWorld(resumed.world, level)).toEqual(photo);
      // La machine reprise se résout comme l'originale.
      const at = run(resumed, sol.goalStep + 40);
      expect(at).toBe(run(s, sol.goalStep + 40));
      expect(at).toBeGreaterThan(0);
    });
  }

  it("puzzle intact : la photo ne garde que le bac, et un puzzle sans état gardé démarre normalement", () => {
    const level = readLev(baseIndex().get("TLEV1.LEV"));
    const s = new Tim3Session(realTypes(), level);
    const photo = snapshotWorld(s.world, level)!;
    expect(photo.placed).toEqual([]);
    expect(state(resume(level, photo))).toEqual(state(s));
    expect(new EditStore(new MemoryStorage()).puzzle("TLEV1")).toBeNull();
  });

  it("jamais en pleine simulation : pas de photo en marche, et l'arrêt revient à l'état d'avant « Démarrer »", () => {
    const level = readLev(baseIndex().get("TLEV1.LEV"));
    const s = new Tim3Session(realTypes(), level);
    const bin = s.editor.binParts().find((p) => p.type === 0)!;
    s.editor.takeFromBin(bin);
    expect(s.editor.click(100, 100)).toBe("placed");
    const before = snapshotWorld(s.world, level)!;
    s.start();
    for (let i = 0; i < 40; i++) s.tick();
    expect(snapshotWorld(s.world, level)).toBeNull();
    s.stop();
    expect(snapshotWorld(s.world, level)).toEqual(before);
  });

  it("la pièce tenue est rendue au bac avant la photo", () => {
    const level = readLev(baseIndex().get("TLEV1.LEV"));
    const s = new Tim3Session(realTypes(), level);
    const reference = snapshotWorld(s.world, level)!;
    s.editor.takeFromBin(s.editor.binParts()[0]!);
    s.editor.release();
    expect(snapshotWorld(s.world, level)).toEqual(reference);
  });

  it("pièces verrouillées du puzzle : toujours verrouillées après reprise ; pièce posée : déplaçable", () => {
    const level = readLev(baseIndex().get("TLEV1.LEV"));
    const s = new Tim3Session(realTypes(), level);
    s.editor.takeFromBin(s.editor.binParts().find((p) => p.type === 0)!);
    s.editor.click(100, 100);
    const back = resume(level, snapshotWorld(s.world, level)!);
    const parts = [...back.world.staticThenMobile()];
    const movable = parts.filter((p) => back.editor.isMovable(p));
    expect(movable.map((p) => p.type)).toEqual([0]);
    expect(parts.length).toBeGreaterThan(1);
  });

  it("photo incomplète (pièce du LEV introuvable) : refusée", () => {
    const level = readLev(baseIndex().get("TLEV1.LEV"));
    const s = new Tim3Session(realTypes(), level);
    s.world.bin.remove(s.world.bin.head!);
    expect(snapshotWorld(s.world, level)).toBeNull();
  });
});

describe.skipIf(!original.has)("machine du Labo : photo, emplacement et reprise", () => {
  /** Labo avec une corde entre deux pièces, une poulie, une courroie et une balle programmée. */
  function lab(settings: LabSettings = DEFAULT_LAB): Tim3Session {
    const s = new Tim3Session(realTypes(), labLevel(settings), { lab: { ...settings } });
    const drop = (type: number, x: number, y: number): Part => {
      const p = s.editor.takeNew(type);
      expect(s.editor.click(x, y)).toBe("placed");
      return p;
    };
    drop(0, 120, 80);
    drop(1, 300, 200);
    drop(0x57, 200, 120);
    const wheel = drop(2, 400, 100);
    const wheel2 = drop(2, 480, 100);
    const belt = s.editor.takeNew(8);
    for (const t of [wheel, wheel2]) {
      const r = s.editor.partRect(t);
      s.editor.click(r.x + (r.w >> 1), r.y + (r.h >> 1));
    }
    void belt;
    return s;
  }

  it("aller-retour : photo → emplacement → rechargement → même aire", () => {
    const settings = { gravity: 150, pressure: 20, background: 5, music: 1010 };
    const s = lab(settings);
    s.editor.release();
    const machine = snapshotLab(s.world, s.lab!)!;
    expect(machine.placed.length).toBeGreaterThanOrEqual(5);
    const store = new MemoryStorage();
    expect(saveMachine(labSaveSlots(reopen(store)), 3, "Ma machine", machine, 1)).toBe("saved");
    const loaded = loadMachine(labSaveSlots(reopen(store)), 3);
    if (loaded.status !== "loaded") throw new Error("emplacement vide");
    expect(loaded.machine).toEqual(machine);
    const back = new Tim3Session(realTypes(), machineLevel(loaded.machine), { lab: machineSettings(loaded.machine), unlock: loaded.machine.placed });
    const sans = (lines: string[]): string[] => lines.map((l) => l.replace(/ (#\d+|\+) /, " ")).sort();
    expect(sans(state(back))).toEqual(sans(state(s)));
    expect([back.world.gravity, back.world.pressure, back.background, back.music]).toEqual([150, 20, 5, 1010]);
    // Les pièces reprises restent déplaçables et la machine démarre.
    expect([...back.world.staticThenMobile()].every((p) => back.editor.isMovable(p))).toBe(true);
    expect(snapshotLab(back.world, back.lab!)).toEqual(machine);
    back.start();
    for (let i = 0; i < 30; i++) back.tick();
    expect(back.running).toBe(true);
  });

  it("reprise du Labo après rechargement de la page (état d'édition)", () => {
    const s = lab();
    s.editor.release();
    const store = new MemoryStorage();
    expect(new EditStore(reopen(store)).saveLab(snapshotLab(s.world, s.lab!)!)).toBe(true);
    const kept = new EditStore(reopen(store)).lab()!;
    const back = new Tim3Session(realTypes(), machineLevel(kept), { lab: machineSettings(kept), unlock: kept.placed });
    expect(snapshotLab(back.world, back.lab!)).toEqual(kept);
    expect(back.editor.binParts()).toEqual([]);
  });

  it("Labo vide : rien à sauvegarder", () => {
    const s = new Tim3Session(realTypes(), labLevel(DEFAULT_LAB), { lab: { ...DEFAULT_LAB } });
    const machine = snapshotLab(s.world, s.lab!)!;
    expect(machine.placed).toEqual([]);
    expect(saveMachine(labSaveSlots(new MemoryStorage()), 1, "Vide", machine, 1)).toBe("empty");
  });
});
