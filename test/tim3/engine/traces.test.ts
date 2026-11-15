import { describe, expect, it } from "vitest";
import { firstDifference, parseTrace, traceWorld } from "../../../src/games/tim3/engine/trace";
import { original, readTrace, realWorld, traceFiles } from "./helpers";

/**
 * Traces du moteur comparées à celles du banc Unicorn (`test/tim3/traces/*.tsv`, non versionnées, produites hors dépôt
 * par `bench.py trace … [--keep …]`). Ignoré si les traces ou les fichiers du jeu manquent.
 */
const files = original.has ? traceFiles() : [];

interface Case {
  file: string;
  name: string;
  level: string;
  keep?: Set<number>;
  /** Types posés dont un handler n'est pas encore porté (vague Φ2) : la comparaison attend. */
  waiting: number[];
}

/** Fichiers au format v1 avec un en-tête lisible (les autres, vides ou d'un autre format, sont ignorés). */
const cases: Case[] = files.flatMap((file) => {
  const first = readTrace(file).split("\n", 1)[0] ?? "";
  if (!first.startsWith("# tim3-trace v1")) return [];
  const header = parseTrace(first).header;
  const name = header.level;
  if (!name || header.steps === undefined) return [];
  const [level, keepPart] = name.split("-keep");
  const keep = keepPart ? new Set(keepPart.split("_").map(Number)) : undefined;
  return [{ file, name, level: level!, keep, waiting: realWorld(level!, keep).unportedTypes() }];
});

/** `TIM3_TRACES_ALL=1` : compare aussi les niveaux qui attendent Φ2 (pour mesurer l'avancement). */
const all = Boolean(process.env.TIM3_TRACES_ALL);

describe.skipIf(files.length === 0)("TIM3 : traces comparées au banc", () => {
  for (const c of cases.filter((x) => x.waiting.length > 0 && !all))
    it.skip(`${c.file} (attend Φ2 : types ${c.waiting.join(", ")})`, () => undefined);

  it.each(cases.filter((x) => x.waiting.length === 0 || all))("$file", ({ file, name, level, keep }) => {
    const expected = parseTrace(readTrace(file));
    const steps = Number(expected.header.steps);
    const actual = parseTrace(traceWorld(realWorld(level, keep), name, steps));
    expect(actual.header.pressure).toBe(expected.header.pressure);
    expect(actual.header.gravity).toBe(expected.header.gravity);
    const diff = firstDifference(expected.rows, actual.rows);
    expect(diff, diff ?? "").toBeNull();
  });
});
