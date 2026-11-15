import { describe, expect, it } from "vitest";
import { MemoryStorage, prefixedStorage, type HostStorage } from "../../../src/engine/storage";
import { PART_LOCKED, emptyPart } from "../../../src/games/tim3/data/lev";
import { Editor } from "../../../src/games/tim3/engine/editor";
import { OFF_BOTTOM } from "../../../src/games/tim3/engine/lab-puzzle";
import type { Part } from "../../../src/games/tim3/engine/part";
import {
  EditStore,
  LAB_EDIT_KEY,
  SAVE_VERSION,
  hasGoal,
  labSaveSlots,
  loadMachine,
  machineLevel,
  puzzleLevel,
  saveMachine,
  snapshotLab,
} from "../../../src/games/tim3/engine/save";
import { DEFAULT_LAB, HOME_CATEGORY, HomeProgress, Tim3Session, homePuzzleRef, homeSlot, labLevel } from "../../../src/games/tim3/engine/session";
import { original, realTypes } from "../engine/helpers";

const reopen = (store: MemoryStorage): HostStorage => prefixedStorage(store, "tim3:");
const NOW = 1_700_000_000_000;
const LOCKED = 0x40;

function lab(): Tim3Session {
  const s = new Tim3Session(realTypes(), labLevel(DEFAULT_LAB), { lab: DEFAULT_LAB });
  s.editor.stockLab(Editor.labTypes(s.world, 0));
  return s;
}

/** Pose la pièce tenue au point (x, y) de l'aire. */
function place(editor: Editor, x: number, y: number): void {
  editor.hover(x, y);
  expect(editor.click(x, y)).toBe("placed");
}

/** Au Labo, par l'éditeur : un mur verrouillé, une balle libre qui doit sortir par le bas, un but et un indice. */
function buildMachine(): { session: Tim3Session; wall: Part; ball: Part } {
  const s = lab();
  const wall = s.editor.takeNew(1);
  place(s.editor, 100, 300);
  s.editor.toggleLock(wall);
  const ball = s.editor.takeNew(0);
  place(s.editor, 280, 40);
  const p = s.labPuzzle!;
  p.goal = "Faites tomber la boule de bowling hors de l'écran.";
  expect(p.addHint(300, 120, "Posez la boule au-dessus du vide.")).toBe(0);
  p.flipHint(0);
  expect(p.setCondition(ball, { state1: 0, state2: 0, count: 0, rectX: OFF_BOTTOM.x, rectY: OFF_BOTTOM.y, rectWidth: OFF_BOTTOM.width, rectHeight: OFF_BOTTOM.height })).toBe(true);
  p.delay = 5;
  return { session: s, wall, ball };
}

describe.skipIf(!original.has)("puzzle maison de bout en bout (Labo → sauvegarde → bac « Maison »)", () => {
  it("sauvegardé puis relu : titre, but, indice, condition sur la même pièce, cadenas", () => {
    const { session } = buildMachine();
    const machine = snapshotLab(session.world, session.lab!, session.labPuzzle)!;
    expect(hasGoal(machine)).toBe(true);
    const store = new MemoryStorage();
    expect(saveMachine(labSaveSlots(reopen(store)), 3, "Chute libre", machine, NOW)).toBe("saved");
    const back = loadMachine(labSaveSlots(reopen(store)), 3);
    expect(back.status).toBe("loaded");
    if (back.status !== "loaded") return;
    expect(back.machine).toEqual(machine);
    expect(store.get("tim3:slot03")).toContain(`"version":${SAVE_VERSION}`);

    // Rouvert au Labo : mêmes pièces, le mur toujours verrouillé, le puzzle maison intact.
    const again = new Tim3Session(realTypes(), machineLevel(back.machine, back.name), { lab: DEFAULT_LAB, unlock: back.machine.placed });
    const parts = [...again.world.statics, ...again.world.mobiles];
    const wall = parts.find((p) => p.type === 1)!;
    const ball = parts.find((p) => p.type === 0)!;
    expect(wall.flags14 & LOCKED).toBe(LOCKED);
    expect(ball.flags14 & LOCKED).toBe(0);
    const p = again.labPuzzle!;
    expect(again.level.title).toBe("Chute libre");
    expect(p.goal).toBe("Faites tomber la boule de bowling hors de l'écran.");
    expect(p.hints[0]).toEqual({ x: 300, y: 120, flip: 1, text: "Posez la boule au-dessus du vide." });
    expect(p.conditions.map((c) => [c.part, c.rectY])).toEqual([[ball, OFF_BOTTOM.y]]);
    expect(p.delay).toBe(5);
  });

  it("joué comme un puzzle : les pièces non verrouillées au bac, le joueur pose la balle et le puzzle est résolu", () => {
    const { session, wall } = buildMachine();
    const machine = snapshotLab(session.world, session.lab!, session.labPuzzle)!;
    const level = puzzleLevel(machine, "Chute libre");
    const ref = homePuzzleRef(3);
    expect([ref.category, homeSlot(ref), ref.index]).toEqual([HOME_CATEGORY, 3, -1]);
    const play = new Tim3Session(realTypes(), level, { puzzle: ref });
    expect(play.lab).toBeNull();
    // Le mur verrouillé reste à sa place ; la balle est au bac (43267a).
    const statics = [...play.world.statics];
    expect(statics.map((p) => [p.type, p.px, p.py])).toEqual([[1, wall.px, wall.py]]);
    expect(play.editor.binParts().map((p) => p.type)).toEqual([0]);
    expect(play.editor.isMovable(statics[0]!)).toBe(false);
    expect(level.goal).toBe("Faites tomber la boule de bowling hors de l'écran.");
    expect(level.hints[0]!.text).toBe("Posez la boule au-dessus du vide.");

    // Sans la balle posée, le but n'est jamais atteint (pièce visée au bac : 436dc6 rend 1).
    play.start();
    for (let i = 0; i < 60; i++) expect(play.tick().solved).toBe(false);
    play.stop();

    // Le joueur prend la balle au bac et la pose au-dessus du vide.
    const ball = play.editor.binParts()[0]!;
    play.editor.takeFromBin(ball);
    place(play.editor, 280, 40);
    play.start();
    let solved = false;
    let steps = 0;
    while (!solved && steps < 400) {
      solved = play.tick().solved;
      steps++;
    }
    expect(solved).toBe(true);
    expect(play.running).toBe(false);
  });

  it("progression des puzzles maison : par emplacement et date de sauvegarde, une machine remplacée repart non résolue", () => {
    const store = new MemoryStorage();
    const progress = new HomeProgress(reopen(store));
    progress.markSolved(3, NOW);
    progress.markSolved(5, NOW + 7);
    const again = new HomeProgress(reopen(store));
    expect([again.isSolved(3, NOW), again.isSolved(5, NOW + 7), again.isSolved(3, NOW + 1)]).toEqual([true, true, false]);
    again.markSolved(3, NOW + 1);
    const third = new HomeProgress(reopen(store));
    expect([third.isSolved(3, NOW), third.isSolved(3, NOW + 1)]).toEqual([false, true]);
    store.set("tim3:homeSolved", "x,3@,99@1,<b>,4@12");
    expect(new HomeProgress(reopen(store)).isSolved(4, 12)).toBe(true);
  });
});

describe("sauvegardes : migration de la version 1 (machines sans puzzle maison)", () => {
  const ball = { ...emptyPart(0), type: 0, flags1: 0x1000, flags3: PART_LOCKED, x: 100, y: 50, width1: 16, height1: 16, width2: 16, height2: 16, connected1: -1, connected2: -1, plugged1: -1, plugged2: -1 };
  const v1Machine = { ...DEFAULT_LAB, fixedParts: [], movingParts: [ball], placed: [0] };

  it("un emplacement de la version 1 se lit, avec un puzzle vide, puis se réécrit en version 2", () => {
    const store = new MemoryStorage();
    store.set("tim3:slot02", JSON.stringify({ savedAt: NOW, save: { version: 1, name: "Ancienne", machine: v1Machine } }));
    const slots = labSaveSlots(reopen(store));
    const back = loadMachine(slots, 2);
    expect(back.status).toBe("loaded");
    if (back.status !== "loaded") return;
    expect(back.name).toBe("Ancienne");
    expect(back.machine.movingParts).toEqual([ball]);
    expect([back.machine.goal, back.machine.hints.length, back.machine.hints.every((h) => h.text === ""), hasGoal(back.machine)]).toEqual(["", 8, true, false]);
    expect(saveMachine(slots, 2, "Ancienne", back.machine, NOW + 1, true)).toBe("saved");
    expect(JSON.parse(store.get("tim3:slot02")!).save.version).toBe(2);
    expect(loadMachine(labSaveSlots(reopen(store)), 2)).toEqual(back);
  });

  it("le Labo gardé en version 1 et l'aire d'un puzzle en version 1 se relisent", () => {
    const store = new MemoryStorage();
    store.set(`tim3:${LAB_EDIT_KEY}`, JSON.stringify({ version: 1, parts: v1Machine }));
    store.set("tim3:edit:TLEV2", JSON.stringify({ version: 1, parts: { fixedParts: [], movingParts: [ball], placed: [0] } }));
    const edits = new EditStore(reopen(store));
    expect(edits.lab()).toMatchObject({ gravity: DEFAULT_LAB.gravity, goal: "", movingParts: [ball] });
    expect(edits.puzzle("TLEV2")?.placed).toEqual([0]);
    // Une version 1 qui porterait déjà des champs de la version 2 les ignore (ils n'existaient pas).
    store.set(`tim3:${LAB_EDIT_KEY}`, JSON.stringify({ version: 1, parts: { ...v1Machine, goal: 12 } }));
    expect(edits.lab()?.goal).toBe("");
  });
});
