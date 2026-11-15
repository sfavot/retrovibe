/**
 * Traces par pas, au format commun avec le banc Unicorn (`TRACE-FORMAT.md` v1, hors dépôt) :
 * `step list idx type x y vx vy flags0C flags10 flags14`, mobiles (M) puis statiques (S), relevé après 433334 et 43abff.
 */
import type { Part } from "./part";
import { step } from "./step";
import type { World } from "./world";

export interface TraceRow {
  step: number;
  list: "M" | "S";
  idx: number;
  type: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  flags0C: number;
  flags10: number;
  flags14: number;
}

export const TRACE_FIELDS = ["step", "list", "idx", "type", "x", "y", "vx", "vy", "flags0C", "flags10", "flags14"] as const;

const hex8 = (v: number) => (v >>> 0).toString(16).padStart(8, "0");

function row(stepNo: number, list: "M" | "S", idx: number, p: Part): TraceRow {
  return { step: stepNo, list, idx, type: p.type, x: p.fx, y: p.fy, vx: p.vx, vy: p.vy, flags0C: p.flags0C >>> 0, flags10: p.flags10 >>> 0, flags14: p.flags14 >>> 0 };
}

/** Lignes d'un pas (état courant du monde). */
export function snapshot(world: World, stepNo: number): TraceRow[] {
  const out: TraceRow[] = [];
  world.mobiles.toArray().forEach((p, i) => out.push(row(stepNo, "M", i, p)));
  world.statics.toArray().forEach((p, i) => out.push(row(stepNo, "S", i, p)));
  return out;
}

export function formatRow(r: TraceRow): string {
  return [r.step, r.list, r.idx, r.type, r.x, r.y, r.vx, r.vy, hex8(r.flags0C), hex8(r.flags10), hex8(r.flags14)].join("\t");
}

/** Fait `steps` pas et rend la trace complète (pas 0 … steps), avec l'en-tête du banc. */
export function traceWorld(world: World, level: string, steps: number): string {
  const lines = [
    `# tim3-trace v1\tlevel=${level}\tsteps=${steps}\tpressure=${world.pressure}\tgravity=${world.gravity}`,
    `# ${TRACE_FIELDS.join("\t")}`,
  ];
  for (let k = 0; ; k++) {
    for (const r of snapshot(world, k)) lines.push(formatRow(r));
    if (k === steps) break;
    step(world);
  }
  return lines.join("\n") + "\n";
}

export function parseTrace(text: string): { header: Record<string, string>; rows: TraceRow[] } {
  const header: Record<string, string> = {};
  const rows: TraceRow[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    if (line.startsWith("#")) {
      if (line.startsWith("# tim3-trace")) for (const kv of line.split("\t").slice(1)) header[kv.split("=")[0]!] = kv.split("=")[1]!;
      continue;
    }
    const f = line.split("\t");
    rows.push({
      step: +f[0]!,
      list: f[1] as "M" | "S",
      idx: +f[2]!,
      type: +f[3]!,
      x: +f[4]!,
      y: +f[5]!,
      vx: +f[6]!,
      vy: +f[7]!,
      flags0C: parseInt(f[8]!, 16),
      flags10: parseInt(f[9]!, 16),
      flags14: parseInt(f[10]!, 16),
    });
  }
  return { header, rows };
}

/** Premier écart entre deux traces, avec les lignes attendues et obtenues du même pas ; `null` si identiques. */
export function firstDifference(expected: TraceRow[], actual: TraceRow[]): string | null {
  const n = Math.max(expected.length, actual.length);
  for (let i = 0; i < n; i++) {
    const e = expected[i];
    const a = actual[i];
    let field: string | null = null;
    if (!e || !a) field = "ligne";
    else for (const f of TRACE_FIELDS) if (e[f] !== a[f]) {
      field = f;
      break;
    }
    if (!field) continue;
    const stepNo = (e ?? a)!.step;
    const ctx = (rows: TraceRow[]) => rows.filter((r) => r.step === stepNo).map((r) => "  " + formatRow(r)).join("\n");
    return [
      `premier écart au pas ${stepNo}, ${e ? `${e.list}${e.idx}` : "?"} (type ${e?.type ?? a?.type}), champ ${field} : attendu ${e ? String(e[field as keyof TraceRow] ?? "") : "(absent)"}, obtenu ${a ? String(a[field as keyof TraceRow] ?? "") : "(absent)"}`,
      "attendu (banc) :",
      ctx(expected),
      "obtenu (moteur) :",
      ctx(actual),
    ].join("\n");
  }
  return null;
}
