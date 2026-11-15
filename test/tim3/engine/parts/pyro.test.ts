import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readLev, writeLev } from "../../../../src/games/tim3/data/lev";
import { defaultRegistry } from "../../../../src/games/tim3/engine/parts";
import { stateFrame } from "../../../../src/games/tim3/engine/parts/pyro/kernel";
import { step } from "../../../../src/games/tim3/engine/step";
import { World } from "../../../../src/games/tim3/engine/world";
import { baseIndex } from "../../data/real";
import { original, realTypes, TRACE_DIR } from "../helpers";

/** Types de la famille « pyro » (`docs/tim3/parts-pyro.md`). */
const PYRO = [18, 19, 36, 41, 45, 55, 70, 73, 74, 75, 78, 79, 80, 109, 138];
const PYRO_SET = new Set(PYRO);

/**
 * Niveaux modifiés pour les scénarios « allumés » : +0x0A de l'enregistrement (+0xF4, recopié en +0x24 au démarrage)
 * vaut `value` pour les pièces des types listés. Le banc les trace avec `bench.py trace --lev <NOM>.LEV`.
 */
const LIT: Record<string, { base: string; types: number[]; value: number }> = {
  TLEV10F: { base: "TLEV10", types: [80, 36, 70, 78], value: 1 },
  TLEV8F: { base: "TLEV8", types: [138, 45, 78], value: 1 },
  TLEV9F: { base: "TLEV9", types: [19, 55], value: 1 },
  TLEV11F: { base: "TLEV11", types: [18], value: 1 },
  ELEV8F: { base: "ELEV8", types: [79], value: 1 },
  ELEV8P: { base: "ELEV8", types: [79, 109], value: 2 },
  HLEV23F: { base: "HLEV23", types: [138, 19, 36, 70], value: 1 },
  ELEV11F: { base: "ELEV11", types: [80], value: 1 },
  MLEV17F: { base: "MLEV17", types: [73], value: 1 },
  HH11F: { base: "HH11", types: [45, 36, 78], value: 1 },
  ELEV19F: { base: "ELEV19", types: [70], value: 1 },
  TLEV14F: { base: "TLEV14", types: [138, 109], value: 1 },
  HLEV1F: { base: "HLEV1", types: [19, 80, 109, 78, 55], value: 1 },
  TLEV25F: { base: "TLEV25", types: [79, 78], value: 1 },
  ELEV21F: { base: "ELEV21", types: [73, 55], value: 1 },
  MLEV24F: { base: "MLEV24", types: [70], value: 1 },
  HH6F: { base: "HH6", types: [18], value: 1 },
  HH49F: { base: "HH49", types: [18], value: 1 },
  TLEV16F: { base: "TLEV16", types: [36], value: 1 },
  HH29F: { base: "HH29", types: [138, 45], value: 1 },
  HH8F: { base: "HH8", types: [45, 79], value: 1 },
  MLEV9F: { base: "MLEV9", types: [138, 80], value: 1 },
};

function litLevel(name: string) {
  const spec = LIT[name];
  if (!spec) throw new Error(`niveau modifié inconnu : ${name}`);
  const lev = readLev(baseIndex().get(`${spec.base}.LEV`));
  for (const p of [...lev.fixedParts, ...lev.movingParts]) if (spec.types.includes(p.type)) p.unknown0A = spec.value;
  return lev;
}

/** Monde au pas 0 d'un scénario (niveau d'origine ou modifié), réduit aux types conservés comme `bench.py --keep`. */
function scenarioWorld(level: string, lev: string | undefined, keep: Set<number>): World {
  const w = new World(realTypes());
  w.loadLevel(lev ? litLevel(lev.replace(/\.LEV$/i, "")) : readLev(baseIndex().get(`${level}.LEV`)));
  for (const list of [w.statics, w.mobiles]) for (const p of list.toArray()) if (!keep.has(p.type)) list.remove(p);
  w.start();
  return w;
}

/**
 * Lignes comparées : champs du format v1, plus (format v2) la masse +0x5C, et l'image +0x18 et le compteur +0x104 pour
 * les types de la famille (les autres types relèvent d'autres groupes ; +0x104 des murs sert à leurs extrémités).
 */
function rows(w: World, k: number): string[] {
  const hex = (v: number) => (v >>> 0).toString(16).padStart(8, "0");
  const out: string[] = [];
  for (const [tag, list] of [["M", w.mobiles], ["S", w.statics]] as const) {
    let i = 0;
    for (const p of list) {
      const own = PYRO_SET.has(p.type);
      out.push([k, tag, i++, p.type, p.fx, p.fy, p.vx, p.vy, hex(p.flags0C), hex(p.flags10), hex(p.flags14), own ? p.frame : "-", p.mass, own ? p.f104 : "-"].join("\t"));
    }
  }
  return out;
}

/** Lignes M et S d'une trace v2 du banc, par pas, au format de `rows`. */
function expectedRows(text: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const c = line.split("\t");
    if (c[1] !== "M" && c[1] !== "S") continue;
    const own = PYRO_SET.has(Number(c[4]));
    const k = Number(c[0]);
    const r = [c[0], c[1], c[2], c[4], c[5], c[6], c[7], c[8], c[9], c[10], c[11], own ? c[12] : "-", c[13], own ? c[15] : "-"].join("\t");
    let list = out.get(k);
    if (!list) out.set(k, (list = []));
    list.push(r);
  }
  return out;
}

const PYRO_TRACES = resolve(TRACE_DIR, "pyro");
const files = original.has && existsSync(PYRO_TRACES) ? readdirSync(PYRO_TRACES).filter((f) => f.endsWith(".tsv")).sort() : [];

describe.skipIf(!original.has)("TIM3 : famille pyro", () => {
  it("porte tous les handlers de simulation et d'édition de ses types (slots 0, 1, 2, 3, 5)", () => {
    const types = realTypes();
    const registry = defaultRegistry();
    for (const t of PYRO) {
      const d = types.get(t);
      for (const slot of [0, 1, 2, 3, 5]) {
        const a = d.handlers[slot]!;
        if (a !== 0) expect(registry.has(a), `type ${t}, slot ${slot} (${a.toString(16)})`).toBe(true);
      }
    }
  });

  it("lit les débuts d'états dans les ANM comme 44b2c0", () => {
    const w = new World(realTypes());
    // Fin d'ANM (−1) : nombre d'images ; état absent : entrée finale.
    expect(stateFrame(w, 0x13, -1)).toBe(w.types.anims[0x13]!.count);
    expect(stateFrame(w, 0x4a, 3)).toBeGreaterThan(0);
  });

  it("garde les scénarios modifiés relisibles par le lecteur de LEV (aller-retour)", () => {
    for (const name of Object.keys(LIT)) {
      const lev = litLevel(name);
      expect(readLev(writeLev(lev)), name).toEqual(lev);
    }
  });

  /** `TIM3_PYRO_WRITE_LEV=<dossier>` : écrit les LEV modifiés pour le banc (`bench.py trace --lev`). */
  it.skipIf(!process.env.TIM3_PYRO_WRITE_LEV)("écrit les niveaux modifiés pour le banc", () => {
    const dir = process.env.TIM3_PYRO_WRITE_LEV!;
    mkdirSync(dir, { recursive: true });
    for (const name of Object.keys(LIT)) writeFileSync(resolve(dir, `${name}.LEV`), writeLev(litLevel(name)));
  });
});

/**
 * Scénarios minimaux comparés au banc (`test/tim3/traces/pyro/*.tsv`, format v2, locaux et non versionnés ; voir
 * `docs/tim3/parts-pyro.md` pour les produire). Ignoré si les traces manquent.
 */
describe.skipIf(files.length === 0)("TIM3 : scénarios pyro comparés au banc", () => {
  it.each(files)("%s", (file) => {
    const text = readFileSync(resolve(PYRO_TRACES, file), "utf8");
    const head = text.split("\n", 1)[0]!;
    const name = /\tlevel=(\S+)/.exec(head)![1]!;
    const steps = Number(/\tsteps=(\d+)/.exec(head)![1]);
    const lev = /\tlev=(\S+)/.exec(head)?.[1];
    const [level, keepPart] = name.split("-keep");
    const keep = new Set(keepPart!.split("_").map(Number));
    const w = scenarioWorld(level!, lev, keep);
    expect(w.unportedTypes().filter((t) => PYRO_SET.has(t))).toEqual([]);
    const expected = expectedRows(text);
    for (let k = 0; k <= steps; k++) {
      const got = rows(w, k);
      const want = expected.get(k) ?? [];
      if (got.join("\n") !== want.join("\n")) {
        const i = got.findIndex((r, j) => r !== want[j]);
        const at = i === -1 ? got.length : i;
        expect(`${got[at]}`, `pas ${k}, ligne ${at} (step list idx type x y vx vy 0C 10 14 image masse 104)`).toBe(`${want[at]}`);
      }
      if (k < steps) step(w);
    }
  });
});
