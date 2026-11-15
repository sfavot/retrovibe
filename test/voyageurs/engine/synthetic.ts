/** Données synthétiques pour les tests du moteur : bytecode, PRC, REL, OBJ, MSG, bundle et `AUTO00.PRC` chiffré. */
import { FW_OPCODES } from "../../../src/games/voyageurs/engine/script/opcodes";
import type { VoyageursFiles } from "../../../src/games/voyageurs/engine/part";

export const w = (v: number) => [(v >> 8) & 0xff, v & 0xff];
export const s = (text: string) => [...Buffer.from(text, "latin1"), 0];

export function code(name: string): number {
  const index = FW_OPCODES.findIndex((entry) => entry?.name === name);
  if (index < 0) throw new Error(`opcode inconnu ${name}`);
  return index + 1;
}

export type Op = (string | number | number[])[];

export function bytecode(...ops: Op[]): number[] {
  const out: number[] = [];
  for (const [name, ...args] of ops) {
    out.push(code(name as string));
    for (const a of args) out.push(...(Array.isArray(a) ? a : [a as number]));
  }
  return out;
}

/** Marque l'ordre d'exécution : globale 50 = globale 50 × 10 + `id`. */
export function mark(id: number): Op[] {
  return [
    ["loadVar", 49, 2, 50],
    ["mulVar", 49, 0, w(10)],
    ["addVar", 49, 0, w(id)],
    ["loadGlobalVar", 50, 1, 49],
  ];
}

export function prc(scripts: number[][]): Uint8Array {
  return Uint8Array.from([...w(scripts.length), ...scripts.flatMap((sc) => w(sc.length)), ...scripts.flat()]);
}

export function rel(entries: { verb: number; obj: number; obj2?: number; script: number[] }[]): Uint8Array {
  return Uint8Array.from([
    ...w(entries.length),
    ...entries.flatMap((e) => [...w(e.script.length), ...w(e.verb), ...w(e.obj), ...w(e.obj2 ?? 0xffff)]),
    ...entries.flatMap((e) => e.script),
  ]);
}

export function obj(entries: { x?: number; y?: number; mask?: number; frame?: number; costume?: number; name?: string; part?: number }[]): Uint8Array {
  const out = [...w(entries.length), ...w(32)];
  for (const e of entries) {
    const name = Buffer.alloc(20);
    name.write(e.name ?? "", "latin1");
    out.push(...w(e.x ?? 0), ...w(e.y ?? 0), ...w(e.mask ?? 0), ...w(e.frame ?? 0), ...w((e.costume ?? 0) & 0xffff), ...name, ...w(e.part ?? 0));
  }
  return Uint8Array.from(out);
}

export function msg(texts: string[]): Uint8Array {
  const bodies = texts.map((t) => s(t));
  return Uint8Array.from([...w(texts.length), ...bodies.flatMap((b) => w(b.length)), ...bodies.flat()]);
}

/** Bundle `PARTxx` non compressé (tailles égales : copie). */
export function bundle(files: Record<string, Uint8Array>): Uint8Array {
  const names = Object.keys(files);
  let offset = 4 + names.length * 30;
  const header: number[] = [...w(names.length), ...w(30)];
  const body: number[] = [];
  for (const name of names) {
    const data = files[name]!;
    const raw = Buffer.alloc(14);
    raw.write(name, "latin1");
    const u32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    header.push(...raw, ...u32(offset), ...u32(data.length), ...u32(data.length), ...u32(0));
    body.push(...data);
    offset += data.length;
  }
  return Uint8Array.from([...header, ...body]);
}

/** `AUTO00.PRC` de la version Sony : chaque octet tourné d'un bit vers la droite. */
export function encryptBoot(data: Uint8Array): Uint8Array {
  return data.map((b) => ((b >> 1) | (b << 7)) & 0xff);
}

/** Fichiers : `AUTO00.PRC` (scripts donnés, script 1 au démarrage) et bundles. */
export function gameFiles(boot: number[][], bundles: Record<string, Record<string, Uint8Array>> = {}): VoyageursFiles {
  const files = new Map<string, Uint8Array>([["AUTO00.PRC", encryptBoot(prc(boot))]]);
  for (const [name, content] of Object.entries(bundles)) files.set(name, bundle(content));
  return { read: (name) => files.get(name) ?? null };
}
