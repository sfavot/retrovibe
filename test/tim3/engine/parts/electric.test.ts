import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { firstDifference, parseTrace, traceWorld } from "../../../../src/games/tim3/engine/trace";
import { step } from "../../../../src/games/tim3/engine/step";
import { readLev } from "../../../../src/games/tim3/data/lev";
import { World } from "../../../../src/games/tim3/engine/world";
import { Part, RopeData } from "../../../../src/games/tim3/engine/part";
import { baseIndex } from "../../data/real";
import { stateFirst } from "../../../../src/games/tim3/engine/parts/electric/support";
import { applyAtmosphere } from "../../../../src/games/tim3/engine/gravity";
import { original, realTypes, TRACE_DIR } from "../helpers";

/**
 * Famille « electric » : scénarios minimaux comparés au banc Unicorn (format v2 avec `--raw`, traces locales dans
 * `test/tim3/traces/electric/*.tsv`, non versionnées) puis tests de logique sans banc.
 * Scénario = un niveau où l'on ne garde que les types de la famille et ceux de Φ1 (`bench.py trace L --keep … --format v2 --raw`).
 * Champs comparés : ceux du v1 + image (+0x18), état (+0x24, lu dans `--raw`), compteur +0x104.
 */
const DIR = resolve(TRACE_DIR, "electric");
const files = original.has && existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".tsv")).sort() : [];

interface Row {
  step: number;
  list: string;
  idx: number;
  type: number;
  v: Record<string, number>;
}

const FIELDS = ["x", "y", "vx", "vy", "flags0C", "flags10", "flags14"] as const;
/** Champs d'état comparés pour les seuls types de la famille (les autres champs de Φ1 ne sont pas tous portés). */
const STATE_FIELDS = ["f18", "f104", "f24"] as const;
export const ELECTRIC_TYPES = new Set([20, 21, 22, 25, 27, 29, 30, 38, 91, 92, 93, 94, 95, 96, 120, 136, 137, 148]);

function parseV2(text: string): { level: string; steps: number; rows: Row[] } {
  const lines = text.split("\n");
  const head = Object.fromEntries(lines[0]!.split("\t").slice(1).map((kv) => kv.split("=") as [string, string]));
  const rows: Row[] = [];
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const c = line.split("\t");
    if (c[1] !== "M" && c[1] !== "S") continue;
    const raw = c[c.length - 1]!;
    const dword = (off: number) => Buffer.from(raw.slice(off * 2, off * 2 + 8), "hex").readInt32LE(0);
    rows.push({
      step: Number(c[0]),
      list: c[1]!,
      idx: Number(c[2]),
      type: Number(c[4]),
      v: {
        x: Number(c[5]), y: Number(c[6]), vx: Number(c[7]), vy: Number(c[8]),
        flags0C: parseInt(c[9]!, 16) | 0, flags10: parseInt(c[10]!, 16) | 0, flags14: parseInt(c[11]!, 16) | 0,
        f18: Number(c[12]), f104: Number(c[15]), f24: dword(0x24),
      },
    });
  }
  return { level: head.level!, steps: Number(head.steps), rows };
}

function ours(world: World, stepNo: number): Row[] {
  const out: Row[] = [];
  const add = (list: string, p: Part, idx: number) =>
    out.push({
      step: stepNo, list, idx, type: p.type,
      v: { x: p.fx, y: p.fy, vx: p.vx, vy: p.vy, flags0C: p.flags0C | 0, flags10: p.flags10 | 0, flags14: p.flags14 | 0, f18: p.frame, f104: p.f104, f24: p.f24 },
    });
  world.mobiles.toArray().forEach((p, i) => add("M", p, i));
  world.statics.toArray().forEach((p, i) => add("S", p, i));
  return out;
}

/** Monde au pas 0 d'un niveau réel, filtré sur `keep` comme le fait le banc (`--keep`) ; liens et bac : ceux du noyau. */
function scenarioWorld(name: string, keep?: ReadonlySet<number>): World {
  const w = new World(realTypes());
  w.loadLevel(readLev(baseIndex().get(`${name}.LEV`)));
  if (keep) for (const list of [w.statics, w.mobiles]) for (const p of list.toArray()) if (!keep.has(p.type)) list.remove(p);
  w.start();
  return w;
}

/** Premier écart (pas, pièce, champ) ou `null`. */
function firstDiff(expected: Row[], world: World, steps: number): string | null {
  let k = 0;
  for (let s = 0; s <= steps; s++) {
    if (s > 0) step(world);
    const mine = ours(world, s);
    const theirs: Row[] = [];
    while (k < expected.length && expected[k]!.step === s) theirs.push(expected[k++]!);
    if (mine.length !== theirs.length) return `pas ${s} : ${theirs.length} pièces attendues, ${mine.length} obtenues`;
    for (let i = 0; i < mine.length; i++) {
      const a = theirs[i]!;
      const b = mine[i]!;
      if (a.type !== b.type) return `pas ${s} ${a.list}${a.idx} : type ${a.type} attendu, ${b.type} obtenu`;
      const fields = ELECTRIC_TYPES.has(a.type) ? [...FIELDS, ...STATE_FIELDS] : FIELDS;
      for (const f of fields) if (a.v[f] !== b.v[f]) return `pas ${s} ${a.list}${a.idx} (type ${a.type}) : ${f} attendu ${a.v[f]}, obtenu ${b.v[f]}`;
    }
  }
  return null;
}

/** Scénarios dont un type de la famille n'est pas encore porté : `TIM3_TRACES_ALL=1` les compare quand même (mesure de l'avancement). */
const all = Boolean(process.env.TIM3_TRACES_ALL);

/**
 * Écarts dus au noyau, pas à la famille : dans ces niveaux, la prise 120 garde un lien +0xA4 vers une fiche du bac que le
 * banc a coupé (débranchement 438fe3 / 43925f au rangement : `4 + fD0` pointe l'autre lien dans `World.unplug`).
 */
const KERNEL_GAPS = new Set(["mirror13.tsv", "sw21out.tsv"]);

describe.skipIf(files.length === 0)("TIM3 electric : scénarios comparés au banc", () => {
  const cases = files.map((file) => {
    const t = parseV2(readFileSync(resolve(DIR, file), "utf8"));
    const [level, keepPart] = t.level.split("-keep");
    const keep = keepPart ? new Set(keepPart.split("_").map(Number)) : undefined;
    return { file, t, level: level!, keep, waiting: scenarioWorld(level!, keep).unportedTypes() };
  });
  for (const c of cases.filter((x) => x.waiting.length > 0 && !all))
    it.skip(`${c.file} (attend : types ${c.waiting.join(", ")})`, () => undefined);
  for (const c of cases.filter((x) => KERNEL_GAPS.has(x.file) && !all)) it.skip(`${c.file} (attend : débranchement du noyau, liens +0xA0 / +0xA4)`, () => undefined);
  it.each(cases.filter((x) => (x.waiting.length === 0 && !KERNEL_GAPS.has(x.file)) || all).map((c) => [c.file, c] as const))("%s", (_file, c) => {
    const diff = firstDiff(c.t.rows, scenarioWorld(c.level, c.keep), c.t.steps);
    expect(diff, diff ?? "").toBeNull();
  });
});

/**
 * Niveaux complets (traces v1 du banc, `test/tim3/traces/<NIVEAU>.tsv`) où la famille intervient. Un niveau qui pose encore un
 * type non porté (ici ou dans un autre groupe) est ignoré ; `TIM3_TRACES_ALL=1` les compare tous.
 */
const levelFiles = original.has && existsSync(TRACE_DIR) ? readdirSync(TRACE_DIR).filter((f) => /^[A-Z]+\d+\.tsv$/.test(f)).sort() : [];
const levels = levelFiles
  .map((file) => {
    const w = scenarioWorld(file.replace(".tsv", ""));
    const mine = [...w.staticThenMobile()].filter((p) => ELECTRIC_TYPES.has(p.type)).length;
    return { file, mine, waiting: w.unportedTypes() };
  })
  .filter((c) => c.mine > 0);

describe.skipIf(levels.length === 0)("TIM3 electric : niveaux complets comparés au banc", () => {
  for (const c of levels.filter((x) => x.waiting.length > 0 && !all))
    it.skip(`${c.file} (attend : types ${c.waiting.join(", ")})`, () => undefined);
  it.each(levels.filter((x) => x.waiting.length === 0 || all).map((c) => c.file))("%s", (file) => {
    const expected = parseTrace(readFileSync(resolve(TRACE_DIR, file), "utf8"));
    const name = file.replace(".tsv", "");
    const actual = parseTrace(traceWorld(scenarioWorld(name), name, Number(expected.header.steps)));
    const diff = firstDifference(expected.rows, actual.rows);
    expect(diff, diff ?? "").toBeNull();
  });
});

// --- logique, sans banc ----------------------------------------------------------------------------------------

/**
 * Pièce seule dans un monde vide. Le jeu ne crée jamais de pièce hors d'un niveau chargé : on refait donc 434141 (gravité et
 * pression par défaut du monde), sans quoi la table de types partagée garde l'atmosphère du dernier niveau chargé par un autre
 * test, ou n'en a aucune (vitesse terminale brute du PAR, 0 pour la pulsation 20).
 */
function lone(type: number, setup?: (p: Part) => void): { world: World; p: Part } {
  const world = new World(realTypes());
  applyAtmosphere(world.types, world.gravity, world.pressure);
  const p = new Part();
  p.type = type;
  p.vertexCount = world.types.get(type).vertexCount;
  setup?.(p);
  world.statics.insertAfter(p, null);
  return { world, p };
}

describe.skipIf(!original.has)("TIM3 electric : logique des handlers", () => {
  it("interrupteur : bascule selon le côté touché, mémorise l'écart avec la position de départ", () => {
    const { world, p } = lone(21);
    world.call(2, p);
    const toucher = new Part();
    toucher.type = 0;
    toucher.contactAngle = 0x4000; // + 0x4000 = 0x8000 : bit 15 posé, sens « vers le bas » : rien
    world.call(0, p, toucher);
    expect(p.frame).toBe(0);
    toucher.contactAngle = 0;
    world.call(0, p, toucher);
    expect(p.frame).toBe(4);
    expect(p.f24).toBe(1);
    expect(world.sounds.map((s) => s.id)).toEqual([0xbcd]);
    toucher.contactAngle = 0x4000;
    world.call(0, p, toucher);
    expect(p.frame).toBe(0);
    expect(p.f24).toBe(0);
  });

  it("source → prises : le slot 1 recopie l'état, la prise 120 force 1, la prise laser remet 0", () => {
    const { world, p: sw } = lone(21);
    const outlet = new Part();
    outlet.type = 120;
    const laserOutlet = new Part();
    laserOutlet.type = 96;
    sw.links[4] = outlet;
    sw.links[5] = laserOutlet;
    sw.f24 = 1;
    world.call(1, sw);
    expect([outlet.f24, laserOutlet.f24, sw.flags10 & 0x40]).toEqual([1, 1, 0x40]);
    const target = new Part();
    outlet.links[4] = target;
    outlet.f24 = 0;
    world.call(1, outlet);
    expect(target.f24).toBe(1);
    laserOutlet.links[5] = target;
    target.f24 = 0;
    world.call(1, laserOutlet);
    expect(target.f24).toBe(1);
    expect(laserOutlet.f24).toBe(0);
  });

  it("prise 120 et prise laser 96 : l'image dit quelles prises sont liées", () => {
    const { world, p } = lone(120);
    p.frame = 7;
    p.links[4] = new Part();
    world.call(2, p);
    expect(p.frame).toBe(5);
    const q = lone(96);
    q.p.frame = 9;
    q.p.links[5] = new Part();
    q.world.call(2, q.p);
    expect(q.p.frame).toBe(2 + 14);
  });

  it("miroir : l'action « tourner » passe à l'orientation suivante, 3 → 0", () => {
    const { world, p } = lone(94);
    p.frame = 3;
    world.call(3, p, 15);
    expect([p.frame, p.editFrame]).toEqual([0, 0]);
    world.call(3, p, 15);
    expect(p.frame).toBe(1);
    world.call(3, p, 0);
    expect(p.frame).toBe(1);
  });

  it("détecteur laser : avance quand il est touché, retombe sinon, et efface son état à chaque pas", () => {
    const { world, p } = lone(148);
    world.call(2, p);
    p.f24 = 1;
    world.call(1, p);
    expect(p.f24).toBe(0);
    expect(p.frame).toBeGreaterThan(0);
    const rest = stateFirst(world, 148, 4);
    world.call(1, p);
    expect(p.frame).toBe(p.frame < rest ? rest : p.frame);
    expect(p.f24).toBe(0);
  });

  it("bouts de corde (22, 29) : l'élan 1 fait avancer la corde, les chocs d'un côté déclenchent", () => {
    for (const t of [22, 29]) {
      const { world, p } = lone(t);
      const rope = new RopeData(p);
      p.ropes[0] = rope;
      expect(world.pull(p, p, 1, 0, 0)).toBe(0);
      expect(rope.n18).toBe(1);
      expect(world.pull(p, p, 2, 0, 0)).toBe(1);
      expect(world.pull(p, p, 4, 0, 0)).toBe(0);
      expect(p.f24).toBe(1);
      expect(world.pull(p, p, 4, 0, 0)).toBe(t === 29 ? 1 : 0);
    }
  });

  it("Super Phazer : à l'image de tir, une pulsation part vers la droite (ou la gauche si retourné)", () => {
    for (const flipped of [false, true]) {
      const { world, p } = lone(27, (q) => {
        q.px = q.py = 100;
        q.flags10 = flipped ? 0x10 : 0;
        q.fFC = 1;
      });
      world.call(2, p);
      p.f24 = 1;
      for (let i = 0; i < 40 && world.mobiles.head === null; i++) world.call(1, p);
      const pulse = world.mobiles.head!;
      expect(pulse.type).toBe(20);
      expect(pulse.vx).toBe(flipped ? -0x3000 : 0x3000);
      expect(pulse.px).toBe(flipped ? 100 - 0x1a : 100 + 0x42);
      expect(pulse.py).toBe(113);
      expect(pulse.flags0C & 0x10).toBe(0x10);
    }
  });

  it("lampe torche : allumée par la bonne face, son image avance jusqu'à 2", () => {
    const { world, p } = lone(25);
    world.call(2, p);
    const toucher = new Part();
    toucher.contactIndex = 1;
    world.call(0, p, toucher);
    expect(p.f24).toBe(0);
    toucher.contactIndex = 0;
    expect(world.call(0, p, toucher)).toBe(1);
    expect(p.f24).toBe(1);
    for (let i = 0; i < 5; i++) world.call(1, p);
    expect(p.frame).toBe(2);
  });
});
