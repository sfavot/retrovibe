import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { levelParts, readLev } from "../../../src/games/tim3/data/lev";
import { puzzleList } from "../../../src/games/tim3/engine/session";
import { DECOY, designerSolution, solutionSession } from "../../../src/games/tim3/engine/solution";
import { baseIndex, original } from "../data/real";
import { realTypes } from "../engine/helpers";
import type { Solution } from "../solutions/apply";
import { run } from "./replay";

const DIR = resolve(import.meta.dirname, "../solutions");
const read = (name: string) => JSON.parse(readFileSync(resolve(DIR, `${name}.json`), "utf8")) as Solution;
const ALL = process.env.TIM3_SOLUTION_ALL ? readdirSync(DIR).filter((f) => /^[TEMHR]LEV\d+\.json$/.test(f)).map((f) => f.slice(0, -5)) : [];
/** Un puzzle par famille de liens : pose libre, courroie et fiche, corde par deux poulies, télécommande, leurres reliés (HLEV16). */
/** Résolu, mais 17 pas avant le banc (déjà à part dans `replay.test.ts`). */
const SHIFTED = new Set(["HLEV9"]);
const CHOSEN = ["TLEV1", "TLEV12", "TLEV31", "HLEV19", "HLEV16", "RLEV21", "MLEV24"];

describe.skipIf(!original.has)("« Montrer la solution » : solution du concepteur posée", () => {
  for (const name of CHOSEN) {
    it(`${name} : les pièces de la solution sont posées, déplaçables, les leurres au bac, et le puzzle se résout au pas du banc`, () => {
      const level = readLev(baseIndex().get(`${name}.LEV`));
      const sol = read(name);
      const { placed } = designerSolution(realTypes(), level);
      expect(placed.sort((a, b) => a - b)).toEqual(sol.parts.map((p) => p.part).sort((a, b) => a - b));
      const s = solutionSession(realTypes(), level, { puzzle: puzzleList().find((p) => p.name === name) });
      const field = [...s.world.staticThenMobile()];
      for (const i of placed) {
        const p = field.find((q) => q.levIndex === i);
        expect(p, `pièce ${i}`).toBeDefined();
        expect(s.editor.isMovable(p!)).toBe(true);
      }
      const all = levelParts(level);
      for (const p of s.world.bin) expect(placed).not.toContain(p.levIndex);
      expect([...s.world.bin].some((p) => all[p.levIndex]!.flags3 & DECOY) || s.world.bin.head === null).toBe(true);
      expect(run(s, sol.goalStep + 40)).toBe(sol.goalStep + 30);
    });
  }

  it("le niveau d'origine n'est pas modifié", () => {
    const level = readLev(baseIndex().get("TLEV1.LEV"));
    const before = structuredClone(level);
    designerSolution(realTypes(), level);
    expect(level).toEqual(before);
  });

  it.runIf(ALL.length > 0)("toutes les solutions (TIM3_SOLUTION_ALL)", () => {
    const failed: string[] = [];
    for (const name of ALL) {
      const level = readLev(baseIndex().get(`${name}.LEV`));
      const sol = read(name);
      const at = run(solutionSession(realTypes(), level), sol.goalStep + 40);
      if (at === 0 || (at !== sol.goalStep + 30 && !SHIFTED.has(name))) failed.push(`${name}: ${at} / ${sol.goalStep + 30}`);
    }
    expect(failed).toEqual([]);
  });
});
