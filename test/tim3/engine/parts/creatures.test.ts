import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { firstDifference, parseTrace, traceWorld } from "../../../../src/games/tim3/engine/trace";
import { levelNames, original, readTrace, realWorld, TRACE_DIR } from "../helpers";

/**
 * Groupe `creatures` (vague Φ2) : chat 12, diable en boîte 13, mandrill 31, chauve-souris 32, Cupidon 33, Père Noël 34,
 * souris 42, fromage 52, Mel 54, maison de Mel 58, alligator 61, leprechaun 65, trou de souris 66, grille-pain 81.
 *
 * - Scénarios minimaux (`test/tim3/traces/creatures/*.tsv`, produits par `bench.py trace NIVEAU --keep …`, non versionnés) :
 *   le moteur doit reproduire le banc au bit près, sans souche.
 * - Niveaux complets du banc qui contiennent un de ces types (`TIM3_TRACES_ALL=1` : aussi ceux qui attendent d'autres groupes).
 * Ignoré si les traces ou les fichiers du jeu manquent.
 */
export const CREATURE_TYPES = [12, 13, 31, 32, 33, 34, 42, 52, 54, 58, 61, 65, 66, 81];
const SCENARIO_DIR = resolve(TRACE_DIR, "creatures");
const scenarios = original.has && existsSync(SCENARIO_DIR) ? readdirSync(SCENARIO_DIR).filter((f) => f.endsWith(".tsv")).sort() : [];
const all = Boolean(process.env.TIM3_TRACES_ALL);

function split(name: string): { level: string; keep?: Set<number> } {
  const [level, keepPart] = name.split("-keep");
  return { level: level!, keep: keepPart ? new Set(keepPart.split("_").map(Number)) : undefined };
}

describe.skipIf(scenarios.length === 0)("TIM3 créatures : scénarios minimaux comparés au banc", () => {
  it.each(scenarios)("%s", (file) => {
    const expected = parseTrace(readFileSync(resolve(SCENARIO_DIR, file), "utf8"));
    const name = expected.header.level!;
    const { level, keep } = split(name);
    const world = realWorld(level, keep);
    const steps = Number(expected.header.steps);
    // Les souches du chargement viennent des types retirés par `--keep` après coup : on ne compte que celles du scénario.
    expect(world.unportedTypes(), "types posés non portés").toEqual([]);
    world.log.stubs.clear();
    const actual = parseTrace(traceWorld(world, name, steps));
    const diff = firstDifference(expected.rows, actual.rows);
    expect(diff, diff ?? "").toBeNull();
    const mine = [...world.log.stubs.keys()].filter((a) => {
      const n = parseInt(a, 16);
      return n >= 0x43fa20 && n < 0x446b00;
    });
    expect(mine, "souches de créatures appelées").toEqual([]);
  });
});

const levelFiles = original.has && existsSync(TRACE_DIR) ? levelNames().filter((n) => existsSync(resolve(TRACE_DIR, `${n}.tsv`))) : [];
const withCreatures = levelFiles.filter((n) => {
  const types = new Set([...realWorld(n).staticThenMobile()].map((p) => p.type));
  return CREATURE_TYPES.some((t) => types.has(t));
});

describe.skipIf(withCreatures.length === 0)("TIM3 créatures : niveaux complets comparés au banc", () => {
  for (const n of withCreatures) {
    const waiting = realWorld(n).unportedTypes();
    const run = waiting.length === 0 || all;
    (run ? it : it.skip)(`${n}${waiting.length ? ` (types non portés : ${waiting.join(", ")})` : ""}`, () => {
      const expected = parseTrace(readTrace(`${n}.tsv`));
      const actual = parseTrace(traceWorld(realWorld(n), n, Number(expected.header.steps)));
      const diff = firstDifference(expected.rows, actual.rows);
      expect(diff, diff ?? "").toBeNull();
    });
  }
});
