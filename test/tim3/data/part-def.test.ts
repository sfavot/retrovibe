import { describe, expect, it } from "vitest";
import { readPartDef, VERTEX_LAST } from "../../../src/games/tim3/data/part-def";
import { baseIndex, original } from "./real";

function par(id: number, words: number[], polygons: number[][]): Uint8Array {
  const body = [0x50, 0x52, 0x4f, 0x50, 0x49, 1, id & 255, id >> 8];
  const all = [...words, ...polygons.flat()];
  for (const w of all) body.push(w & 255, w >> 8);
  const out = new Uint8Array(8 + body.length);
  out.set([0x50, 0x41, 0x52, 0x3a]);
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

describe("PAR", () => {
  // densité, masse, élasticité, drapeaux, 0, f, f, a, b, largeur, hauteur, forme, nPolygones, nSommets
  const head = [2832, 200, 128, 16, 0, 240, 240, 0, 0, 32, 32, 0, 1, 3];

  it("lit les champs et un polygone", () => {
    const def = readPartDef(par(7, head, [[1, 2, 0, 5, 6, 0, 7, 8, VERTEX_LAST, 9, 10]]));
    expect(def).toMatchObject({ id: 7, density: 2832, mass: 200, elasticity: 128, flags: 16, width: 32, height: 32, shapeFlags: 0 });
    expect(def.polygons).toEqual([
      {
        unknownA: 1,
        unknownB: 2,
        vertices: [
          { flag: 0, x: 5, y: 6 },
          { flag: 0, x: 7, y: 8 },
          { flag: VERTEX_LAST, x: 9, y: 10 },
        ],
      },
    ]);
  });

  it("accepte une pièce sans polygone", () => {
    expect(readPartDef(par(1, [...head.slice(0, 12), 0, 0], [])).polygons).toEqual([]);
  });

  it("refuse un total de sommets faux, un reste, un polygone tronqué", () => {
    const poly = [[0, 0, 0, 1, 1, VERTEX_LAST, 2, 2]];
    expect(() => readPartDef(par(0, [...head.slice(0, 13), 4], poly))).toThrow(/sommets/);
    expect(() => readPartDef(par(0, [...head.slice(0, 13), 2], [...poly, [1]]))).toThrow(/octets|taille/);
    expect(() => readPartDef(par(0, [...head.slice(0, 13), 2], [[0, 0, 0, 1, 1]]))).toThrow(/tronqué/);
    expect(() => readPartDef(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/PAR/);
  });
});

describe.skipIf(!original.has)("PAR réels", () => {
  it("lit les 149 fichiers jusqu'au dernier octet", () => {
    const defs = Array.from({ length: 149 }, (_, i) => readPartDef(baseIndex().get(`PART${i}.PAR`)));
    defs.forEach((d, i) => expect(d.id).toBe(i));
    for (const d of defs) {
      for (const p of d.polygons) {
        expect(p.vertices.length).toBeGreaterThanOrEqual(1);
        expect(p.vertices.slice(0, -1).every((v) => v.flag === 0)).toBe(true);
        expect(p.vertices[p.vertices.length - 1].flag).toBe(VERTEX_LAST);
      }
    }
  });

  it("la boule de bowling est un octogone 32×32, le ballon a des polygones multiples", () => {
    const bowling = readPartDef(baseIndex().get("PART0.PAR"));
    expect([bowling.density, bowling.mass, bowling.elasticity, bowling.width, bowling.height]).toEqual([2832, 200, 128, 32, 32]);
    expect(bowling.polygons).toHaveLength(1);
    expect(bowling.polygons[0].vertices.map((v) => [v.x, v.y])).toEqual([
      [8, 0], [23, 0], [31, 8], [31, 23], [23, 31], [8, 31], [0, 23], [0, 8],
    ]);
    expect(readPartDef(baseIndex().get("PART4.PAR")).polygons).toHaveLength(4);
  });
});
