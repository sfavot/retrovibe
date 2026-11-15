import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ARCTAN, ARCTAN_VA } from "../../../src/games/tim3/data/tables/arctan";
import { COSINE_Q14, COSINE_VA } from "../../../src/games/tim3/data/tables/cosine";
import { DESCRIPTOR_WORDS, TYPE_DESCRIPTOR_VA, TYPE_TABLE_VA } from "../../../src/games/tim3/data/tables/descriptors";
import { QUAD_DX, QUAD_DX_VA, QUAD_DY, QUAD_DY_VA } from "../../../src/games/tim3/data/tables/quadrants";
import { RNG_I0, RNG_J0, RNG_TABLE0, RNG_TABLE_VA } from "../../../src/games/tim3/data/tables/random";
import { original, realTypes, TRACE_DIR } from "./helpers";

/** Lecture d'une adresse de l'image de TIMWIN.EXE (sections du PE, base 0x400000). */
function imageReader(exe: Uint8Array): (va: number, n: number) => Uint8Array {
  const dv = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const pe = dv.getUint32(0x3c, true);
  const count = dv.getUint16(pe + 6, true);
  let off = pe + 24 + dv.getUint16(pe + 20, true);
  const sections: { va: number; raw: number; size: number }[] = [];
  for (let i = 0; i < count; i++, off += 40)
    sections.push({ va: 0x400000 + dv.getUint32(off + 12, true), size: dv.getUint32(off + 16, true), raw: dv.getUint32(off + 20, true) });
  return (va, n) => {
    const s = sections.find((x) => x.va <= va && va + n <= x.va + x.size);
    if (!s) throw new Error(`adresse ${va.toString(16)} hors des sections`);
    return Uint8Array.from(exe.subarray(s.raw + va - s.va, s.raw + va - s.va + n));
  };
}

const bytesOf = (a: ArrayLike<number>, size: 2 | 4, signed = false) => {
  const out = new Uint8Array(a.length * size);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < a.length; i++) {
    if (size === 2) (signed ? dv.setInt16 : dv.setUint16).call(dv, 2 * i, a[i]!, true);
    else (signed ? dv.setInt32 : dv.setUint32).call(dv, 4 * i, a[i]!, true);
  }
  return out;
};

describe.skipIf(!original.has)("TIM3 : tables générées identiques à TIMWIN.EXE (D13)", () => {
  const read = imageReader(original.has ? original.read("TIMWIN.EXE") : new Uint8Array());

  it("cosinus, arctangente, quadrants et générateur, octet pour octet", () => {
    expect(bytesOf(COSINE_Q14, 2, true)).toEqual(read(COSINE_VA, 2 * 2049));
    expect(bytesOf(ARCTAN, 4)).toEqual(read(ARCTAN_VA, 4 * 512));
    expect(bytesOf(QUAD_DX, 4, true)).toEqual(read(QUAD_DX_VA, 16));
    expect(bytesOf(QUAD_DY, 4, true)).toEqual(read(QUAD_DY_VA, 16));
    expect(bytesOf(RNG_TABLE0, 4)).toEqual(read(RNG_TABLE_VA, 4 * 56));
    expect(bytesOf([RNG_I0, RNG_J0], 4)).toEqual(read(0x479614, 8));
  });

  it("table des types et descripteurs statiques", () => {
    expect(bytesOf(TYPE_DESCRIPTOR_VA, 4)).toEqual(read(TYPE_TABLE_VA, 4 * 281));
    for (const [va, words] of DESCRIPTOR_WORDS) expect(bytesOf(words, 4)).toEqual(read(va, 0x70));
  });
});

const DESC_DUMP = resolve(TRACE_DIR, "descriptors.json");

/** Descripteurs après le démarrage, relevés dans le banc (hors dépôt) : ce que construit `TypeTable`. */
describe.skipIf(!original.has || !existsSync(DESC_DUMP))("TIM3 : descripteurs construits comme au démarrage du jeu", () => {
  it("champs PAR, tailles et polygones de chaque type", () => {
    const dump = JSON.parse(readFileSync(DESC_DUMP, "utf8")) as { t: number; raw: string; polys: number[][][] }[];
    const types = realTypes();
    const bad: string[] = [];
    for (const { t, raw, polys } of dump) {
      const d = types.get(t);
      const w = new DataView(Uint8Array.from(raw.match(/../g)!.map((h) => parseInt(h, 16))).buffer);
      const at = (o: number) => w.getInt32(o, true);
      const fields: [string, number, number][] = [
        ["+24", d.vertexCount, at(0x24)],
        ["+28", d.flags0C, at(0x28)],
        ["+2c", d.flags10, at(0x2c)],
        ["+30", d.flags14, at(0x30)],
        ["+34", d.boxW, at(0x34)],
        ["+38", d.boxH, at(0x38)],
        ["+3c", d.f3C, at(0x3c)],
        ["+40", d.f40, at(0x40)],
        ["+44", d.f44, at(0x44)],
        ["+48", d.f48, at(0x48)],
        ["+4c", d.density, at(0x4c)],
        ["+50", d.mass, at(0x50)],
        ["+54", d.elasticity, at(0x54)],
        ["+58", d.friction, at(0x58)],
        ["+60", d.terminal, at(0x60)],
        ["+64", d.shapeW, at(0x64)],
        ["+68", d.shapeH, at(0x68)],
      ];
      const handlers = Array.from({ length: 8 }, (_, i) => w.getUint32(4 * i, true)).join();
      if (d.handlers.join() !== handlers) bad.push(`${t} handlers`);
      for (const [name, mine, theirs] of fields) if (mine !== theirs) bad.push(`${t} ${name} : ${mine} au lieu de ${theirs}`);
      const mine = (d.polygons ?? []).map((p) => Array.from({ length: d.vertexCount }, (_, k) => [p.x[k], p.y[k]]));
      if (JSON.stringify(mine) !== JSON.stringify(polys.map((p) => p.map(([x, y]) => [x, y])))) bad.push(`${t} polygones`);
    }
    expect(bad).toEqual([]);
  });
});
