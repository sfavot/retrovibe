import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type Level, type LevPart, emptyPart, readLev, writeLev, PART_LOCKED } from "../../../../src/games/tim3/data/lev";
import { defaultRegistry } from "../../../../src/games/tim3/engine/parts";
import { registerPipes } from "../../../../src/games/tim3/engine/parts/misc/pipes";
import { firstDifference, parseTrace, traceWorld } from "../../../../src/games/tim3/engine/trace";
import { World } from "../../../../src/games/tim3/engine/world";
import { baseIndex } from "../../data/real";
import { original, readTrace, realTypes, TRACE_DIR } from "../helpers";

/** Tuyaux 47, 57, 97, 98, accélérateur 88, bloc de couleur 127 : scénarios minimaux comparés au banc. */
const PIPES = new Set([47, 57, 88, 97, 98, 127]);
const OTHERS = new Set([4, 11, 15, 35, 37, 39, 53, 59, 64, 67, 69, 71, 72, 77, 87, 116, 117, 119]);
const OWN = ["443dc0", "443de8", "444c68", "444cb9", "444ce1", "446c94", "446d4c", "446cd0", "446d89", "4473d0", "44742b", "44750d", "447584", "4475e2", "448268", "44827f", "43d59c"];
const files = original.has ? readdirSync(TRACE_DIR).filter((f) => /^misc-.*-keep.*\.tsv$/.test(f)).sort() : [];

function worldWith(level: string, keep: Set<number>): World {
  const r = defaultRegistry();
  if (!r.has(0x443dc0)) registerPipes(r);
  const w = new World(realTypes(), r);
  w.loadLevel(readLev(baseIndex().get(`${level}.LEV`)));
  for (const list of [w.statics, w.mobiles]) for (const p of list.toArray()) if (!keep.has(p.type)) list.remove(p);
  w.start();
  return w;
}

const cases = files
  .map((file) => {
    const header = parseTrace(readTrace(file).split("\n", 1)[0]!).header;
    const [level, k] = (header.level ?? "").split("-keep");
    const named = new Set(file.replace(/^.*-keep|\.tsv$/g, "").split("_").map(Number));
    return { file, level: level!, name: header.level!, keep: new Set((k ?? "").split("_").map(Number)), named };
  })
  // Seuls les fichiers qui portent mes types et aucun type des autres groupes (4, 11, 15, 35 … 119 : voir le plan).
  .filter((c) => [...PIPES].some((t) => c.named.has(t)) && ![...OTHERS].some((t) => c.named.has(t)));

describe.skipIf(cases.length === 0)("TIM3 misc/pipes : scénarios comparés au banc", () => {
  it.each(cases)("$file", ({ file, level, name, keep }) => {
    const expected = parseTrace(readTrace(file));
    const w = worldWith(level, keep);
    expect(w.unportedTypes().filter((t) => PIPES.has(t))).toEqual([]);
    const actual = parseTrace(traceWorld(w, name, Number(expected.header.steps)));
    const diff = firstDifference(expected.rows, actual.rows);
    expect(diff, diff ?? "").toBeNull();
    // Aucune souche de mes handlers (les sorties de tuyau des types 54, 70, 109 relèvent d'autres groupes).
    for (const k of w.log.stubs.keys()) expect(OWN).not.toContain(k);
  });
});

// ---- Niveaux synthétiques (un tuyau, une chaîne, des billes lâchées dans les embouchures) ------------------------------
// Les LEV sont écrits par `TIM3_WRITE_PIPES_LEV=<dossier> npx vitest run …` puis tracés par le banc :
// `bench.py trace --lev <dossier>/PIPEA.LEV --steps 600 --out test/tim3/traces/synthetic/PIPEA.tsv` (sous-dossier : le
// harnais traces.test.ts ne lit que le dossier de premier niveau)..

function mk(type: number, x: number, y: number, w: number, h: number, extra: Partial<LevPart> = {}): LevPart {
  const p = emptyPart(type) as unknown as Record<string, number>;
  Object.assign(p, { x, y, width1: w, height1: h, width2: w, height2: h, connected1: -1, connected2: -1, plugged1: -1, plugged2: -1 });
  Object.assign(p, extra);
  return p as unknown as LevPart;
}
const pipe = (type: number, x: number, y: number, w: number, h: number, appearance = 0, flags2 = 0): LevPart =>
  mk(type, x, y, w, h, { flags1: type === 97 || type === 98 ? 24576 : 26112, flags2: type === 97 ? 384 | flags2 : flags2, flags3: PART_LOCKED, appearance });
const ball = (x: number, y: number, type = 0): LevPart =>
  mk(type, x, y, 32, 32, { flags1: 4096, flags3: 32840 });

const wall = (type: number, x: number, y: number, w: number, h: number, appearance = 0, flags2 = 384): LevPart =>
  mk(type, x, y, w, h, { flags1: 24576, flags2, flags3: PART_LOCKED, appearance });
const slope = (x: number, y: number, flip: boolean): LevPart => mk(2, x, y, 32, 32, { flags1: 26112, flags2: flip ? 144 : 128, flags3: PART_LOCKED, appearance: 1 });

const SCENARIOS: Record<string, () => LevPart[]> = {
  // billes qui roulent sur le sol vers l'embouchure d'un tuyau horizontal (à droite, puis à gauche)
  PIPEE: () => [wall(1, 0, 260, 560, 16), slope(60, 228, false), pipe(97, 200, 222, 48, 38), ball(60, 150), slope(500, 228, true), pipe(97, 340, 222, 48, 38), ball(500, 150)],
  // tuyau court 98 sur le sol, billes qui roulent des deux côtés puis une lâchée au-dessus
  PIPEG: () => [wall(1, 0, 260, 560, 16), pipe(98, 240, 180, 80, 80), slope(100, 228, false), ball(100, 150), slope(440, 228, true), ball(440, 150), ball(260, 0)],
  // tuyau vertical, bille lâchée au-dessus
  PIPEA: () => [pipe(97, 100, 120, 38, 80), ball(103, 20)],
  // chaîne : vertical → coude (image 3) → horizontal → accélérateur
  PIPEB: () => [pipe(97, 100, 40, 38, 80), pipe(57, 100, 120, 64, 70, 3), pipe(97, 164, 152, 48, 38), pipe(88, 212, 152, 48, 38, 5), ball(103, 0)],
  // quatre coudes, chacun sous une bille
  PIPEC: () => [0, 1, 2, 3].flatMap((f, i) => [pipe(57, 40 + i * 120, 120, f < 2 ? 64 : 72, 64 + (f % 2 ? 6 : 0), f), ball(44 + i * 120, 20), ball(60 + i * 120, 70)]),
  // tuyau court 98 et accélérateurs verticaux
  PIPED: () => [pipe(98, 100, 100, 80, 80), pipe(88, 260, 100, 40, 48), pipe(88, 330, 100, 40, 48, 0, 32), ball(120, 0), ball(268, 0), ball(338, 0)],
};

function scenarioLevel(name: string): Level {
  const base = readLev(baseIndex().get("TLEV21.LEV"));
  return { ...base, fixedParts: SCENARIOS[name]!().filter((p) => p.type !== 0), movingParts: SCENARIOS[name]!().filter((p) => p.type === 0) };
}

const writeDir = process.env.TIM3_WRITE_PIPES_LEV;
describe.skipIf(!writeDir || !original.has)("TIM3 misc/pipes : écriture des LEV synthétiques", () => {
  it("écrit", () => {
    mkdirSync(writeDir!, { recursive: true });
    for (const name of Object.keys(SCENARIOS)) writeFileSync(resolve(writeDir!, `${name}.LEV`), writeLev(scenarioLevel(name)));
  });
});

const syntheticDir = resolve(TRACE_DIR, "synthetic");
const synthetic = original.has ? Object.keys(SCENARIOS).filter((n) => existsSync(resolve(syntheticDir, `${n}.tsv`))) : [];

describe.skipIf(synthetic.length === 0)("TIM3 misc/pipes : niveaux synthétiques comparés au banc", () => {
  it.each(synthetic)("%s", (name) => {
    const expected = parseTrace(readFileSync(resolve(syntheticDir, `${name}.tsv`), "utf8"));
    const r = defaultRegistry();
    if (!r.has(0x443dc0)) registerPipes(r);
    const w = new World(realTypes(), r);
    w.loadLevel(readLev(writeLev(scenarioLevel(name))));
    w.start();
    const actual = parseTrace(traceWorld(w, name, Number(expected.header.steps)));
    const diff = firstDifference(expected.rows, actual.rows);
    expect(diff, diff ?? "").toBeNull();
    for (const k of w.log.stubs.keys()) expect(OWN).not.toContain(k);
  });
});
