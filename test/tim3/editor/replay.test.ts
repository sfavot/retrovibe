import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readLev } from "../../../src/games/tim3/data/lev";
import { Tim3Session } from "../../../src/games/tim3/engine/session";
import { baseIndex, original } from "../data/real";
import { realTypes } from "../engine/helpers";
import type { Solution } from "../solutions/apply";
import { replay, run } from "./replay";
import { parseLines } from "../../../src/games/tim3/data/text";
import { parseProgramRows, type ProgramRow } from "../../../src/games/tim3/engine/program";

let rows: ProgramRow[] | undefined;
/** Lignes de `PROGPART.RES` (fenêtre « programmer »). */
const programs = (): ProgramRow[] => (rows ??= parseProgramRows(parseLines(baseIndex().get("PROGPART.RES"))));

/**
 * Solutions du concepteur (`test/tim3/solutions/*.json`) rejouées **par l'API de l'éditeur** (`./replay.ts`), puis Démarrer :
 * le puzzle doit être résolu (`TickResult.solved`) au pas `goalStep` + 30 mesuré au banc. Petit choix de puzzles ;
 * `TIM3_REPLAY_ALL=1` les rejoue tous (`TIM3_REPLAY_REPORT=<fichier>` : écarts écrits dans ce fichier) : les 156 sont
 * résolus ; `SHIFTED` finissent à quelques pas du banc, parce que les pièces posées à la main entrent dans les listes une à
 * une (4393e0) et non dans l'ordre du LEV que lit le banc.
 */
const SHIFTED = new Set(["HLEV6", "HLEV7", "HLEV9", "HLEV10", "HLEV17"]);
const DIR = resolve(import.meta.dirname, "../solutions");
const read = (name: string) => JSON.parse(readFileSync(resolve(DIR, `${name}.json`), "utf8")) as Solution;

/**
 * Puzzles rejoués, un par famille de gestes : pose libre (TLEV1), lampe de poche à taille du PAR (TLEV11), courroie et fiche
 * (TLEV12), corde par deux poulies (TLEV31), mur étiré par sa poignée (ELEV12), télécommande et son partenaire neuf, coude
 * tourné par quarts (HLEV19), bascule retournée (TLEV4), tout ensemble (RLEV21) ; fenêtre « programmer » : prise laser
 * (TLEV27), ballon et pistolet laser (MLEV24), minuteur (RLEV1), seau troué (TLEV32), Toto (TLEV38), boule de billard
 * (HLEV24) ; tuyau 97 vertical (RLEV3).
 */
const CHOSEN = ["TLEV1", "TLEV11", "TLEV12", "TLEV31", "ELEV12", "HLEV19", "TLEV4", "RLEV21", "TLEV27", "MLEV24", "RLEV1", "TLEV32", "TLEV38", "HLEV24", "RLEV3"];
const ALL = process.env.TIM3_REPLAY_ALL ? readdirSync(DIR).filter((f) => /^[TEMHR]LEV\d+\.json$/.test(f)).map((f) => f.slice(0, -5)) : [];


describe.skipIf(!original.has)("solutions rejouées par l'éditeur", () => {
  for (const name of CHOSEN) {
    it(`${name} : posé à la main, résolu au pas du banc`, () => {
      const solution = read(name);
      const level = readLev(baseIndex().get(`${name}.LEV`));
      const s = new Tim3Session(realTypes(), level);
      expect(replay(s, level, solution, programs())).toEqual([]);
      expect(run(s, solution.goalStep + 40)).toBe(solution.goalStep + 30);
      expect(s.running).toBe(false);
    });
  }

  it.runIf(ALL.length > 0)("toutes les solutions (TIM3_REPLAY_ALL)", () => {
    const report: string[] = [];
    const failed: string[] = [];
    for (const name of ALL) {
      const solution = read(name);
      const level = readLev(baseIndex().get(`${name}.LEV`));
      const s = new Tim3Session(realTypes(), level);
      const problems = replay(s, level, solution, programs());
      const at = run(s, solution.goalStep + 40);
      const exact = at === solution.goalStep + 30;
      if (problems.length || !exact) report.push(`${name} : résolu ${at} (attendu ${solution.goalStep + 30}) ; ${problems.join(" ; ")}`);
      if (problems.length || at === 0 || (!exact && !SHIFTED.has(name))) failed.push(name);
    }
    if (process.env.TIM3_REPLAY_REPORT) writeFileSync(process.env.TIM3_REPLAY_REPORT, `${ALL.length - report.length} / ${ALL.length}\n${report.join("\n")}\n`);
    expect(failed).toEqual([]);
  });
});
