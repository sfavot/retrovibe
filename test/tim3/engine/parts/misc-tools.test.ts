import { describe, expect, it } from "vitest";
import { readLev } from "../../../../src/games/tim3/data/lev";
import { defaultRegistry } from "../../../../src/games/tim3/engine/parts";
import { registerTools } from "../../../../src/games/tim3/engine/parts/misc/tools";
import { firstDifference, parseTrace, traceWorld } from "../../../../src/games/tim3/engine/trace";
import { World } from "../../../../src/games/tim3/engine/world";
import { baseIndex } from "../../data/real";
import { original, readTrace, realTypes, traceFiles } from "../helpers";

/** Outils : gant 35, taille-haie 37, tremplin 39, ouvre-boîte 67, cisailles 77. Scénarios minimaux comparés au banc. */
const TOOLS = new Set([35, 37, 39, 67, 77]);
const OWN = [
  ...["442210", "44224f", "44234c", "4423b5", "442760", "442905", "442800", "442a44", "443168", "443218", "4431d9", "445801", "4457ac"],
];
const files = original.has ? traceFiles().filter((f) => /^misc-.*-tools\d+\.tsv$/.test(f)) : [];

function worldWith(level: string, keep: Set<number>): World {
  const r = defaultRegistry();
  if (!r.has(0x442210)) registerTools(r);
  const w = new World(realTypes(), r);
  w.loadLevel(readLev(baseIndex().get(`${level}.LEV`)));
  for (const list of [w.statics, w.mobiles]) for (const p of list.toArray()) if (!keep.has(p.type)) list.remove(p);
  w.start();
  return w;
}

const cases = files
  .map((file) => {
    const header = parseTrace(readTrace(file).split("\n", 1)[0]!).header;
    const [level, k] = header.level!.split("-keep");
    return { file, level: level!, name: header.level!, keep: new Set(k!.split("_").map(Number)) };
  })
  .filter((c) => [...TOOLS].some((t) => c.keep.has(t)));

describe.skipIf(cases.length === 0)("TIM3 misc/tools : scénarios comparés au banc", () => {
  it.each(cases)("$file", ({ file, level, name, keep }) => {
    const expected = parseTrace(readTrace(file));
    const w = worldWith(level, keep);
    const stubs = w.unportedTypes().filter((t) => TOOLS.has(t));
    expect(stubs).toEqual([]);
    const actual = parseTrace(traceWorld(w, name, Number(expected.header.steps)));
    const diff = firstDifference(expected.rows, actual.rows);
    expect(diff, diff ?? "").toBeNull();
    // Souches attendues : 442af6 (coupe des cordes, `mechanics`), 43f907 et 440454 (autres groupes). Les autres adresses
    // journalisées viennent des pièces retirées après le chargement (leur slot 2 a tourné avant le `--keep`).
    for (const k of w.log.stubs.keys()) expect(OWN).not.toContain(k);
  });
});
