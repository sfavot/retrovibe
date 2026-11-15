import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readLev } from "../../../src/games/tim3/data/lev";
import { GOAL_MET, GoalTest, SOLVED_COUNTDOWN } from "../../../src/games/tim3/engine/goals";
import type { Part } from "../../../src/games/tim3/engine/part";
import { overlapsAnother } from "../../../src/games/tim3/engine/parts/creatures/kernel";
import { step } from "../../../src/games/tim3/engine/step";
import { World } from "../../../src/games/tim3/engine/world";
import { baseIndex } from "../data/real";
import { original, realTypes, TRACE_DIR } from "../engine/helpers";
import { applySolution, binIndices, type Solution } from "./apply";

/**
 * Solutions écrites pour le port (`docs/tim3/solutions.md`) : chaque solution, appliquée à son LEV, doit être jouable
 * (pièces du bac seulement, calées sur la grille de l'éditeur, sans chevauchement) et résoudre le puzzle dans le moteur
 * au pas mesuré sur le banc (`goalStep`). Si la trace v2 du banc est présente (`test/tim3/traces/solutions/<LEV>.tsv`,
 * non versionnée, écrite par `scripts/tim3/solution-check.mts --traces`), le moteur doit la suivre pas à pas.
 * `TIM3_SOLUTIONS_DIR` : lire les JSON ailleurs (brouillons pas encore versionnés).
 */
const DIR = process.env.TIM3_SOLUTIONS_DIR ? resolve(process.env.TIM3_SOLUTIONS_DIR) : import.meta.dirname;
const TRACES = resolve(TRACE_DIR, "solutions");
const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort((a, b) => order(a) - order(b));

function order(file: string): number {
  return ["TLEV", "ELEV", "MLEV", "HLEV", "RLEV", "HH"].findIndex((p) => file.startsWith(p)) * 1000 + Number(file.replace(/\D/g, ""));
}

const read = (file: string) => JSON.parse(readFileSync(resolve(DIR, file), "utf8")) as Solution;

/** Taille de l'aire (fenêtre de 0x480fc8) ; l'éditeur laisse au moins 4 px de la pièce visibles (42f24a). */
const FIELD_W = 568;
const FIELD_H = 378;
/** 42f24a : engrenages, bascule et 0x8b calés sur 8 px ; ces types descendent à 3 px de la grille au lieu de 8. */
const GRID8 = new Set([0x56, 0x0e, 3, 0x8b]);
const LOW_Y = new Set([0x39, 0x62, 0x61, 0x58]);

/** Position atteignable avec la souris dans l'éditeur (42f24a) : grille de 16 décalée de 8, ou libre (+0x14 & 8). */
function onGrid(p: Part): boolean {
  if (p.flags14 & 8) return true;
  const mod = (v: number, m: number) => ((v % m) + m) % m;
  if (GRID8.has(p.type)) return mod(p.editX, 8) === 0 && mod(p.editY, 8) === 0;
  return mod(p.editX, 16) === 8 && mod(p.editY, 16) === (LOW_Y.has(p.type) ? 3 : 8);
}

interface Row {
  step: number;
  key: string;
  values: string;
}

/** Lignes M et S d'une trace v2 du banc (champs du format v1 et image +0x18), et pas du premier « réussi ». */
function benchTrace(text: string): { rows: Row[]; goal: number | null } {
  const rows: Row[] = [];
  let goal: number | null = null;
  for (const line of text.split("\n")) {
    const g = /^# goal 2 step=(\d+)$/.exec(line);
    if (g && goal === null) goal = Number(g[1]);
    const c = line.split("\t");
    if (c[1] !== "M" && c[1] !== "S") continue;
    rows.push({ step: Number(c[0]), key: `${c[1]}${c[2]} type ${c[4]}`, values: [c[5], c[6], c[7], c[8], c[9], c[10], c[11], c[12]].join(" ") });
  }
  return { rows, goal };
}

const hex = (v: number) => (v >>> 0).toString(16).padStart(8, "0");

function engineRows(w: World, stepNo: number): Row[] {
  const out: Row[] = [];
  const add = (list: string, p: Part, i: number) =>
    out.push({ step: stepNo, key: `${list}${i} type ${p.type}`, values: [p.fx, p.fy, p.vx, p.vy, hex(p.flags0C), hex(p.flags10), hex(p.flags14), p.frame].join(" ") });
  w.mobiles.toArray().forEach((p, i) => add("M", p, i));
  w.statics.toArray().forEach((p, i) => add("S", p, i));
  return out;
}

/**
 * Écarts du moteur avec le banc sur une solution (premier pas qui diffère), confiés au noyau : le test est attendu en
 * échec (`it.fails`) et redeviendra normal quand l'écart sera corrigé (retirer alors la ligne).
 */
const KNOWN_DIVERGENCES: Record<string, string> = {};

/**
 * Écarts volontaires (comportement indéfini de l'exe, `docs/tim3/engine.md` § 6 bis) : la trace du banc n'est pas
 * comparée, mais le puzzle doit être réussi au pas du banc.
 */
const UNDEFINED_IN_EXE: Record<string, string> = {
  // 434fab lit, pour une pièce sans polygone en tête des mobiles, un registre non initialisé (cheville 72 créée en
  // marche) ; le moteur ignore cette pièce. Trace différente du banc à partir du pas 145, réussite au même pas (777).
  RLEV22: "434fab : pièce sans polygone ignorée",
};

describe.skipIf(!original.has)("TIM3 : solutions écrites", () => {
  for (const file of files) {
    const level = file.slice(0, -5);
    const known = KNOWN_DIVERGENCES[level];
    const undefinedInExe = UNDEFINED_IN_EXE[level];
    const name = known ? `${file} (divergence moteur connue : ${known})` : undefinedInExe ? `${file} (réussite seule ; ${undefinedInExe})` : file;
    (known ? it.fails : it)(name, () => check(file, undefinedInExe === undefined));
  }
});

function check(file: string, compareTrace = true): void {
  const solution = read(file);
  expect(file).toBe(`${solution.level}.json`);
  expect(solution.goalStep, "goalStep à mesurer au banc").toBeGreaterThan(0);
  const source = readLev(baseIndex().get(`${solution.level}.LEV`));
  const bin = binIndices(source);
  const level = applySolution(source, solution, bin);
  const world = new World(realTypes());
  world.loadLevel(level);
  world.start();

  // Jouable : les pièces posées sont dans l'aire, sur la grille de l'éditeur, et ne chevauchent rien (437208).
  const placed = new Set(solution.parts.map((a) => a.part));
  expect([...world.bin].filter((p) => placed.has(p.levIndex)).map((p) => p.levIndex), "pièces posées restées au bac").toEqual([]);
  for (const p of [...world.statics, ...world.mobiles]) {
    if (!placed.has(p.levIndex) || p.type === 8 || p.type === 10 || p.type === 76) continue;
    const where = `pièce ${p.levIndex} (type ${p.type}) en ${p.editX}, ${p.editY}`;
    expect(onGrid(p), `${where} : hors de la grille de l'éditeur`).toBe(true);
    expect(p.editX + p.frameW > 4 && p.editX <= FIELD_W - 4 && p.editY + p.frameH > 4 && p.editY <= FIELD_H - 4, `${where} : hors de l'aire`).toBe(true);
    expect(overlapsAnother(world, p), `${where} : chevauche une autre pièce`).toBe(false);
  }
  // Les pièces du bac non posées y restent.
  expect([...world.bin].every((p) => bin.has(p.levIndex))).toBe(true);

  // Résolu au même pas que le banc.
  const tracePath = resolve(TRACES, `${solution.level}.tsv`);
  const bench = compareTrace && existsSync(tracePath) ? benchTrace(readFileSync(tracePath, "utf8")) : null;
  if (bench) expect(bench.goal, "pas du banc (trace locale)").toBe(solution.goalStep);
  const goals = GoalTest.fromLevel(level, world);
  goals.reset();
  let solvedAt: number | null = null;
  const last = solution.goalStep + SOLVED_COUNTDOWN + 1;
  for (let k = 0; k <= last; k++) {
    if (bench) {
      const expected = bench.rows.filter((r) => r.step === k);
      if (expected.length > 0) {
        const actual = engineRows(world, k);
        const diff = expected.findIndex((r, i) => r.key !== actual[i]?.key || r.values !== actual[i]?.values);
        const where = diff >= 0 ? expected[diff]! : null;
        expect(
          diff === -1 && actual.length === expected.length,
          where ? `pas ${k}, ${where.key} : banc ${where.values}, moteur ${actual[diff] ? `${actual[diff].key} ${actual[diff].values}` : "(absent)"}` : `pas ${k} : ${actual.length} pièces, ${expected.length} au banc`,
        ).toBe(true);
      }
    }
    if (k === last) break;
    step(world);
    if (goals.check(world) === GOAL_MET && solvedAt === null) solvedAt = k + 1;
  }
  expect(solvedAt, "pas du premier « réussi » (436dc6) dans le moteur").toBe(solution.goalStep);
}
