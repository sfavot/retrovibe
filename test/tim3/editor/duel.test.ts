import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryStorage, prefixedStorage } from "../../../src/engine/storage";
import { readLev, type Level } from "../../../src/games/tim3/data/lev";
import { parseLines } from "../../../src/games/tim3/data/text";
import {
  DUEL_GAMES,
  DUEL_TIME,
  Duel,
  DuelTurn,
  TURN_BACKGROUND,
  clockDigits,
  defaultDuelSettings,
  nextDuelPuzzle,
  stepGames,
  stepTime,
  timeDigits,
  type DuelSettings,
} from "../../../src/games/tim3/engine/duel";
import { Part } from "../../../src/games/tim3/engine/part";
import { parseProgramRows, type ProgramRow } from "../../../src/games/tim3/engine/program";
import { DUEL_CATEGORY, Progress, Tim3Session, duelPuzzleList, puzzleList, type PuzzleRef } from "../../../src/games/tim3/engine/session";
import { baseIndex, original } from "../data/real";
import { realTypes } from "../engine/helpers";
import type { Placement, Solution } from "../solutions/apply";
import { plugOrder, replay } from "./replay";

const settings = (games = 3, times: [number, number] = [45_000, 45_000]): DuelSettings => ({ games, times, names: ["Ana", "Bob"] });
const part = (type = 1): Part => Object.assign(new Part(), { type });

describe("deux joueurs : réglages de HEDTOHED (41d15c, 41d4be)", () => {
  it("parties 1 à 9 de 2 en 2, 3 au départ ; durées 10 à 90 s de 5 en 5, 45 s au départ ; noms de 10 caractères", () => {
    const d = defaultDuelSettings(["Joueur 1", "Un nom bien trop long"]);
    expect(d).toEqual({ games: 3, times: [45_000, 45_000], names: ["Joueur 1", "Un nom bie"] });
    expect(stepGames(DUEL_GAMES.initial, 1)).toBe(5);
    expect(stepGames(9, 1)).toBe(9);
    expect(stepGames(1, -1)).toBe(1);
    expect(stepGames(3, -1)).toBe(1);
    expect(stepTime(DUEL_TIME.initial, 1)).toBe(50_000);
    expect(stepTime(90_000, 1)).toBe(90_000);
    expect(stepTime(10_000, -1)).toBe(10_000);
    expect(timeDigits(45_000)).toEqual([4, 5]);
    expect(clockDigits(37_450)).toEqual([3, 7, 4]);
    expect(clockDigits(-5)).toEqual([0, 0, 0]);
  });
});

describe("deux joueurs : règle du tour (417190, 41715f, 42ebba, 4301cb, 43013e)", () => {
  it("une pièce du bac par tour : prise puis rendue, le bac reste ouvert ; posée, il se ferme", () => {
    const t = new DuelTurn();
    const a = part();
    const b = part();
    t.taken(a);
    t.returned(a);
    expect(t.mayTakeFromBin()).toBe(true);
    t.taken(b);
    t.placed(b);
    expect(t.mayTakeFromBin()).toBe(false);
    expect(t.binPlaced).toBe(b);
  });

  it("une pièce de l'aire par tour ; la pièce du bac posée ce tour reste modifiable, et le partenaire d'une télécommande", () => {
    const t = new DuelTurn();
    const [x, y, placed] = [part(), part(), part()];
    expect(t.mayTouch(x) && t.mayTouch(y)).toBe(true);
    t.touched(x);
    expect(t.mayTouch(x)).toBe(true);
    expect(t.mayTouch(y)).toBe(false);
    t.taken(placed);
    t.placed(placed);
    t.touched(placed);
    expect(t.fieldTouched).toBe(x);
    expect(t.mayTouch(placed)).toBe(true);
    const remote = part(0x16);
    const bomb = part(0x37);
    remote.links[1] = bomb;
    bomb.links[1] = remote;
    const u = new DuelTurn();
    u.taken(remote);
    u.placed(remote);
    u.touched(y);
    expect(u.mayTouch(bomb)).toBe(true);
    u.reset();
    expect(u.mayTakeFromBin() && u.mayTouch(x)).toBe(true);
  });

  it("les références suivent la copie de l'état d'édition (Arrêter)", () => {
    const t = new DuelTurn();
    const [a, b, a2, b2] = [part(), part(), part(), part()];
    t.taken(a);
    t.placed(a);
    t.touched(b);
    t.remap(new Map([[a, a2], [b, b2]]));
    expect(t.binPlaced).toBe(a2);
    expect(t.fieldTouched).toBe(b2);
  });
});

describe("deux joueurs : chronomètre et manches (4330d0, 419803, 41d827)", () => {
  it("le temps ne court qu'une fois le tour commencé ; « Terminer le Tour » ; le tour passe, fond du joueur", () => {
    const d = new Duel(settings(3, [20_000, 30_000]));
    d.prepareTurn();
    d.advance(5_000);
    expect(d.remaining).toBe(20_000);
    d.startTurn();
    d.advance(19_000);
    expect(d.expired).toBe(false);
    d.advance(5_000);
    expect(d.remaining).toBe(0);
    expect(d.expired).toBe(true);
    d.switchTurn();
    expect([d.turn, d.remaining, d.started, d.expired]).toEqual([1, 30_000, false, false]);
    d.startTurn();
    d.endTurnNow();
    expect(d.expired).toBe(true);
    expect(TURN_BACKGROUND).toEqual([12, 9]);
  });

  it("au meilleur des 3 : manche, égalité (2155), balle de match (2154), match", () => {
    const d = new Duel(settings(3));
    expect(d.solved()).toEqual({ kind: "matchPoint", winner: 0, leader: 0 });
    d.turn = 1;
    expect(d.solved()).toEqual({ kind: "matchPoint", winner: 1, leader: null });
    expect(d.solved()).toEqual({ kind: "match", winner: 1 });
    expect(d.wins).toEqual([1, 2]);
    expect(d.over).toBe(true);
  });

  it("au meilleur des 5 : manches simples puis balle de match de celui qui mène ; une seule partie : match tout de suite", () => {
    const d = new Duel(settings(5));
    expect(d.solved()).toEqual({ kind: "game", winner: 0 });
    d.turn = 1;
    expect(d.solved()).toEqual({ kind: "game", winner: 1 });
    expect(d.solved()).toEqual({ kind: "matchPoint", winner: 1, leader: 1 });
    expect(d.turn).toBe(1);
    const one = new Duel(settings(1));
    one.turn = 1;
    expect(one.solved()).toEqual({ kind: "match", winner: 1 });
  });
});

describe("deux joueurs : puzzles (42cbad(5))", () => {
  const list = duelPuzzleList();

  it("50 puzzles HH, catégorie 5, index 156 à 205 ; la progression les note", () => {
    expect(list).toHaveLength(50);
    expect(list[0]).toEqual({ name: "HH1", index: 156, category: DUEL_CATEGORY, number: 1 });
    expect(list[49]).toMatchObject({ name: "HH50", index: 205 });
    expect(puzzleList()).toHaveLength(156);
    const p = new Progress(prefixedStorage(new MemoryStorage(), "tim3:"));
    p.markSolved("HH3");
    expect(p.isSolved("HH3")).toBe(true);
    p.last = "HH3";
    expect(p.last).toBeNull();
  });

  it("le premier non résolu à partir du puzzle en cours (le premier HH hors du mode), puis depuis le début ; tous résolus : au hasard, un autre", () => {
    const solved = new Set(["HH1", "HH2", "HH5"]);
    const isSolved = (n: string) => solved.has(n);
    const never = () => {
      throw new Error("pas de hasard");
    };
    expect(nextDuelPuzzle(list, null, isSolved, never).name).toBe("HH3");
    expect(nextDuelPuzzle(list, puzzleList()[3]!, isSolved, never).name).toBe("HH3");
    expect(nextDuelPuzzle(list, list[4]!, isSolved, never).name).toBe("HH6");
    const most = (n: string) => n !== "HH2";
    expect(nextDuelPuzzle(list, list[30]!, most, never).name).toBe("HH2");
    const draws = [30, 80, 7];
    expect(nextDuelPuzzle(list, list[30]!, () => true, () => draws.shift()!).name).toBe("HH8");
  });
});

// ------------------------------------------------------------------ sur les données d'origine

const DIR = resolve(import.meta.dirname, "../solutions");
const solution = (name: string) => JSON.parse(readFileSync(resolve(DIR, `${name}.json`), "utf8")) as Solution;
let rows: ProgramRow[] | undefined;
const programs = (): ProgramRow[] => (rows ??= parseProgramRows(parseLines(baseIndex().get("PROGPART.RES"))));

/** Les poses d'une solution, une par tour : une pièce du bac (avec le partenaire neuf d'une télécommande ou d'explosifs). */
function turns(s: Solution): Placement[][] {
  const order = plugOrder(s.parts);
  const out: Placement[][] = [];
  while (order.length) {
    const a = order.shift()!;
    const group = [a];
    if (a.pair !== undefined) {
      const i = order.findIndex((b) => b.part === a.pair);
      if (i >= 0) group.push(...order.splice(i, 1));
    }
    out.push(group);
  }
  return out;
}

/** Une manche jouée à deux par l'API de l'éditeur : chaque tour pose une pièce, vérifie que le bac se ferme, puis passe la main. */
function playGame(duel: Duel, ref: PuzzleRef): { session: Tim3Session; level: Level; problems: string[]; steps: number } {
  const s = solution(ref.name);
  const level = readLev(baseIndex().get(`${ref.name}.LEV`));
  const session = new Tim3Session(realTypes(), level, { puzzle: ref, guard: duel.round });
  const problems: string[] = [];
  duel.prepareTurn();
  duel.startTurn();
  const groups = turns(s);
  groups.forEach((group, i) => {
    problems.push(...replay(session, level, { ...s, parts: group }, programs()).map((p) => `tour ${i + 1} : ${p}`));
    // 418207 : le bac est fermé jusqu'au tour suivant.
    const other = session.editor.binParts()[0];
    if (other && session.editor.takeFromBin(other)) problems.push(`tour ${i + 1} : le bac a donné une seconde pièce`);
    if (i < groups.length - 1) {
      duel.advance(duel.remaining);
      expect(duel.expired).toBe(true);
      session.editor.dropHeld();
      duel.switchTurn();
      duel.startTurn();
    }
  });
  session.start();
  let steps = 0;
  for (let k = 1; k <= s.goalStep + 40; k++) {
    duel.advance(32);
    if (session.tick().solved) {
      steps = k;
      break;
    }
  }
  return { session, level, problems, steps };
}

describe.skipIf(!original.has)("deux joueurs : un match complet par l'éditeur (HH23, HH27, solutions du concepteur)", () => {
  it("au meilleur des 3 : Ana gagne HH23, Bob HH27 (égalité), puis Bob gagne HH23 tiré au hasard et le match", () => {
    const list = duelPuzzleList();
    const progress = new Progress(prefixedStorage(new MemoryStorage(), "tim3:"));
    for (const p of list) if (p.name !== "HH23" && p.name !== "HH27") progress.markSolved(p.name);
    const duel = new Duel(settings(3));
    const solved = (n: string) => progress.isSolved(n);

    // Manche 1 : HH23, 9 tours (Ana pose la dernière pièce et lance la machine).
    const first = nextDuelPuzzle(list, puzzleList()[0]!, solved, Math.random);
    expect(first.name).toBe("HH23");
    const g1 = playGame(duel, first);
    expect(g1.problems).toEqual([]);
    expect(g1.steps).toBe(solution("HH23").goalStep + 30);
    expect(duel.turn).toBe(0);
    expect(duel.solved()).toEqual({ kind: "matchPoint", winner: 0, leader: 0 });
    progress.markSolved(first.name);

    // Manche 2 : HH27, Ana commence (vainqueur de la manche) ; 14 tours, Bob pose la dernière pièce.
    const second = nextDuelPuzzle(list, first, solved, Math.random);
    expect(second.name).toBe("HH27");
    const g2 = playGame(duel, second);
    expect(g2.problems).toEqual([]);
    expect(g2.steps).toBeGreaterThan(0);
    expect(duel.turn).toBe(1);
    expect(duel.solved()).toEqual({ kind: "matchPoint", winner: 1, leader: null });
    progress.markSolved(second.name);

    // Manche 3 : tout est résolu, le hasard (4520a4) donne HH23 ; Bob commence et gagne le match.
    const third = nextDuelPuzzle(list, second, solved, () => 22);
    expect(third.name).toBe("HH23");
    const g3 = playGame(duel, third);
    expect(g3.problems).toEqual([]);
    expect(duel.turn).toBe(1);
    expect(duel.solved()).toEqual({ kind: "match", winner: 1 });
    expect(duel.wins).toEqual([1, 2]);
  });

  it("une pièce de l'aire déjà posée par l'autre joueur : une seule se modifie par tour ; Arrêter garde la règle du tour", () => {
    const ref = duelPuzzleList().find((p) => p.name === "HH23")!;
    const s = solution(ref.name);
    const level = readLev(baseIndex().get(`${ref.name}.LEV`));
    const duel = new Duel(settings(3));
    const session = new Tim3Session(realTypes(), level, { puzzle: ref, guard: duel.round });
    duel.prepareTurn();
    duel.startTurn();
    const [a, b] = turns(s);
    expect(replay(session, level, { ...s, parts: a! }, programs())).toEqual([]);
    const next = session.editor.binParts().find((x) => x.levIndex === b![0]!.part)!;
    expect(session.editor.takeFromBin(next)).toBe(false);
    expect(session.editor.held).toBeNull();
    // Tour suivant : le bac se rouvre ; puis, deux pièces posées, une seule se modifie par tour.
    duel.switchTurn();
    duel.startTurn();
    expect(replay(session, level, { ...s, parts: b! }, programs())).toEqual([]);
    duel.switchTurn();
    duel.startTurn();
    const ed = session.editor;
    const [p, q] = [...session.world.staticThenMobile()].filter((x) => x.levIndex === a![0]!.part || x.levIndex === b![0]!.part);
    expect(ed.mayTouch(p!) && ed.mayTouch(q!)).toBe(true);
    expect(ed.flip(p!, "x") || ed.resize(p!, 1) || (ed.removeToBin(p!), true)).toBe(true);
    expect(ed.mayTouch(q!)).toBe(false);
    expect(ed.flip(q!, "x")).toBe(false);
    ed.removeToBin(q!);
    expect([...session.world.staticThenMobile()]).toContain(q);
    // Démarrer puis Arrêter : les pièces sont des copies, la règle les suit.
    session.start();
    session.tick();
    session.stop();
    const q2 = [...session.world.staticThenMobile()].find((x) => x.levIndex === q!.levIndex)!;
    expect(q2).not.toBe(q);
    expect(session.editor.mayTouch(q2)).toBe(false);
  });

  it("temps écoulé pièce en main (4301f5) : posée si elle tient là où elle est, sinon rendue au bac ; une corde retourne au bac", () => {
    const ref = duelPuzzleList().find((p) => p.name === "HH23")!;
    const level = readLev(baseIndex().get(`${ref.name}.LEV`));
    const duel = new Duel(settings(3));
    const session = new Tim3Session(realTypes(), level, { puzzle: ref, guard: duel.round });
    duel.prepareTurn();
    duel.startTurn();
    const ed = session.editor;
    const rope = ed.binParts().find((x) => x.type === 10)!;
    ed.takeFromBin(rope);
    expect(ed.dropHeld()).toBe("returned");
    expect(ed.mayTakeFromBin()).toBe(true);
    const box = ed.binParts().find((x) => x.levIndex === 2)!;
    ed.takeFromBin(box);
    expect(ed.dropHeld()).toBe("returned");
    ed.takeFromBin(box);
    ed.hover(300, 300);
    expect(ed.dropHeld()).toBe("placed");
    expect(ed.mayTakeFromBin()).toBe(false);
  });
});
