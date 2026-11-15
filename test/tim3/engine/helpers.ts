import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readAnm } from "../../../src/games/tim3/data/anm";
import { readLev } from "../../../src/games/tim3/data/lev";
import { readPartDef } from "../../../src/games/tim3/data/part-def";
import { TypeTable } from "../../../src/games/tim3/engine/types";
import { World } from "../../../src/games/tim3/engine/world";
import { baseIndex } from "../data/real";

export { original } from "../data/real";

let table: TypeTable | undefined;

/** Table des types construite depuis les ANM et PAR réels (une fois : elle ne dépend pas du niveau, sauf 434141). */
export function realTypes(): TypeTable {
  const index = baseIndex();
  table ??= new TypeTable({
    anm: (t) => (index.has(`PART${t}.ANM`) ? readAnm(index.get(`PART${t}.ANM`)) : null),
    par: (t) => (index.has(`PART${t}.PAR`) ? readPartDef(index.get(`PART${t}.PAR`)) : null),
  });
  return table;
}

export function levelNames(): string[] {
  const out: string[] = [];
  for (const [prefix, n] of [["TLEV", 40], ["ELEV", 26], ["MLEV", 30], ["HLEV", 31], ["RLEV", 29], ["HH", 50]] as const)
    for (let i = 1; i <= n; i++) out.push(`${prefix}${i}`);
  return out;
}

/** Monde au pas 0 d'un niveau réel ; `keep` : ne garder que ces types (scénario minimal du banc, `--keep`). */
export function realWorld(name: string, keep?: ReadonlySet<number>): World {
  const level = readLev(baseIndex().get(`${name}.LEV`));
  const w = new World(realTypes());
  w.loadLevel(level);
  if (keep) {
    for (const list of [w.statics, w.mobiles]) for (const p of list.toArray()) if (!keep.has(p.type)) list.remove(p);
    // Le chargement (43173e) a appelé le slot 2 de toutes les pièces, comme l'exe ; on n'en garde pas les souches des
    // types retirés du scénario.
    w.log.stubs.clear();
  }
  w.start();
  return w;
}

/** Traces de référence locales (banc Unicorn), non versionnées. */
export const TRACE_DIR = resolve(import.meta.dirname, "../traces");

export function traceFiles(): string[] {
  return existsSync(TRACE_DIR) ? readdirSync(TRACE_DIR).filter((f) => f.endsWith(".tsv")).sort() : [];
}

export function readTrace(file: string): string {
  return readFileSync(resolve(TRACE_DIR, file), "utf8");
}
