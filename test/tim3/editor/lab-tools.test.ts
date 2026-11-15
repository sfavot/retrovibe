import { describe, expect, it } from "vitest";
import { HOLIDAY_TYPES, LAB_TAB_COUNT, SCENERY_TAB, inLabTab, labTabTypes } from "../../../src/games/tim3/engine/bin-tabs";
import { Editor, HANDLE_SIZE, HANDLE_STATES, Zone } from "../../../src/games/tim3/engine/editor";
import { LabPuzzle, MAX_CONDITIONS, OFF_BOTTOM, OFF_SCREEN, OFF_TOP, conditionKind, rangeFrames, solveVariant } from "../../../src/games/tim3/engine/lab-puzzle";
import { readSolveRes } from "../../../src/games/tim3/data/solutions";
import { RenderAssets, imageCount, stateImage } from "../../../src/games/tim3/render";
import { drawOrder } from "../../../src/games/tim3/render/parts";
import { frenchIndex } from "../data/real";
import type { Part } from "../../../src/games/tim3/engine/part";
import { DEFAULT_LAB, Tim3Session, labLevel } from "../../../src/games/tim3/engine/session";
import { original, realTypes } from "../engine/helpers";

const LOCKED = 0x40;

/** Labo vide et sa palette (onglet 0). */
function lab(): Tim3Session {
  const s = new Tim3Session(realTypes(), labLevel(DEFAULT_LAB), { lab: DEFAULT_LAB });
  s.editor.stockLab(Editor.labTypes(s.world, 0));
  return s;
}

/** Pose une pièce neuve du Labo au point (x, y) de l'aire. */
function place(s: Tim3Session, type: number, x: number, y: number): Part {
  const p = s.editor.takeNew(type);
  s.editor.hover(x, y);
  expect(s.editor.click(x, y), `pose du type ${type}`).toBe("placed");
  return p;
}

describe.skipIf(!original.has)("Labo : cadenas (43806a, 42e1e4, 42e9d8, 4209e5, 420afc)", () => {
  it("poignée du cadenas : ouvert à droite en haut, fermé après un appui ; une pièce verrouillée ne se déplace plus", () => {
    const s = lab();
    const ball = place(s, 0, 200, 200);
    const r = s.editor.partRect(ball);
    const lock = s.editor.handles(ball).find((h) => h.zone === Zone.Lock)!;
    expect(lock).toEqual({ zone: Zone.Lock, x: r.x + r.w, y: r.y - HANDLE_SIZE, state: HANDLE_STATES[5] });
    expect(s.editor.zoneAt(ball, lock.x + 5, lock.y + 5)).toBe(Zone.Lock);
    expect(s.editor.toggleLock(ball)).toBe(true);
    expect(ball.flags14 & LOCKED).toBe(LOCKED);
    expect(s.editor.isMovable(ball)).toBe(false);
    // Verrouillée : cadenas fermé (état 13) et infos, plus rien d'autre (43806a rend tôt).
    expect(s.editor.handles(ball).map((h) => [h.zone, h.state])).toEqual([
      [Zone.Info, HANDLE_STATES[9]],
      [Zone.Lock, HANDLE_STATES[6]],
    ]);
    expect(s.editor.toggleLock(ball)).toBe(false);
    expect(s.editor.isMovable(ball)).toBe(true);
  });

  it("cadenas fermé près du bord droit : à gauche de la pièce (42e557)", () => {
    const s = lab();
    const ball = place(s, 0, 540, 200);
    s.editor.toggleLock(ball);
    const r = s.editor.partRect(ball);
    expect(s.editor.handles(ball).find((h) => h.zone === Zone.Lock)).toMatchObject({ x: r.x - HANDLE_SIZE + 18, y: r.y - HANDLE_SIZE });
  });

  it("télécommande et explosifs se verrouillent ensemble ; hors du Labo, pas de cadenas", () => {
    const s = lab();
    const remote = place(s, 0x16, 100, 100);
    const charge = s.editor.held!;
    expect(charge.type).toBe(0x37);
    s.editor.hover(300, 100);
    expect(s.editor.click(300, 100)).toBe("placed");
    s.editor.toggleLock(remote);
    expect([remote.flags14 & LOCKED, charge.flags14 & LOCKED]).toEqual([LOCKED, LOCKED]);
    const play = new Editor(s.world);
    expect(play.toggleLock(remote)).toBeNull();
    expect(play.handles(remote).some((h) => h.zone === Zone.Lock)).toBe(false);
  });

  it("tout verrouiller / tout déverrouiller : pièces posées seulement, décors exceptés", () => {
    const s = lab();
    const a = place(s, 0, 100, 100);
    const b = place(s, 1, 300, 300);
    const tree = place(s, 150, 450, 100);
    expect(tree.flags14 & 0x1000).toBe(0x1000);
    expect(s.editor.lockAll(true)).toBe(2);
    expect([a, b, tree].map((p) => p.flags14 & LOCKED)).toEqual([LOCKED, LOCKED, 0]);
    expect(s.editor.lockAll(true)).toBe(0);
    expect(s.editor.binParts().every((p) => !(p.flags14 & LOCKED))).toBe(true);
    expect(s.editor.lockAll(false)).toBe(2);
    expect([a, b].map((p) => p.flags14 & LOCKED)).toEqual([0, 0]);
  });

  it("décor : se prend et se retire au Labo (pas de cadenas ni d'infos), ne se prend pas en Jeu", () => {
    const s = lab();
    const tree = place(s, 150, 450, 100);
    const r = s.editor.partRect(tree);
    expect(s.editor.partAt(r.x + 2, r.y + 2)).toBe(tree);
    expect(s.editor.zoneMask(tree) & (0x10 | 0x400 | 0x20)).toBe(0);
    const play = new Editor(s.world);
    expect(play.partAt(r.x + 2, r.y + 2)).toBeNull();
    expect(play.isMovable(tree)).toBe(false);
    s.editor.removeToBin(tree);
    expect([...s.world.statics, ...s.world.mobiles]).not.toContain(tree);
  });

  it("décors : poignées de plan (43806a 0x1000 / 0x2000, 42e1e4) à droite, en haut l'arrière-plan, en bas le premier plan", () => {
    const s = lab();
    const forest = place(s, 150, 200, 200);
    const r = s.editor.partRect(forest);
    const right = r.x + r.w;
    expect(s.editor.handles(forest).filter((h) => h.zone === Zone.Back || h.zone === Zone.Front)).toEqual([
      { zone: Zone.Back, x: right, y: r.y - HANDLE_SIZE, state: HANDLE_STATES[11] },
      { zone: Zone.Front, x: right, y: r.y + r.h, state: HANDLE_STATES[12] },
    ]);
    expect([HANDLE_STATES[11], HANDLE_STATES[12]]).toEqual([26, 27]);
    // 438543, 438584 : bords gauches compris.
    expect(s.editor.zoneAt(forest, right, r.y - 1)).toBe(Zone.Back);
    expect(s.editor.zoneAt(forest, right + HANDLE_SIZE - 1, r.y - HANDLE_SIZE)).toBe(Zone.Back);
    expect(s.editor.zoneAt(forest, right, r.y + r.h)).toBe(Zone.Front);
    expect(s.editor.zoneAt(forest, right + HANDLE_SIZE, r.y + r.h)).toBe(Zone.None);
    // Une pièce ordinaire n'en a pas, et `layer` la refuse.
    const ball = place(s, 0, 450, 80);
    expect(s.editor.handles(ball).some((h) => h.zone === Zone.Back || h.zone === Zone.Front)).toBe(false);
    expect(s.editor.layer(ball, true)).toBe(false);
  });

  it("décors : arrière-plan = au bout de la liste (4393e0(…, 1)), premier plan = devant le premier décor (4393e0(…, 0)) ; ordre de dessin", () => {
    const s = lab();
    const wall = place(s, 1, 100, 300);
    const forest = place(s, 150, 200, 200);
    const falls = place(s, 151, 230, 210);
    const desert = place(s, 152, 260, 190);
    const statics = () => [...s.world.statics];
    // Un décor posé passe devant les autres (4393e0(…, 0)) ; les décors restent après les autres pièces.
    expect(statics()).toEqual([wall, desert, falls, forest]);
    const decorOrder = () => drawOrder(s.world).map((d) => d.part).filter((p) => p !== wall);
    expect(decorOrder()).toEqual([forest, falls, desert]);
    expect(s.editor.layer(forest, false)).toBe(true);
    expect(statics()).toEqual([wall, forest, desert, falls]);
    expect(decorOrder()).toEqual([falls, desert, forest]);
    expect(s.editor.layer(forest, true)).toBe(true);
    expect(statics()).toEqual([wall, desert, falls, forest]);
    expect(decorOrder()).toEqual([forest, falls, desert]);
    // Décor seul dans sa liste, en tête : il y reste (le port remet la tête à jour, 4393be ne le fait pas).
    const alone = lab();
    const tree = place(alone, 150, 200, 200);
    expect(alone.editor.layer(tree, true)).toBe(true);
    expect([...alone.world.statics]).toEqual([tree]);
  });

  it("poignée « solution » (0x200) : au Labo, pièces +0x14 & 0x8000, en haut au milieu ; pas pour un mur", () => {
    const s = lab();
    const balloon = place(s, 4, 200, 200);
    const wall = place(s, 1, 400, 300);
    const h = s.editor.handles(balloon).find((k) => k.zone === Zone.Solution)!;
    const r = s.editor.partRect(balloon);
    expect(h).toEqual({ zone: Zone.Solution, x: r.x + ((r.w - HANDLE_SIZE) >> 1), y: r.y - HANDLE_SIZE, state: HANDLE_STATES[10] });
    expect(s.editor.zoneAt(balloon, r.x + (r.w >> 1), r.y - 10)).toBe(Zone.Solution);
    expect(s.editor.handles(wall).some((k) => k.zone === Zone.Solution)).toBe(false);
  });
});

describe.skipIf(!original.has)("Labo : onglets du bac (417264, 4187b5, 43b06c)", () => {
  const types = () => realTypes();

  it("14 onglets ; l'onglet 0 sans décor, l'onglet 1 tous les décors (dont les types 149 à 280)", () => {
    expect(LAB_TAB_COUNT).toBe(14);
    const all = labTabTypes(types(), 0);
    const scenery = labTabTypes(types(), SCENERY_TAB);
    expect(all.every((t) => !(types().get(t).flags14 & 0x1000))).toBe(true);
    expect(scenery.every((t) => types().get(t).flags14 & 0x1000)).toBe(true);
    expect(scenery.filter((t) => t > 148).length).toBeGreaterThan(100);
    expect(scenery).toContain(110);
    // Toutes les pièces du jeu sont dans l'un des deux, sauf les pièces des fêtes hors de leur jour et celles que la table du bac
    // (0x47201c) ne propose pas : pièces créées en marche (20 impulsion laser, 41 explosion, 55, 72 patère) et 149.
    const seen = new Set([...all, ...scenery]);
    const absent = new Set([20, 41, 55, 72, 149]);
    for (let t = 0; t <= 280; t++) if (!HOLIDAY_TYPES.has(t) && !absent.has(t) && types().anims[t]) expect(seen.has(t), `type ${t}`).toBe(true);
    for (const t of absent) expect(seen.has(t)).toBe(false);
  });

  it("filtres des familles", () => {
    expect(labTabTypes(types(), 4)).toEqual([0, 9, 68, 43, 59, 63, 87, 28, 44]);
    expect(labTabTypes(types(), 8)).toEqual(expect.arrayContaining([148, 91, 92, 93, 94, 95, 96]));
    expect(labTabTypes(types(), 11).sort((a, b) => a - b)).toEqual([2, 99, 100, 101, 102, 126]);
    expect(labTabTypes(types(), 2)).not.toContain(8);
    expect(labTabTypes(types(), 3)).toEqual(expect.arrayContaining([10, 76, 77, 37]));
    for (const t of labTabTypes(types(), 9)) expect(types().get(t).flags14 & 0x400).toBe(0x400);
    for (const t of labTabTypes(types(), 6)) expect(types().get(t).flags14 & 3).not.toBe(0);
  });

  it("pièces des fêtes : seulement le jour venu (31 octobre, 14 février, 25 décembre, 17 mars)", () => {
    for (const [t, d] of HOLIDAY_TYPES) {
      expect(inLabTab(types(), t, 0, { date: new Date(2026, d.month - 1, d.day) }), `type ${t}`).toBe(true);
      expect(inLabTab(types(), t, 0, { date: new Date(2026, d.month - 1, d.day + 1) })).toBe(false);
      expect(inLabTab(types(), t, 0)).toBe(false);
    }
  });

  it("changer d'onglet remplace la palette du bac, une pièce par type", () => {
    const s = lab();
    s.editor.stockLab(Editor.labTypes(s.world, 4));
    expect(s.editor.binParts().map((p) => p.type).sort((a, b) => a - b)).toEqual([0, 9, 28, 43, 44, 59, 63, 68, 87]);
    s.editor.stockLab(Editor.labTypes(s.world, SCENERY_TAB));
    expect(s.editor.binParts().every((p) => p.flags14 & 0x1000)).toBe(true);
  });
});

describe.skipIf(!original.has)("Labo : puzzle maison (LabPuzzle)", () => {
  it("conditions : posées, remplacées, retirées ; 8 au plus ; choix de SOLVE.ITF", () => {
    const s = lab();
    const parts = Array.from({ length: 9 }, (_, i) => place(s, 0, 30 + i * 60, 100));
    const p = s.labPuzzle!;
    const top = { state1: 0, state2: 0, count: 0, rectX: OFF_TOP.x, rectY: OFF_TOP.y, rectWidth: OFF_TOP.width, rectHeight: OFF_TOP.height };
    for (let i = 0; i < MAX_CONDITIONS; i++) expect(p.setCondition(parts[i]!, top)).toBe(true);
    expect(p.setCondition(parts[8]!, top)).toBe(false);
    expect(p.setCondition(parts[0]!, { ...top, rectY: OFF_BOTTOM.y, rectHeight: OFF_BOTTOM.height })).toBe(true);
    expect(conditionKind(p.conditionOf(parts[0]!)!)).toBe("bottom");
    expect(conditionKind(p.conditionOf(parts[1]!)!)).toBe("top");
    expect(conditionKind({ rectX: OFF_SCREEN.x, rectY: -1, rectWidth: -1, rectHeight: -1 })).toBe("offscreen");
    expect(conditionKind({ rectX: 10, rectY: 10, rectWidth: 50, rectHeight: 40 })).toBe("position");
    expect(conditionKind({ rectX: 0, rectY: 0, rectWidth: 0, rectHeight: 0 })).toBe("state");
    p.delay = 40;
    for (const q of parts) p.setCondition(q, null);
    expect([p.hasGoal, p.delay]).toEqual([false, 0]);
  });

  it("une pièce retirée perd sa condition ; le bloc solution du LEV range les pièces par index", () => {
    const s = lab();
    const a = place(s, 0, 100, 100);
    const b = place(s, 9, 300, 100);
    const p = s.labPuzzle!;
    p.setCondition(a, { state1: 0, state2: 0, count: 0, rectX: 1, rectY: 2, rectWidth: 3, rectHeight: 4 });
    p.setCondition(b, { state1: 0, state2: 0, count: 2, rectX: -1, rectY: -1, rectWidth: -1, rectHeight: -1 });
    p.delay = 12;
    const order = [b, a];
    const sol = p.solution((q) => order.indexOf(q));
    expect(sol.conditions.slice(0, 3).map((c) => c.partIndex)).toEqual([1, 0, -1]);
    expect([sol.unknown00, sol.delay, sol.conditions.length]).toEqual([1, 12, 8]);
    s.editor.removeToBin(a);
    p.prune(s.world);
    expect(p.conditions.map((c) => c.part)).toEqual([b]);
  });

  it("indices : 8 emplacements, main tournée 0 → 1 → 3 → 2 → 0, gardée dans l'aire, effacée", () => {
    const p = new LabPuzzle();
    for (let i = 0; i < 8; i++) expect(p.addHint(10 * i, 20, `indice ${i}`)).toBe(i);
    expect(p.addHint(0, 0, "neuvième")).toBe(-1);
    expect(p.addHint(0, 0, "")).toBe(-1);
    const flips: number[] = [];
    for (let i = 0; i < 4; i++) {
      p.flipHint(2);
      flips.push(p.hints[2]!.flip!);
    }
    expect(flips).toEqual([1, 3, 2, 0]);
    p.moveHint(3, 600, -5, 568, 378);
    expect([p.hints[3]!.x, p.hints[3]!.y]).toEqual([568 - 44, 0]);
    p.removeHint(1);
    expect(p.hintSlots()).toEqual([0, 2, 3, 4, 5, 6, 7]);
    expect(p.addHint(5, 5, "de nouveau")).toBe(1);
    p.removeHint(4);
    const lev = p.levHints();
    expect([lev.hintCount, lev.hints.length, lev.hints[7]!.text]).toEqual([7, 8, ""]);
  });

  it("plages d'états de SOLVE.RES (429cb8) et variante de la pièce (429ef4)", () => {
    const states = [0, 1, 6, 10];
    const first = (n: number): number => (n === -1 ? 20 : (states[n] ?? 0));
    expect(rangeFrames({ from: 1, to: 2, explodes: false, suffix: "" }, first)).toEqual({ state1: 1, state2: 5 });
    expect(rangeFrames({ from: 3, to: -1, explodes: false, suffix: "" }, first)).toEqual({ state1: 10, state2: 19 });
    const range = (from: number, to: number) => ({ from, to, explodes: false, suffix: "" });
    // 429ef4 : la plage dont la première image est celle de la pièce (pas celle qui la contient).
    const solve = { type: 4, name: "Ballon", states: [{ label: "Intact", ranges: [range(1, 2), range(2, 3)] }] };
    expect(solveVariant(solve, 1, first)).toBe(0);
    expect(solveVariant(solve, 6, first)).toBe(1);
    expect(solveVariant(solve, 7, first)).toBe(0);
    // Ligne qui commence par 0 (452b80 rend 0) : variante 0 sans chercher, sauf une ligne `@`.
    expect(solveVariant({ ...solve, states: [{ label: "x", ranges: [range(0, 1), range(2, 3)] }] }, 6, first)).toBe(0);
    expect(solveVariant({ type: 0, name: "Boule", position: [range(0, 1), range(2, 3)], states: [] }, 6, first)).toBe(1);
  });
});

describe.skipIf(!original.has)("Labo : but vérifié en marche (419803), conditions suivies après « Arrêter »", () => {
  it("une balle qui tombe hors de l'écran par le bas : le Labo le dit ; Arrêter garde la condition sur la pièce rendue", () => {
    const s = lab();
    const ball = place(s, 0, 280, 40);
    s.labPuzzle!.setCondition(ball, { state1: 0, state2: 0, count: 0, rectX: OFF_BOTTOM.x, rectY: OFF_BOTTOM.y, rectWidth: OFF_BOTTOM.width, rectHeight: OFF_BOTTOM.height });
    s.start();
    let solved = false;
    for (let i = 0; i < 400 && !solved; i++) solved = s.tick().solved;
    expect(solved).toBe(true);
    expect(s.running).toBe(false);
    const back = [...s.world.mobiles][0]!;
    expect(back).not.toBe(ball);
    expect([back.type, back.px, back.py]).toEqual([0, ball.editX, ball.editY]);
    expect(s.labPuzzle!.conditionOf(back)).not.toBeNull();
  });

  it("sans condition, le Labo ne vérifie rien", () => {
    const s = lab();
    place(s, 0, 280, 40);
    s.start();
    for (let i = 0; i < 300; i++) expect(s.tick()).toEqual({ goal: 0, solved: false });
  });
});

describe.skipIf(!original.has)("Labo : la condition suit la pièce retournée (429d84)", () => {
  const index = frenchIndex();
  const assets = new RenderAssets(index);
  const solveParts = readSolveRes(index.get("SOLVE.RES"));
  const firstOf = (type: number) => {
    const anm = assets.partAnm(type)!;
    return (n: number): number => (n === -1 ? imageCount(anm) : Math.max(0, stateImage(anm, n)));
  };
  const CANNON = 18;

  it("canon (6 directions) : « N'a pas tiré » et « A tiré » passent à la plage de la nouvelle direction", () => {
    const s = lab();
    const lab_ = s.labPuzzle!;
    const first = firstOf(CANNON);
    const solve = solveParts[CANNON]!;
    const cannon = place(s, CANNON, 250, 200);
    expect(solveVariant(solve, cannon.frame, first)).toBe(0);
    const notFired = rangeFrames(solve.states[0]!.ranges[0]!, first);
    lab_.setCondition(cannon, { ...notFired, count: 0, rectX: 0, rectY: 0, rectWidth: 0, rectHeight: 0 });
    expect(s.editor.flip(cannon, "turn")).toBe(true);
    const variant = solveVariant(solve, cannon.frame, first);
    expect(variant).toBe(1);
    expect(lab_.followVariant(cannon, solve, first)).toBe(true);
    expect(lab_.conditionOf(cannon)).toMatchObject(rangeFrames(solve.states[0]!.ranges[1]!, first));
    expect(lab_.followVariant(cannon, solve, first)).toBe(false);
    // Second état (ligne 3 après le nom) : il reste le second état.
    lab_.setCondition(cannon, { ...rangeFrames(solve.states[1]!.ranges[1]!, first), count: 2, rectX: 0, rectY: 0, rectWidth: 0, rectHeight: 0 });
    s.editor.flip(cannon, "turn");
    const v2 = solveVariant(solve, cannon.frame, first);
    expect(v2).not.toBe(1);
    expect(lab_.followVariant(cannon, solve, first)).toBe(true);
    expect(lab_.conditionOf(cannon)).toMatchObject({ ...rangeFrames(solve.states[1]!.ranges[v2]!, first), count: 2 });
  });

  it("le rectangle ne change pas ; une condition sans plage reconnue reste telle quelle ; pas de condition, rien", () => {
    const s = lab();
    const lab_ = s.labPuzzle!;
    const first = firstOf(CANNON);
    const solve = solveParts[CANNON]!;
    const cannon = place(s, CANNON, 250, 200);
    expect(lab_.followVariant(cannon, solve, first)).toBe(false);
    const top = { state1: 0, state2: 0, count: 0, rectX: OFF_TOP.x, rectY: OFF_TOP.y, rectWidth: OFF_TOP.width, rectHeight: OFF_TOP.height };
    lab_.setCondition(cannon, top);
    s.editor.flip(cannon, "turn");
    // L'état 1 de la condition (0) est la première image de la plage 0 : elle suit, mais reste « par le haut ».
    lab_.followVariant(cannon, solve, first);
    expect(conditionKind(lab_.conditionOf(cannon)!)).toBe("top");
    expect(lab_.conditionOf(cannon)).toMatchObject({ rectX: OFF_TOP.x, rectY: OFF_TOP.y, rectWidth: OFF_TOP.width, rectHeight: OFF_TOP.height });
    lab_.setCondition(cannon, { ...top, state1: 9999, state2: 9999 });
    expect(lab_.followVariant(cannon, solve, first)).toBe(false);
    expect(lab_.conditionOf(cannon)).toMatchObject({ state1: 9999, state2: 9999 });
    expect(lab_.followVariant(cannon, null, first)).toBe(false);
  });
});
