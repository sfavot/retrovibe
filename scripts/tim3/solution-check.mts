// Applique les solutions écrites (test/tim3/solutions/<LEV>.json) et écrit les LEV modifiés, puis, avec --bench, les fait
// tourner sur le banc Unicorn (hors dépôt) et rapporte le pas où le jeu déclare le puzzle réussi (`# goal 2 step=N`).
// Usage :
//   npx vite-node scripts/tim3/solution-check.mts --out DIR [TLEV1 …]            LEV modifiés dans DIR
//   … --bench DIR_DU_BANC [--python PY] [--steps N] [--update] [--traces] [-j 8]
//     --update : écrit le pas mesuré dans goalStep ; --traces : garde la trace v2 (pas 0 … goalStep + 31) dans
//     test/tim3/traces/solutions/<LEV>.tsv (non versionné), que solutions.test.ts compare au moteur ;
//     --solutions DIR : lire les JSON ailleurs que dans test/tim3/solutions.
import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { readLev, writeLev } from "../../src/games/tim3/data/lev";
import { baseIndex } from "../../test/tim3/data/real";
import { applySolution, formatSolution, type Solution } from "../../test/tim3/solutions/apply";

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "../..");
const TRACES = resolve(ROOT, "test/tim3/traces/solutions");
/** Images jouées après le premier « réussi » avant que le jeu arrête la machine (goals.ts, SOLVED_COUNTDOWN). */
const AFTER = 31;

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const valued = new Set(["--out", "--bench", "--python", "--steps", "-j", "--solutions"]);
const names = argv.filter((a, i) => !a.startsWith("-") && !valued.has(argv[i - 1] ?? ""));
const SOLUTIONS = resolve(opt("--solutions") ?? resolve(ROOT, "test/tim3/solutions"));
const out = opt("--out");
if (!out) throw new Error("--out DIR attendu");
const bench = opt("--bench");
const python = opt("--python") ?? (bench ? resolve(bench, "../venv-tim3/bin/python") : "");
const maxSteps = Number(opt("--steps") ?? 3000);
const update = argv.includes("--update");
const keepTraces = argv.includes("--traces");
const jobs = Number(opt("-j") ?? 8);

mkdirSync(out, { recursive: true });
const all = names.length > 0 ? names : readdirSync(SOLUTIONS).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
const order = (n: string) => [/^TLEV/, /^ELEV/, /^MLEV/, /^HLEV/, /^RLEV/, /^HH/].findIndex((r) => r.test(n)) * 1000 + Number(n.replace(/\D/g, ""));
all.sort((a, b) => order(a) - order(b));

async function benchGoal(lev: string, steps: number, trace: string): Promise<number | null> {
  await run(python, ["-I", "bench.py", "trace", "--lev", lev, "--format", "v2", "--steps", String(steps), "--out", trace], { cwd: bench, maxBuffer: 1 << 26 });
  const m = /^# goal 2 step=(\d+)$/m.exec(readFileSync(trace, "utf8"));
  return m ? Number(m[1]) : null;
}

const results: string[] = [];
let failures = 0;
async function check(name: string): Promise<void> {
  const file = resolve(SOLUTIONS, `${name}.json`);
  const solution = JSON.parse(readFileSync(file, "utf8")) as Solution;
  const lev = resolve(out!, `${name}.LEV`);
  try {
    writeFileSync(lev, writeLev(applySolution(readLev(baseIndex().get(`${name}.LEV`)), solution)));
  } catch (e) {
    failures++;
    results.push(`${name} : ${(e as Error).message}  ← ÉCHEC`);
    return;
  }
  if (!bench) return void results.push(`${name} : ${lev}`);
  const scratch = resolve(out!, `${name}.tsv`);
  const known = solution.goalStep > 0 && !update;
  let goal: number | null;
  try {
    goal = await benchGoal(lev, known ? solution.goalStep + AFTER : maxSteps, scratch);
  } catch (e) {
    failures++;
    results.push(`${name} : erreur du banc (${String((e as { stderr?: string }).stderr ?? e).trim().split("\n").at(-1)})  ← ÉCHEC`);
    return;
  }
  const ok = goal !== null && (update || goal === solution.goalStep);
  if (!ok) failures++;
  results.push(`${name} : banc ${goal === null ? "non résolu" : `réussi au pas ${goal}`}${update ? "" : `, attendu ${solution.goalStep}`}${ok ? "" : "  ← ÉCHEC"}`);
  if (goal !== null && update && goal !== solution.goalStep) writeFileSync(file, formatSolution({ ...solution, goalStep: goal }));
  if (goal !== null && keepTraces) {
    mkdirSync(TRACES, { recursive: true });
    await benchGoal(lev, goal + AFTER, resolve(TRACES, `${name}.tsv`));
  }
}

const queue = [...all];
await Promise.all(Array.from({ length: Math.max(1, jobs) }, async () => {
  for (let n = queue.shift(); n; n = queue.shift()) await check(n);
}));
results.sort((a, b) => order(a.split(" ")[0]!) - order(b.split(" ")[0]!));
console.log(results.join("\n"));
if (bench) console.log(`${all.length - failures} / ${all.length} réussies au banc`);
if (failures) process.exitCode = 1;
