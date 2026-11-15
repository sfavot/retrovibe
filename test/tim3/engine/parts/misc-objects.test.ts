import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readLev } from "../../../../src/games/tim3/data/lev";
import { defaultRegistry } from "../../../../src/games/tim3/engine/parts";
import { anchorOf, reactToCollision, registerObjects, tackOrientation } from "../../../../src/games/tim3/engine/parts/misc/objects";
import { firstDifference, parseTrace, traceWorld } from "../../../../src/games/tim3/engine/trace";
import { World } from "../../../../src/games/tim3/engine/world";
import { baseIndex } from "../../data/real";
import { step } from "../../../../src/games/tim3/engine/step";
import { original, readTrace, realTypes, TRACE_DIR, traceFiles } from "../helpers";

/**
 * Groupe `misc`, objets simples : ballon (4), panier (11), aquarium (15), punaise (53), boîtes (71), cheville (72).
 * Scénarios minimaux (`--keep` : les types du groupe plus les murs, pentes et balles de Φ1) comparés au banc.
 */
const MINE = new Set([4, 11, 15, 53, 71, 72]);

function worldOf(level: string, keep: Set<number>): World {
  const r = defaultRegistry();
  if (!r.has(0x43f1c8)) registerObjects(r);
  const w = new World(realTypes(), r);
  w.loadLevel(readLev(baseIndex().get(`${level}.LEV`)));
  for (const list of [w.statics, w.mobiles]) for (const p of list.toArray()) if (!keep.has(p.type)) list.remove(p);
  w.start();
  // Les souches du chargement (slot 2 des pièces ensuite retirées) ne comptent pas : seul le pas compte.
  w.log.stubs.clear();
  return w;
}

const V2_DIR = resolve(TRACE_DIR, "v2");
const v2Files = original.has && existsSync(V2_DIR) ? readdirSync(V2_DIR).filter((f) => f.startsWith("misc-") && f.endsWith(".tsv")).sort() : [];

/**
 * Scénarios où une pièce du groupe est au bout d'une corde (+0xA8 non nul dans la trace v2) : la tension des cordes
 * (43a31d, groupe `mechanics`) tient la pièce en place dans le jeu ; elle attend le noyau des cordes.
 */
const ropeBound = new Set(
  v2Files.filter((f) =>
    readFileSync(resolve(V2_DIR, f), "utf8")
      .split("\n")
      .some((l) => {
        const c = l.split("\t");
        return c[0] === "0" && (c[1] === "M" || c[1] === "S") && MINE.has(Number(c[4])) && c[23] !== "-" && c[23] !== undefined;
      }),
  ),
);

const files = original.has ? traceFiles().filter((f) => f.startsWith("misc-") && /-keep(?:4|11|15|53|71|72)(?:_|\.)/.test(f) && !ropeBound.has(f)) : [];

describe.skipIf(files.length === 0)("TIM3 misc : objets simples comparés au banc", () => {
  it.each(files)("%s", (file) => {
    const expected = parseTrace(readTrace(file));
    const name = expected.header.level!;
    const [level, keepPart] = name.split("-keep");
    const keep = new Set(keepPart!.split("_").map(Number));
    const w = worldOf(level!, keep);
    const steps = Number(expected.header.steps);
    const actual = parseTrace(traceWorld(w, name, steps));
    const diff = firstDifference(expected.rows, actual.rows);
    expect(diff, diff ?? "").toBeNull();
    for (const addr of w.log.stubs.keys()) expect(addr, `souche ${addr} dans ${file}`).toBe("none");
    expect(w.unportedTypes().filter((t) => MINE.has(t))).toEqual([]);
  });
});

describe.skipIf(!original.has)("TIM3 misc : objets simples, cas unitaires", () => {
  it("enregistre toutes les adresses de slots 0, 1, 2, 3, 5 des types du groupe", () => {
    const r = defaultRegistry();
    if (!r.has(0x43f1c8)) registerObjects(r);
    const t = realTypes();
    for (const type of MINE)
      for (const slot of [0, 1, 2, 3, 5]) {
        const a = t.get(type).handlers[slot]!;
        if (a !== 0) expect(r.has(a), `type ${type} slot ${slot} ${a.toString(16)}`).toBe(true);
      }
  });
});

/**
 * Traces v2 du banc (`test/tim3/traces/v2/misc-*.tsv`) : en plus de la position, de la vitesse et des drapeaux,
 * l'image (+0x18), la masse (+0x5C) et le compteur +0x104 de chaque pièce des listes M et S.
 */
describe.skipIf(v2Files.length === 0)("TIM3 misc : objets simples, traces v2 (image, masse, compteur)", () => {
  for (const f of v2Files.filter((x) => ropeBound.has(x))) it.skip(`${f} (attend les cordes : 43a31d, mechanics)`, () => undefined);
  it.each(v2Files.filter((x) => !ropeBound.has(x)))("%s", (file) => {
    const text = readFileSync(resolve(V2_DIR, file), "utf8").split("\n");
    const head = Object.fromEntries(text[0]!.split("\t").slice(1).map((kv) => kv.split("=") as [string, string]));
    const name = head.level!;
    const [level, keepPart] = name.split("-keep");
    const w = worldOf(level!, new Set(keepPart!.split("_").map(Number)));
    const byStep = new Map<number, string[]>();
    for (const l of text) {
      if (!l || l[0] === "#") continue;
      const c = l.split("\t");
      if (c[1] !== "M" && c[1] !== "S") continue;
      const k = Number(c[0]);
      // step list idx slot type x y vx vy f0C f10 f14 f18 f5C fE2 f104
      const mineType = MINE.has(Number(c[4]));
      const row = [c[1], c[2], c[4], c[5], c[6], c[7], c[8], c[9], c[10], c[11], ...(mineType ? [c[12], c[13], c[15]] : [])].join(" ");
      (byStep.get(k) ?? byStep.set(k, []).get(k)!).push(row);
    }
    const hex = (v: number) => (v >>> 0).toString(16).padStart(8, "0");
    const mine = () => {
      const rows: string[] = [];
      for (const [tag, list] of [["M", w.mobiles], ["S", w.statics]] as const) {
        let i = 0;
        for (const p of list) rows.push([tag, i++, p.type, p.fx, p.fy, p.vx, p.vy, hex(p.flags0C), hex(p.flags10), hex(p.flags14), ...(MINE.has(p.type) ? [p.frame, p.mass, p.f104] : [])].join(" "));
      }
      return rows;
    };
    const steps = Number(head.steps);
    for (let k = 0; k <= steps; k++) {
      const exp = byStep.get(k)!;
      const got = mine();
      for (let i = 0; i < Math.max(exp.length, got.length); i++)
        if (exp[i] !== got[i]) throw new Error(`pas ${k}, ligne ${i} (liste idx type x y vx vy f0C f10 f14 image masse +104)\nattendu ${exp[i]}\nobtenu  ${got[i]}`);
      if (k < steps) step(w);
    }
    for (const addr of w.log.stubs.keys()) expect(addr, `souche ${addr}`).toBe("none");
  });
});

describe.skipIf(!original.has)("TIM3 misc : objets simples, unitaires", () => {
  it("ballon : la punaise le perce par la pointe, pas par le côté", () => {
    const w = worldOf("ELEV9", new Set([4, 53]));
    const balloon = [...w.mobiles].find((p) => p.type === 4)!;
    const tack = [...w.statics].find((p) => p.type === 53)!;
    balloon.contact = tack;
    balloon.contactIndex = 2;
    balloon.flags10 |= 0x1000;
    // Angle du côté piquant selon l'orientation de la punaise (0x4780c0) : la somme est nulle (bit 15 nul) : perce.
    const side = [0x4000, 0xc000, 0, 0x8000][tackOrientation(w, tack)]!;
    balloon.contactAngle = (0x10000 - side) & 0xffff;
    expect(w.call(0, tack, balloon)).toBe(1);
    expect(balloon.f24).toBe(1);
    balloon.f24 = 0;
    balloon.contactAngle = (0x8000 - side) & 0xffff;
    expect(w.call(0, tack, balloon)).toBe(1);
    expect(balloon.f24).toBe(0);
  });

  it("réaction des pièces à la corde : seuil de quantité de mouvement, mode 1 sans effet sur la pièce", () => {
    const w = worldOf("ELEV7", new Set([4, 53]));
    const [self, other] = [...w.mobiles].filter((p) => p.type === 4);
    self!.momentum = 100;
    other!.type = 0;
    expect(reactToCollision(w, other!, self!, 0, 150, false)).toBe(1);
    expect(reactToCollision(w, other!, self!, 0, 200, false)).toBe(0);
    other!.type = 3;
    expect(reactToCollision(w, other!, self!, 0, 99, false)).toBe(1);
    expect(reactToCollision(w, other!, self!, 0, 100, false)).toBe(0);
    expect(reactToCollision(w, other!, self!, 1, 0, false)).toBe(0);
  });

  it("panier : mode 2 enfonce la pièce de 20 px", () => {
    const w = worldOf("TLEV37", new Set([11]));
    const basket = [...w.mobiles].find((p) => p.type === 11)!;
    const y = basket.py;
    expect(reactToCollision(w, basket, basket, 2, 10_000_000, true)).toBe(0);
    expect(basket.py).toBe(y - 0x14);
    expect(basket.f24).toBe(1);
    expect(anchorOf(basket)).toEqual([0x1f, 2]);
  });
});
