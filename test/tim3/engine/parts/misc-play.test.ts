import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readLev } from "../../../../src/games/tim3/data/lev";
import { defaultRegistry } from "../../../../src/games/tim3/engine/parts";
import { registerPlay } from "../../../../src/games/tim3/engine/parts/misc/play";
import { step } from "../../../../src/games/tim3/engine/step";
import { firstDifference, parseTrace, traceWorld } from "../../../../src/games/tim3/engine/trace";
import { World } from "../../../../src/games/tim3/engine/world";
import { baseIndex } from "../../data/real";
import { original, readTrace, realTypes, TRACE_DIR } from "../helpers";

/**
 * Balle programmable 87, super-balle 59, bumper 64, coussin antigravité 69, flipper 116, queue 117, poche 119 (et
 * contrôle des boules 43 et 63 des balles) : scénarios minimaux (`bench.py trace N --keep …`) comparés au banc.
 */
const MINE = new Set([59, 64, 69, 87, 116, 117, 119]);
/** Adresses de handlers de ce groupe (43dcb5 « actionner » appartient à un autre groupe : souche attendue). */
const OWN = ["43baec", "43bb86", "43bbf3", "444f04", "444f53", "444f77", "445560", "445660", "445830", "447b5c", "447c9f", "447c72", "447cd4", "447da8", "447e3f", "447e11", "447f8f", "448160", "44819b", "4481cc"];
const SCENARIOS = [
  "TLEV24-keep28_44_63_117_118_119_125_126",
  "RLEV25-keep2_44_63_117_118_119",
  "HH12-keep43_56_63_118_64_117_119",
  "TLEV1-keep0_1_9_28_43_44_63_68_59_87",
  "TLEV1-keep0_1_9_28_43_44_63_68_59",
  "TLEV9-keep0_43_56_85_87",
  "TLEV17-keep28_43_84_101_64_116",
  "ELEV21-keep0_28_43_56_63_68_125_126_64",
  "TLEV16-keep0_9_56_125_69",
  "MLEV16-keep43_56_126_116",
  "MLEV29-keep2_28_43_56_122_116",
  "ELEV14-keep1_43_69_102_130_131_132_133_134",
  "MLEV22-keep43_56_63_68_69_126",
  "RLEV16-keep1_9_28_44_48_56_68_69_101_113",
  "RLEV16-keep1_9_28_44_48_56_59_68_101_113",
  "ELEV9-keep2_48_87",
  "MLEV10-keep44_48_82_87_113_114_126_143_146",
  "RLEV17-keep1_9_28_43_48_56_60_84_87_113_125_126_127_134_147",
  "RLEV19-keep1_9_44_56_68_87_105_113",
  "RLEV22-keep56_85_87_100",
  "TLEV5-keep1_28_43_44_59_102",
  "HH2-keep2_59_63_99_100_101_118_125_126",
  "TLEV17-keep28_43_64_84_101",
  "TLEV17-keep28_43_84_101_116",
  "TLEV24-keep28_44_63_117_118_125_126",
  "TLEV24-keep28_44_63_118_119_125_126",
];
const available = original.has ? SCENARIOS.filter((s) => existsSync(resolve(TRACE_DIR, `misc-${s}.tsv`))) : [];

function worldWith(level: string, keep: Set<number>): World {
  const r = defaultRegistry();
  if (!r.has(0x43bbf3)) registerPlay(r);
  const w = new World(realTypes(), r);
  w.loadLevel(readLev(baseIndex().get(`${level}.LEV`)));
  for (const list of [w.statics, w.mobiles]) for (const p of list.toArray()) if (!keep.has(p.type)) list.remove(p);
  w.start();
  return w;
}

describe.skipIf(available.length === 0)("TIM3 misc/play : scénarios comparés au banc", () => {
  it.each(available)("%s", (s) => {
    const expected = parseTrace(readTrace(`misc-${s}.tsv`));
    const name = expected.header.level!;
    const [level, k] = name.split("-keep");
    const w = worldWith(level!, new Set(k!.split("_").map(Number)));
    expect(w.unportedTypes().filter((t) => MINE.has(t))).toEqual([]);
    const actual = parseTrace(traceWorld(w, name, Number(expected.header.steps)));
    const diff = firstDifference(expected.rows, actual.rows);
    expect(diff, diff ?? "").toBeNull();
    for (const key of w.log.stubs.keys()) expect(OWN).not.toContain(key);
  });
});

/** Format v2 (image +0x18, compteur +0x104) : l'image de chaque pièce de ces types doit suivre le banc pas à pas. */
const V2 = [
  "TLEV24-keep28_44_63_117_118_119_125_126",
  "TLEV1-keep0_1_9_28_43_44_63_68_59_87",
  "TLEV17-keep28_43_84_101_64_116",
  "TLEV16-keep0_9_56_125_69",
  "TLEV9-keep0_43_56_85_87",
  "RLEV25-keep2_44_63_117_118_119",
].filter((s) => original.has && existsSync(resolve(TRACE_DIR, `play-${s}.v2`)));

describe.skipIf(V2.length === 0)("TIM3 misc/play : images comparées au banc (format v2)", () => {
  it.each(V2)("%s", (s) => {
    const [level, k] = s.split("-keep");
    const w = worldWith(level!, new Set(k!.split("_").map(Number)));
    const lines = readFileSync(resolve(TRACE_DIR, `play-${s}.v2`), "utf8").split("\n");
    const byStep = new Map<number, string[][]>();
    for (const l of lines) {
      if (!l || l.startsWith("#")) continue;
      const f = l.split("\t");
      if (f[1] !== "M" && f[1] !== "S") continue;
      const n = Number(f[0]);
      if (!byStep.has(n)) byStep.set(n, []);
      byStep.get(n)!.push(f);
    }
    for (let n = 0; n <= 600; n++) {
      const rows = byStep.get(n)!;
      const parts = [...w.mobiles.toArray().map((p) => ["M", p] as const), ...w.statics.toArray().map((p) => ["S", p] as const)];
      expect(parts.length).toBe(rows.length);
      parts.forEach(([, p], i) => {
        // Boule 43 exclue : son clignotement (43bd83) n'est pas à l'heure du banc (voir docs/tim3/parts-misc.md).
        if (!MINE.has(p.type) && p.type !== 63) return;
        const f = rows[i]!;
        expect(p.frame, `pas ${n} ${f[1]}${f[2]} type ${p.type} image`).toBe(Number(f[12]));
        if (p.type === 87) expect(p.f104, `pas ${n} f104`).toBe(Number(f[15]));
      });
      if (n < 600) step(w);
    }
  });
});
