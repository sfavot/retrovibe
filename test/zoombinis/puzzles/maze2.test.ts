import { describe, expect, it } from "vitest";
import { MohawkArchive } from "../../../src/data/mohawk/mohawk";
import { MsvcRandom } from "../../../src/engine/mohawk/rng";
import { TAG_REGS } from "../../../src/games/zoombinis/data/archives";
import { parseRegs } from "../../../src/games/zoombinis/data/regs";
import {
  MAZE2_CLIFF_RECTS,
  MAZE2_EXITS,
  MAZE2_MAX_FLIGHTS,
  MAZE2_RAMPS,
  Maze2Kind,
  type Maze2Generator,
  type Maze2Map,
  type Maze2Record,
  advanceMaze2,
  buildMaze2World,
  chooseMaze2Map,
  cloneMaze2,
  generateTraits,
  launchMaze2,
  maze2CellPosition,
  maze2Idle,
  maze2LaunchPosition,
  maze2Level,
  maze2MemberState,
  maze2Outcome,
  maze2ZoombiniPosition,
  newMaze2Rotation,
  parseMaze2Map,
  pickSpriteBases,
  planMaze2,
  readMaze2Maps,
  replayMaze2,
  setupMaze2,
  settleMaze2,
  traitAttr,
  traitIndex,
  traitValue,
} from "../../../src/games/zoombinis/game/puzzles/maze2";
import type { Attrs } from "../../../src/games/zoombinis/game/state";
import { originalFiles } from "../../support/original";

const original = originalFiles("zoombinis", "files.json");

const BASES = [0, 31, 52, 73, 94, 115, 136, 157, 178];

function rec(kind: number, row: number, col: number, o: { type?: number; dirs?: number[]; dir?: number; rotates?: boolean } = {}): Maze2Record {
  return { kind, row, col, type: o.type ?? 1, dirs: o.dirs ?? [0, 0, 0, 0], dir: o.dir ?? 0, rotates: o.rotates ?? false };
}

function mapOf(ramps: number[], records: Maze2Record[]): Maze2Map {
  return { index: 0, ramps, records };
}

function worldOf(map: Maze2Map, team: Attrs[], traits: number[] = []) {
  return buildMaze2World({ map, level: 0, generator: "67d3", traits, spriteBases: BASES, team });
}

/** Cases visées successives d'un Zoombini, relevées image par image. */
function trail(w: ReturnType<typeof worldOf>, id: number, limit = 4000): string[] {
  const out: string[] = [];
  for (let i = 0; i < limit && !maze2Idle(w); i++) {
    advanceMaze2(w);
    const f = w.flights.find((x) => x.id === id);
    if (f && f.state !== "lead") {
      const at = `${f.targetRow},${f.targetCol}`;
      if (out[out.length - 1] !== at) out.push(at);
    }
  }
  return out;
}

/** Vecteurs produits par un émulateur x86-16 du désassemblage de `1118:5206`…`1118:7acf` (hors dépôt), pas par ce module : traits écrits en `S14:07a8` et état final du hasard. */
const ORIGINAL_VECTORS: { gen: Maze2Generator; level: number; slot: number; seed: number; team: Attrs[]; traits: number[]; rng: number }[] = [
  { gen: "67d3", level: 0, slot: 0, seed: 123456, team: [[3, 3, 2, 2], [2, 1, 3, 4], [5, 5, 2, 2], [5, 5, 1, 3], [1, 4, 2, 2], [5, 4, 2, 3], [3, 1, 1, 5], [3, 5, 4, 2], [2, 2, 1, 1], [2, 5, 4, 5], [5, 1, 1, 2], [3, 1, 1, 5], [4, 1, 5, 1], [3, 4, 5, 1], [3, 5, 1, 4], [5, 5, 5, 2]], traits: [5, 5, 2, 3], rng: 123456 },
  { gen: "67d3", level: 0, slot: 1, seed: 42, team: [[2, 5, 4, 4], [2, 4, 1, 1], [1, 4, 1, 3], [4, 1, 3, 5], [5, 4, 1, 4], [1, 2, 3, 5], [1, 1, 4, 3]], traits: [1, 1, 4, 2], rng: 42 },
  { gen: "6b4d", level: 1, slot: 0, seed: 2024, team: [[4, 5, 1, 1], [4, 2, 1, 1], [2, 1, 4, 1], [4, 4, 1, 2], [2, 3, 2, 1], [2, 2, 2, 1], [1, 2, 5, 4], [5, 5, 4, 4], [5, 3, 5, 1], [4, 5, 4, 3], [5, 3, 3, 4], [2, 1, 5, 4]], traits: [2, 2, 2, 5, 4], rng: 2024 },
  { gen: "6f02", level: 1, slot: 1, seed: 99, team: [[1, 1, 1, 2], [1, 1, 1, 5], [2, 1, 4, 2], [1, 4, 3, 4], [4, 5, 4, 2], [4, 3, 3, 1], [5, 3, 3, 2], [3, 3, 4, 5], [4, 5, 5, 4], [3, 4, 5, 3], [1, 3, 1, 2], [2, 3, 1, 2], [5, 5, 5, 5], [5, 1, 5, 1], [5, 1, 2, 3], [2, 3, 1, 5]], traits: [6, 6, 20, 20, 18, 16, 10, 8], rng: 99 },
  { gen: "6f02", level: 2, slot: 0, seed: 31337, team: [[5, 5, 4, 1], [3, 1, 3, 4], [5, 1, 1, 4], [2, 4, 4, 5], [1, 4, 1, 1], [1, 4, 2, 1], [3, 5, 3, 2], [5, 1, 1, 1], [5, 4, 5, 1]], traits: [16, 16, 15, 14, 12, 2, 3], rng: 31337 },
  { gen: "7532", level: 2, slot: 1, seed: 555, team: [[2, 4, 2, 5], [5, 3, 3, 4], [2, 2, 4, 5], [4, 5, 4, 5], [2, 4, 1, 2], [5, 3, 3, 3], [4, 2, 5, 5], [3, 2, 3, 3], [2, 2, 3, 2], [3, 5, 4, 3], [3, 4, 2, 1], [4, 5, 1, 3], [3, 2, 1, 3], [5, 4, 4, 5]], traits: [2, 2, 19, 19, 14, 20, 16, 18], rng: 555 },
  { gen: "7acf", level: 3, slot: 0, seed: 8, team: [[5, 5, 4, 4], [1, 4, 5, 3], [4, 4, 4, 2], [4, 4, 5, 4], [5, 3, 1, 5], [3, 3, 4, 5], [4, 5, 1, 5], [1, 4, 3, 3], [3, 5, 1, 3], [3, 2, 1, 4], [2, 2, 1, 4], [5, 3, 3, 3], [1, 3, 2, 2], [3, 4, 1, 4], [5, 1, 5, 4], [2, 2, 5, 1]], traits: [16, 12, 17, 2, 6, 16, 16, 12, 6], rng: 2180067921 },
  { gen: "7acf", level: 3, slot: 2, seed: 1996, team: [[4, 1, 5, 4], [1, 1, 1, 1], [3, 4, 4, 3], [4, 5, 1, 2], [5, 3, 5, 2], [5, 1, 5, 2]], traits: [19, 18, 16, 6, 11, 7, 7, 9, 20], rng: 3962263632 },
  { gen: "7532", level: 4, slot: 0, seed: 77, team: [[2, 5, 2, 3], [3, 3, 1, 5], [5, 1, 5, 2], [3, 4, 4, 2]], traits: [17, 17, 20, 20, 1, 7, 6, 2], rng: 3238365024 },
  { gen: "67d3", level: 0, slot: 0, seed: 5, team: [[1, 5, 4, 4], [4, 4, 5, 4]], traits: [19, 19, 5, 5], rng: 1880463015 },
  { gen: "7acf", level: 3, slot: 0, seed: 65535, team: [[1, 2, 1, 1], [2, 1, 2, 2], [2, 2, 2, 2], [2, 1, 1, 1], [1, 1, 1, 2]], traits: [16, 7, 12, 7, 17, 15, 8, 3, 18], rng: 223983978 },
];

describe("tables et traits", () => {
  it("indexe les traits comme l'original (k = 5 × attribut + valeur)", () => {
    expect([1, 5, 6, 11, 20].map((k) => [traitAttr(k), traitValue(k)])).toEqual([[0, 1], [0, 5], [1, 1], [2, 1], [3, 5]]);
    expect(traitIndex(2, 4)).toBe(14);
    expect([traitAttr(0), traitValue(0)]).toEqual([0, 0]);
  });

  it("place chaque rampe sur la falaise dont le rectangle contient son point de dépôt, et aucune sur la falaise 3", () => {
    for (const r of MAZE2_RAMPS) {
      const [x0, y0, x1, y1] = MAZE2_CLIFF_RECTS[r.cliff]!;
      expect(r.drop.x >= x0 && r.drop.x <= x1 && r.drop.y >= y0 && r.drop.y <= y1, `rampe ${r.number}`).toBe(true);
      expect(r.cliff).not.toBe(3);
      expect(r.freeAfter).toBe(r.script === 9000 ? 34 : 35);
    }
    expect(MAZE2_RAMPS.map((r) => r.cliff)).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 2]);
    expect(MAZE2_EXITS.map((e) => e.length)).toEqual([5, 4, 4, 5]);
  });

  it("choisit niveau, carte et générateur, et fait alterner les compteurs entre deux visites", () => {
    expect([maze2Level(3, 4), maze2Level(3, 5), maze2Level(2, 1)]).toEqual([4, 3, 2]);
    const rotation = newMaze2Rotation();
    const visits = (level: number, count: number) => Array.from({ length: count }, () => chooseMaze2Map(level, rotation));
    expect(visits(0, 3).map((c) => [c.mapIndex, c.generator])).toEqual([[0, "67d3"], [1, "67d3"], [0, "67d3"]]);
    expect(visits(1, 3).map((c) => [c.mapIndex, c.generator, c.slot])).toEqual([[2, "6b4d", 0], [3, "6f02", 1], [2, "6b4d", 0]]);
    expect(visits(2, 3).map((c) => [c.mapIndex, c.generator])).toEqual([[4, "6f02"], [5, "7532"], [4, "6f02"]]);
    expect(visits(3, 3).map((c) => [c.mapIndex, c.generator])).toEqual([[6, "7acf"], [8, "7acf"], [6, "7acf"]]);
    expect(visits(4, 2).map((c) => [c.mapIndex, c.generator])).toEqual([[9, "7532"], [9, "7532"]]);
    expect(rotation).toEqual({ level0: 1, level1: 1, level2: 1, level3: 2 });
    expect(() => chooseMaze2Map(5, rotation)).toThrow();
  });

  it("tire les jeux de sprites sans remise (7 tirages dont le dernier est forcé et n'avance pas le hasard)", () => {
    const rng = new MsvcRandom(2718);
    const bases = pickSpriteBases(rng);
    expect(bases[1]).toBe(31);
    expect(bases.slice(2).sort((a, b) => a - b)).toEqual([52, 73, 94, 115, 136, 157, 178]);
    const same = new MsvcRandom(2718);
    for (const top of [6, 5, 4, 3, 2, 1, 0]) same.rand(top);
    expect(rng.current).toBe(same.current);
  });

  it("reproduit les traits et l'état du hasard de l'original sur 11 équipes (émulation du désassemblage)", () => {
    for (const v of ORIGINAL_VECTORS) {
      const rng = new MsvcRandom(v.seed);
      expect(generateTraits(rng, v.team, v.level, v.gen, v.slot), `${v.gen} niveau ${v.level}`).toEqual(v.traits);
      expect(rng.current, `${v.gen} niveau ${v.level} (hasard)`).toBe(v.rng);
    }
  });

  it("donne des traits valides, déterministes, en nombre fixe par générateur, pour des équipes de toute composition", () => {
    const counts: Record<Maze2Generator, number> = { "67d3": 4, "6b4d": 5, "6f02": 8, "7532": 8, "7acf": 9 };
    const draw = new MsvcRandom(31);
    for (const gen of Object.keys(counts) as Maze2Generator[]) {
      for (let trial = 0; trial < 60; trial++) {
        const size = 1 + draw.rand(15);
        const team = Array.from({ length: size }, () => [1 + draw.rand(4), 1 + draw.rand(4), 1 + draw.rand(4), 1 + draw.rand(4)] as Attrs);
        const level = gen === "6f02" ? 1 : gen === "7acf" ? 3 : gen === "7532" ? 2 : 0;
        const a = generateTraits(new MsvcRandom(trial), team, level, gen, 0);
        expect(a).toEqual(generateTraits(new MsvcRandom(trial), team, level, gen, 0));
        expect(a).toHaveLength(counts[gen]);
        for (const k of a) expect(k >= 0 && k <= 20).toBe(true);
      }
    }
    // `6f02` au niveau 2 ne double pas un panneau : 7 traits.
    expect(generateTraits(new MsvcRandom(1), ORIGINAL_VECTORS[4]!.team, 2, "6f02", 0)).toHaveLength(7);
  });
});

describe("simulation d'un lancer (cartes synthétiques)", () => {
  /** Rampe 4 (case de départ (4,10), direction 1) : descente de la colonne 10, flèche en (10,10) vers l'ouest, sortie 3 en (10,2). */
  const straight = [rec(Maze2Kind.arrow, 10, 10, { dirs: [1, 0, 0, 0], dir: 0 })];

  it("mène un Zoombini à la falaise 3 : « Go » s'active, la rampe se libère, le Zoombini est sauvé", () => {
    const w = worldOf(mapOf([4], straight), [[1, 1, 1, 1], [2, 2, 2, 2]]);
    expect(launchMaze2(w, 1, 4)).toEqual({ ok: true });
    expect(w.flights[0]).toMatchObject({ row: 4, col: 10, targetRow: 4, targetCol: 10, dir: 1, state: "lead", hop: true });
    expect(launchMaze2(w, 2, 4)).toEqual({ ok: false, reason: "busy" });
    expect(launchMaze2(w, 1, 4)).toEqual({ ok: false, reason: "airborne" });
    expect(launchMaze2(w, 2, 5)).toEqual({ ok: false, reason: "ramp" });
    expect(launchMaze2(w, 9, 4)).toEqual({ ok: false, reason: "unknown" });
    expect(maze2Outcome(w).goActive).toBe(false);
    expect(settleMaze2(w)).toBe(true);
    expect(maze2MemberState(w, 1)).toBe("saved");
    expect(maze2Outcome(w)).toEqual({ saved: [1], lost: [2], goActive: true, allSaved: false });
    expect(w.members[0]!.cliff).toBe(3);
    expect(w.launched).toEqual([]);
    // la rampe est libre : le second part à son tour
    expect(launchMaze2(w, 2, 4)).toEqual({ ok: true });
    settleMaze2(w);
    expect(maze2Outcome(w).allSaved).toBe(true);
    expect(w.goalArrivals).toBe(2);
  });

  it("suit les cases une à une : bond de la rampe, six images par case, premier pas à l'image 30 du script de rampe", () => {
    const w = worldOf(mapOf([4], straight), [[1, 1, 1, 1]]);
    launchMaze2(w, 1, 4);
    advanceMaze2(w, 30);
    expect(w.flights[0]!.state).toBe("lead");
    advanceMaze2(w, 1);
    expect(w.flights[0]!.state).toBe("step");
    // le bond de 1 image finit dans la case de départ (4,10), traitée comme une case ordinaire, puis un pas de 6 images par case
    expect(trail(w, 1).slice(0, 8)).toEqual(["5,10", "6,10", "7,10", "8,10", "9,10", "10,10", "10,9", "10,8"]);
  });

  it("applique un panneau selon le trait du Zoombini et envoie les autres tout droit", () => {
    const west = rec(Maze2Kind.panel, 6, 10, { dirs: [1, 0, 0, 0], dir: 0 });
    const whirl = rec(Maze2Kind.whirl, 6, 5, { type: 0 });
    const w = worldOf(mapOf([4], [...straight, west, whirl]), [[2, 1, 1, 1], [3, 1, 1, 1]], [traitIndex(0, 2)]);
    expect(w.cells.find((c) => c.kind === Maze2Kind.panel)!.panel).toEqual({ attr: 0, value: 2 });
    launchMaze2(w, 1, 4);
    const path = trail(w, 1);
    expect(path).toContain("6,5");
    expect(path.slice(0, 5)).toEqual(["4,10", "5,10", "6,10", "6,9", "6,8"]);
    expect(maze2MemberState(w, 1)).toBe("cliff");
    expect(w.members[0]!.saved).toBe(false);
    expect(w.launched).toEqual([]);
    expect(Array.from(w.claimCount).every((c) => c === 0)).toBe(true);
    launchMaze2(w, 2, 4);
    expect(trail(w, 2)).not.toContain("6,9");
    expect(maze2MemberState(w, 2)).toBe("saved");
  });

  it("un panneau de trait 0 ou absent de l'équipe laisse passer tout le monde", () => {
    const inert = rec(Maze2Kind.panel, 6, 10, { dirs: [1, 0, 0, 0], dir: 0 });
    const whirl = rec(Maze2Kind.whirl, 6, 5, { type: 0 });
    const w = worldOf(mapOf([4], [...straight, inert, whirl]), [[1, 1, 1, 1]], [0]);
    launchMaze2(w, 1, 4);
    settleMaze2(w);
    expect(maze2MemberState(w, 1)).toBe("saved");
  });

  it("fait tourner un aiguillage tournant après chaque passage (le premier prend l'ancienne direction)", () => {
    const turning = rec(Maze2Kind.arrow, 5, 10, { dirs: [1, 1, 0, 0], dir: 1, rotates: true });
    const w = worldOf(mapOf([4], [...straight, turning]), [[1, 1, 1, 1], [1, 1, 1, 2]]);
    launchMaze2(w, 1, 4);
    settleMaze2(w);
    expect(maze2MemberState(w, 1)).toBe("saved");
    expect(w.cells.find((c) => c.row === 5)!.dir).toBe(0);
    // le suivant part vers l'ouest dans la case (5,10), puis se perd contre le bord en tournant sur place : on vérifie seulement la direction prise
    launchMaze2(w, 2, 4);
    advanceMaze2(w, 30 + 6 * 3);
    expect(w.flights[0]!.dir).toBe(0);
    expect(w.cells.find((c) => c.row === 5)!.dir).toBe(1);
  });

  it("un bouton fait tourner les aiguillages de même type (directions autorisées seulement) et n'a pas d'effet au type 1", () => {
    const button = rec(Maze2Kind.button, 5, 10, { type: 4 });
    const lazy = rec(Maze2Kind.button, 6, 10, { type: 1 });
    const switchA = rec(Maze2Kind.switch, 2, 4, { type: 4, dirs: [0, 1, 0, 1], dir: 1 });
    const switchB = rec(Maze2Kind.switch, 2, 5, { type: 3, dirs: [0, 1, 0, 1], dir: 1 });
    const w = worldOf(mapOf([4], [...straight, button, lazy, switchA, switchB]), [[1, 1, 1, 1]]);
    launchMaze2(w, 1, 4);
    settleMaze2(w);
    const dirOf = (row: number, col: number) => w.cells.find((c) => c.row === row && c.col === col)!.dir;
    expect(dirOf(2, 4)).toBe(3);
    expect(dirOf(2, 5)).toBe(1);
    expect(maze2MemberState(w, 1)).toBe("saved");
  });

  it("retient un Zoombini dans une case d'attente et le libère, avec la direction du suivant, quand un autre y arrive", () => {
    const wait = rec(Maze2Kind.wait, 7, 10, { type: 3 });
    // le second descend la colonne 11 puis une flèche l'envoie vers l'ouest dans la case d'attente
    const feed = rec(Maze2Kind.arrow, 7, 11, { dirs: [1, 0, 0, 0], dir: 0 });
    const south = rec(Maze2Kind.arrow, 7, 5, { dirs: [0, 1, 0, 0], dir: 1 });
    const west = rec(Maze2Kind.arrow, 10, 5, { dirs: [1, 0, 0, 0], dir: 0 });
    const w = worldOf(mapOf([4, 5], [wait, feed, south, west]), [[1, 1, 1, 1], [2, 2, 2, 2]]);
    launchMaze2(w, 1, 4);
    settleMaze2(w);
    expect(maze2MemberState(w, 1)).toBe("waiting");
    expect(w.cells[0]!.occupant).toBe(1);
    expect(w.launched).toEqual([1]);
    launchMaze2(w, 2, 5);
    settleMaze2(w);
    expect(maze2MemberState(w, 1)).toBe("saved");
    expect(maze2MemberState(w, 2)).toBe("waiting");
    expect(w.cells[0]!.occupant).toBe(2);
  });

  it("un bouton de même type que la case d'attente libère l'occupant dans sa propre direction", () => {
    const wait = rec(Maze2Kind.wait, 7, 10, { type: 5 });
    const button = rec(Maze2Kind.button, 7, 11, { type: 5 });
    const merge = rec(Maze2Kind.arrow, 10, 11, { dirs: [1, 0, 0, 0], dir: 0 });
    const w = worldOf(mapOf([4, 5], [wait, button, merge, ...straight]), [[1, 1, 1, 1], [2, 2, 2, 2]]);
    launchMaze2(w, 1, 4);
    settleMaze2(w);
    expect(maze2MemberState(w, 1)).toBe("waiting");
    launchMaze2(w, 2, 5);
    settleMaze2(w);
    expect(maze2MemberState(w, 1)).toBe("saved");
    expect(maze2MemberState(w, 2)).toBe("saved");
    expect(w.cells[0]!.occupant).toBe(0);
  });

  it("rejette les deux Zoombinis qui réservent la même case en même temps, pas ceux qui passent à quelques images d'écart", () => {
    // A (rampe 1, ligne 0) tourne en (0,5) vers le bas ; B (rampe 2, ligne 1) arrive en (1,5) depuis l'est. Même phase → collision.
    const turn = rec(Maze2Kind.arrow, 0, 5, { dirs: [0, 1, 0, 0], dir: 1 });
    const stop = rec(Maze2Kind.whirl, 3, 5, { type: 0 });
    const map = mapOf([1, 2], [turn, stop]);
    const clash = (delay: number) => {
      const w = worldOf(map, [[1, 1, 1, 1], [2, 2, 2, 2]]);
      launchMaze2(w, 1, 1);
      advanceMaze2(w, delay);
      launchMaze2(w, 2, 2);
      settleMaze2(w);
      return w;
    };
    const together = clash(6);
    expect(together.members.map((m) => m.cliff)).toEqual([0, 0]);
    expect(together.members.map((m) => maze2MemberState(together, m.id))).toEqual(["cliff", "cliff"]);
    expect(together.launched).toEqual([]);
    expect(Array.from(together.claimCount).every((c) => c === 0)).toBe(true);
    // 4 images de plus : A a déjà libéré la case (1,5) quand B la réserve ; B file jusqu'à la sortie 1 (falaise 1, sans rampe active)
    const apart = clash(10);
    expect(maze2MemberState(apart, 1)).toBe("cliff");
    expect(apart.members[1]!.cliff).toBe(1);
    expect(maze2MemberState(apart, 2)).toBe("stranded");
  });

  it("limite à 10 les Zoombinis lancés non rejetés et refuse de relancer un Zoombini en vol", () => {
    const team: Attrs[] = Array.from({ length: 12 }, () => [1, 1, 1, 1]);
    const w = worldOf(mapOf([1, 2, 3, 4, 5, 6], straight), team);
    for (let id = 1; id <= 6; id++) expect(launchMaze2(w, id, id)).toEqual({ ok: true });
    advanceMaze2(w, 35);
    for (let id = 7; id <= 10; id++) expect(launchMaze2(w, id, id - 6)).toEqual({ ok: true });
    expect(w.launched).toHaveLength(MAZE2_MAX_FLIGHTS);
    expect(launchMaze2(w, 11, 1)).toEqual({ ok: false, reason: "limit" });
  });

  it("atterrit sur la falaise de départ (relançable) ou sur une falaise munie d'une rampe (relais), sinon le Zoombini est perdu", () => {
    // sortie 0 : de la rampe 1, flèche en (0,8) vers l'est, la case (0,9) puis la sortie (0,10)
    const back = mapOf([1], [rec(Maze2Kind.arrow, 0, 8, { dirs: [0, 0, 1, 0], dir: 2 })]);
    const a = worldOf(back, [[1, 1, 1, 1]]);
    launchMaze2(a, 1, 1);
    settleMaze2(a);
    expect(a.members[0]!.cliff).toBe(0);
    expect(maze2MemberState(a, 1)).toBe("cliff");
    expect(launchMaze2(a, 1, 1)).toEqual({ ok: true });
    // sortie 2 : de la rampe 4, flèche en (10,10) vers l'est, sortie (10,11) ; la rampe 12 (falaise 2) permet de repartir vers la sortie 3
    const east = rec(Maze2Kind.arrow, 10, 10, { dirs: [0, 0, 1, 0], dir: 2 });
    const b = worldOf(mapOf([4, 12], [east]), [[1, 1, 1, 1]]);
    launchMaze2(b, 1, 4);
    settleMaze2(b);
    expect(b.members[0]!.cliff).toBe(2);
    expect(maze2MemberState(b, 1)).toBe("relay");
    expect(launchMaze2(b, 1, 4)).toEqual({ ok: false, reason: "ramp" });
    expect(launchMaze2(b, 1, 12)).toEqual({ ok: true });
    settleMaze2(b);
    expect(maze2MemberState(b, 1)).toBe("saved");
    // sans rampe sur la falaise 2, le même trajet perd le Zoombini
    const c = worldOf(mapOf([4], [east]), [[1, 1, 1, 1]]);
    launchMaze2(c, 1, 4);
    settleMaze2(c);
    expect(maze2MemberState(c, 1)).toBe("stranded");
    expect(maze2Outcome(c)).toMatchObject({ saved: [], lost: [1], goActive: false });
  });

  it("copie un monde sans partager son état", () => {
    const w = worldOf(mapOf([4], straight), [[1, 1, 1, 1]]);
    launchMaze2(w, 1, 4);
    const copy = cloneMaze2(w);
    settleMaze2(copy);
    expect(w.flights).toHaveLength(1);
    expect(w.members[0]!.saved).toBe(false);
    expect(copy.members[0]!.saved).toBe(true);
  });
});

describe.skipIf(!original.has)("cartes de MAZE2.MHK (fichiers originaux)", () => {
  const archive = MohawkArchive.parse(original.read("MAZE2.MHK"));
  const regs = (id: number) => parseRegs(archive.get(TAG_REGS, id));
  const maps = readMaze2Maps(regs);
  const positions = regs(16000);
  const count = (map: Maze2Map, kind: number) => map.records.filter((r) => r.kind === kind).length;

  it("lit les 10 cartes : en-têtes, nombre d'enregistrements et de cases de chaque type", () => {
    expect(positions).toHaveLength(338);
    expect(maps).toHaveLength(10);
    const expected: [number[], number, number[]][] = [
      [[1, 4], 16, [2, 4, 9, 1, 0, 0]],
      [[1, 3], 19, [1, 4, 13, 1, 0, 0]],
      [[1, 4], 19, [1, 5, 12, 1, 0, 0]],
      [[2], 28, [1, 8, 15, 2, 0, 2]],
      [[3], 29, [1, 7, 16, 3, 0, 2]],
      [[3], 27, [1, 8, 14, 2, 0, 2]],
      [[2, 4, 12], 38, [5, 9, 12, 5, 3, 4]],
      [[1, 3, 14], 41, [4, 9, 18, 4, 2, 4]],
      [[3, 5, 8], 42, [4, 9, 18, 5, 2, 4]],
      [[3], 30, [1, 8, 14, 2, 3, 2]],
    ];
    maps.forEach((map, i) => {
      const [ramps, total, kinds] = expected[i]!;
      expect(map.index).toBe(i);
      expect(map.ramps, `carte ${16600 + i}`).toEqual(ramps);
      expect(map.records, `carte ${16600 + i}`).toHaveLength(total);
      expect([1, 2, 3, 4, 5, 6].map((k) => count(map, k)), `carte ${16600 + i}`).toEqual(kinds);
      for (const r of map.ramps) expect(MAZE2_RAMPS[r - 1]).toBeDefined();
    });
  });

  it("place chaque enregistrement dans le losange, sans doublon ni sortie recouverte (sauf la case parasite de 16601)", () => {
    const exits = new Set(MAZE2_EXITS.flat().map(([r, c]) => `${r},${c}`));
    maps.forEach((map, i) => {
      const seen = new Set<string>();
      for (const r of map.records) {
        const at = `${r.row},${r.col}`;
        expect(seen.has(at), `carte ${16600 + i} : doublon ${at}`).toBe(false);
        seen.add(at);
        expect(exits.has(at), `carte ${16600 + i} : sortie recouverte ${at}`).toBe(false);
        const p = maze2CellPosition(positions, r.row, r.col);
        if (i === 1 && r.row === 0 && r.col === 0) {
          // enregistrement parasite de la 2e carte du niveau 0 : une flèche sans direction hors du losange (reproduite)
          expect(r.kind).toBe(Maze2Kind.arrow);
          expect(p).toEqual({ x: 0, y: 0 });
        } else expect(p.x !== 0 || p.y !== 0, `carte ${16600 + i} : ${at} hors du losange`).toBe(true);
        if (r.kind === Maze2Kind.panel) expect(r.dirs[r.dir], `panneau ${at}`).toBe(i === 3 && at === "3,5" ? 0 : 1);
      }
    });
  });

  it("donne les positions écran des cases, des départs de rampe et des sorties", () => {
    expect(maze2CellPosition(positions, 0, 2)).toEqual({ x: 53, y: 131 });
    expect(maze2CellPosition(positions, 6, 6)).toEqual({ x: 328, y: 203 });
    expect(maze2CellPosition(positions, 12, 10)).toEqual({ x: 617, y: 280 });
    expect(maze2ZoombiniPosition(positions, 6, 6)).toEqual({ x: 332, y: 165 });
    // Au lancer (`1118:2dad`), décalage propre à la direction de la rampe : 0 `(8, −33)`, 1 et 2 `(4, −38)`, 3 `(4, −33)`.
    expect(maze2LaunchPosition(positions, 6, 6, 0)).toEqual({ x: 336, y: 170 });
    expect(maze2LaunchPosition(positions, 6, 6, 1)).toEqual({ x: 332, y: 165 });
    expect(maze2LaunchPosition(positions, 6, 6, 2)).toEqual({ x: 332, y: 165 });
    expect(maze2LaunchPosition(positions, 6, 6, 3)).toEqual({ x: 332, y: 170 });
    for (const [r, c] of MAZE2_EXITS.flat()) expect(maze2CellPosition(positions, r, c).x).toBeGreaterThan(0);
    for (const ramp of MAZE2_RAMPS) {
      expect(maze2CellPosition(positions, ramp.start.row, ramp.start.col).x, `rampe ${ramp.number}`).toBeGreaterThan(0);
    }
  });

  it("rejette une carte tronquée", () => {
    expect(() => parseMaze2Map(0, [3, 1, 0, 0, 0, 0, 0, 0, 0, 0])).toThrow();
  });

  it("génère autant de traits que la carte a de panneaux, à chaque niveau, avec le bon ordre de tirage", () => {
    const team = (n: number, seed: number): Attrs[] => {
      const r = new MsvcRandom(seed);
      return Array.from({ length: n }, () => [1 + r.rand(4), 1 + r.rand(4), 1 + r.rand(4), 1 + r.rand(4)] as Attrs);
    };
    for (const [level, size] of [[0, 16], [1, 12], [2, 16], [3, 16], [3, 4]] as const) {
      const rotation = newMaze2Rotation();
      for (let visit = 0; visit < 2; visit++) {
        const members = team(size, 11 + visit);
        const w = setupMaze2(new MsvcRandom(900 + level), maps, members, level, rotation);
        const map = maps[w.mapIndex]!;
        expect(w.level).toBe(level === 3 && size < 5 ? 4 : level);
        expect(w.traits, `niveau ${level}`).toHaveLength(count(map, Maze2Kind.panel));
        expect(w.cells).toHaveLength(map.records.length);
        // ordre des tirages : 7 jeux de sprites, traits, puis un délai 20 à 25 par enregistrement
        const rng = new MsvcRandom(900 + level);
        expect(w.spriteBases).toEqual(pickSpriteBases(rng));
        const traits = generateTraits(rng, members, w.level, w.generator, visit);
        expect(w.traits).toEqual(traits);
        expect(w.cells.map((c) => c.delay)).toEqual(map.records.map(() => rng.range(20, 25)));
        for (const c of w.cells) if (c.type >= 1 && c.type <= 8) expect(c.spriteBase).toBe(w.spriteBases[c.type]);
      }
    }
  });

  it("suit les panneaux sur une vraie carte (niveau 0, 1re carte) : un trajet complet jusqu'au tourbillon", () => {
    // traits [3, 3, 1, 4] : quatre panneaux sur l'attribut 0 ; le Zoombini 1533 (attribut 0 = 1) est dévié par le panneau (4,6)
    const w = buildMaze2World({ map: maps[0]!, level: 0, generator: "67d3", traits: [3, 3, 1, 4], spriteBases: BASES, team: [[1, 5, 3, 3]] });
    launchMaze2(w, 1, 4);
    expect(trail(w, 1)).toEqual(["4,10", "4,9", "4,8", "4,7", "4,6", "3,6", "2,6", "2,7", "2,8", "2,9"]);
    expect(maze2MemberState(w, 1)).toBe("cliff");
    // l'aiguillage tournant (4,8) a tourné : le suivant (même Zoombini relancé) descend vers la sortie 3
    expect(w.cells.find((c) => c.row === 4 && c.col === 8)!.dir).toBe(1);
    launchMaze2(w, 1, 4);
    settleMaze2(w);
    expect(maze2MemberState(w, 1)).toBe("saved");
  });

  it("le robot sauve tout le groupe aux niveaux 0 à 2 et son plan se rejoue à l'identique", () => {
    const team = (n: number, seed: number): Attrs[] => {
      const r = new MsvcRandom(seed);
      return Array.from({ length: n }, () => [1 + r.rand(4), 1 + r.rand(4), 1 + r.rand(4), 1 + r.rand(4)] as Attrs);
    };
    for (const [level, size, seed] of [[0, 16, 1], [0, 5, 2], [0, 12, 3], [1, 6, 4], [1, 9, 5], [2, 7, 6], [2, 9, 7], [2, 12, 8]] as const) {
      for (let visit = 0; visit < 2; visit++) {
        const rotation = newMaze2Rotation();
        if (visit === 1) chooseMaze2Map(level, rotation);
        const w = setupMaze2(new MsvcRandom(seed * 17), maps, team(size, seed), level, rotation);
        const plan = planMaze2(w, 100000);
        const final = replayMaze2(w, plan.launches);
        expect(plan.complete, `niveau ${level}, ${size} Zoombinis, carte ${16600 + w.mapIndex}`).toBe(true);
        expect(plan.saved).toBe(size);
        expect(maze2Outcome(final)).toMatchObject({ lost: [], goActive: true, allSaved: true });
        expect(w.members.every((m) => !m.saved && m.cliff === 0)).toBe(true);
      }
    }
  });

  it("le robot gère le niveau 3 (relais par les falaises 1 et 2, cases d'attente) et le niveau 4 sans rien perdre à tort", () => {
    const team = (n: number, seed: number): Attrs[] => {
      const r = new MsvcRandom(seed);
      return Array.from({ length: n }, () => [1 + r.rand(4), 1 + r.rand(4), 1 + r.rand(4), 1 + r.rand(4)] as Attrs);
    };
    const small = setupMaze2(new MsvcRandom(5), maps, team(3, 9), 3, newMaze2Rotation());
    expect(small.mapIndex).toBe(9);
    const smallPlan = planMaze2(small, 100000);
    expect(smallPlan.complete).toBe(true);
    const five = setupMaze2(new MsvcRandom(6), maps, team(5, 13), 3, newMaze2Rotation());
    expect(five.mapIndex).toBe(6);
    const fivePlan = planMaze2(five, 100000);
    expect(fivePlan.complete).toBe(true);
    // un lancer depuis une falaise relais figure dans le plan
    expect(fivePlan.launches.some((l) => MAZE2_RAMPS[l.ramp - 1]!.cliff === 2)).toBe(true);
    const final = replayMaze2(five, fivePlan.launches);
    expect(maze2Outcome(final).allSaved).toBe(true);
  });
});
