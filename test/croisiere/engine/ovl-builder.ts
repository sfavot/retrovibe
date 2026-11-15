/**
 * Fabrique d'overlays `.OVL` synthétiques (format de `docs/croisiere/formats.md` § 3.6) et petit assembleur de bytecode, pour les
 * tests unitaires de la VM, de l'éditeur de liens, des objets et des cellules.
 */
import type { GameFiles } from "../../../src/games/croisiere/engine/overlays";

export interface ScriptSpec {
  code: number[];
  /** Chaînes du script (espace mémoire 2), placées après le code. */
  strings?: number[];
  /** Taille du BSS du processus. */
  bss?: number;
  /** Imports du script : instruction à `offset`, symbole `OVL.NOM` (`:s` = sous-fonction). */
  imports?: { type: number; offset: number; name: string }[];
}

export interface ObjectSpec {
  /** 0 MULTIPLE, 1 VARIABLE, 2 UNIQUE, 3 THEME. */
  cls: number;
  numStates?: number;
  varTableIdx?: number;
  firstStateIdx?: number;
  stateTableIdx?: number;
}

export interface OverlaySpec {
  procs?: ScriptSpec[];
  rels?: ScriptSpec[];
  exports?: { name: string; type: number; idx: number }[];
  objects?: ObjectSpec[];
  /** États : [X, Y, Z, frame, scale, state]. */
  states?: number[][];
  numObjVars?: number;
  bss?: number;
  initData?: number[];
}

const words = (out: number[], ...values: number[]) => values.forEach((v) => out.push((v >> 8) & 255, v & 255));
const latin1 = (s: string) => [...s].map((c) => c.charCodeAt(0));

function block(spec: ScriptSpec): { header: number[]; data: number[] } {
  const data = [...spec.code];
  const offsetToSubData3 = data.length;
  data.push(...(spec.strings ?? []));
  const imports = spec.imports ?? [];
  const offsetToImportData = imports.length ? data.length : 0;
  const names: number[] = [];
  const table: number[] = [];
  for (const imp of imports) {
    words(table, 0, 0, imp.type, imp.offset, names.length);
    names.push(...latin1(imp.name), 0);
  }
  data.push(...table);
  const offsetToImportName = imports.length ? data.length : 0;
  data.push(...names);
  if (data.length % 2) data.push(0);
  const header: number[] = [0, 0, 0, 0];
  words(header, data.length, offsetToSubData3, offsetToImportData, 0, offsetToImportName, 0, spec.bss ?? 0, 0, imports.length, 0, 0, 0);
  return { header, data };
}

/** Octets d'un `.OVL` sans textes (`numStrings` = 0). */
export function buildOverlay(spec: OverlaySpec): Uint8Array {
  const out: number[] = new Array(60).fill(0);
  const procs = (spec.procs ?? []).map(block);
  const rels = (spec.rels ?? []).map(block);
  const exports = spec.exports ?? [];
  const exportNames: number[] = [];
  const exportRows: number[] = [];
  for (const e of exports) {
    words(exportRows, 0, 0, e.type, e.idx, exportNames.length);
    exportNames.push(...latin1(e.name), 0);
  }
  const objects = spec.objects ?? [];
  const states = spec.states ?? [];
  const initData = spec.initData ?? [];
  words(out, procs.length, rels.length, exports.length, 0, 0, objects.length, 0, states.length, spec.numObjVars ?? 0);
  words(out, 0, exportNames.length, 0, spec.bss ?? 0, initData.length, 0, 0);
  out.push(...exportRows, ...exportNames);
  for (const p of procs) out.push(...p.header);
  for (const p of procs) out.push(...p.data);
  for (const r of rels) out.push(...r.header);
  for (const r of rels) out.push(...r.data);
  out.push(...initData);
  for (const o of objects) words(out, 0, o.cls, 0, o.numStates ?? 1, o.varTableIdx ?? 0, o.firstStateIdx ?? 0, o.stateTableIdx ?? 0);
  for (const s of states) words(out, ...s);
  return Uint8Array.from(out);
}

/** Fichiers en mémoire (`NOM.OVL` -> octets). */
export function memoryFiles(files: Record<string, Uint8Array>): GameFiles {
  return {
    has: (name) => name.toUpperCase() in files,
    readFile: (name) => {
      const f = files[name.toUpperCase()];
      if (!f) throw new Error(`absent : ${name}`);
      return f.slice();
    },
  };
}

/** Assembleur minimal (octet d'opcode = type << 3 | sous-type, types de 1 à 12). */
export const asm = {
  push: (v: number) => [0x08, (v >> 8) & 255, v & 255],
  /** Variable : espace (1 BSS du processus, 2 chaînes, 5 BSS de l'overlay, 6 données), taille (1 mot, 2 octet). */
  load: (space: number, offset: number, size = 1, ovl = 0, indexed = false) => [indexed ? 0x0d : 0x09, space | (size << 3), ovl, (offset >> 8) & 255, offset & 255],
  store: (space: number, offset: number, size = 1, ovl = 0, indexed = false) => [indexed ? 0x15 : 0x11, space | (size << 3), ovl, (offset >> 8) & 255, offset & 255],
  setIndex: () => [0x14],
  loadObj: (mode: number, obj: number, ovl = 0) => [0x0a, mode, ovl, (obj >> 8) & 255, obj & 255],
  storeObj: (mode: number, obj: number, ovl = 0) => [0x12, mode, ovl, (obj >> 8) & 255, obj & 255],
  addr: (space: number, offset: number, size = 2) => [0x19, space | (size << 3), 0, (offset >> 8) & 255, offset & 255],
  /** 0 + 1 / 2 - 3 * 4 % 5 | 6 &. */
  math: (sub: number) => [0x20 | sub],
  /** 0 != 1 == 2 < 3 <= 4 > 5 >=. */
  test: (sub: number) => [0x28 | sub],
  /** Saut relatif depuis l'adresse de l'opérande. */
  jump: (sub: number, rel: number) => [0x30 | sub, (rel >> 8) & 255, rel & 255],
  ccr: () => [0x38],
  swap: () => [0x40],
  call: (native: number) => [0x48, native],
  stop: () => [0x50],
  nop: () => [0x58],
  yield: () => [0x60],
};
