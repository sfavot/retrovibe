import { describe, expect, it } from "vitest";
import { parseBd } from "../../src/games/swiv3d/data/bd";
import { listModels, parseModel } from "../../src/games/swiv3d/data/model";
import { hasOriginalFiles, listOriginal, readOriginal } from "./helpers";

const FACE_KIND_FLAT = 0x28;

function i32s(...values: number[]): number[] {
  return values.flatMap((v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
}

function i16s(...values: number[]): number[] {
  return values.flatMap((v) => [v & 0xff, (v >> 8) & 0xff]);
}

/** Un triangle : 3 sommets, 3 normales, texture 16, u/v, type 0. */
function syntheticModel(): Uint8Array {
  const header = i32s(3, 1, 1, 50, -2, 40, 0x20 + 3 * 16, 0x20 + 3 * 16 + 42);
  const vertices = [...i32s(0, 0, 0, 0), ...i32s(10, 0, 0, 0), ...i32s(0, 10, 0, 1)];
  const face = [...i32s(0, 1, 2, 0, 0, 0, 16), ...i16s(1, 2, 3, -4, -5, -6, 0x0200)];
  const normal = i32s(0, 0, 100);
  return Uint8Array.from([...header, ...vertices, ...face, ...normal]);
}

describe("modèles 3D (données synthétiques)", () => {
  it("lit l'en-tête, les sommets, le triangle et la normale", () => {
    const m = parseModel(syntheticModel(), 10042);
    expect(m).toMatchObject({ slot: 42, vertexCount: 3, faceCount: 1, normalCount: 1, radiusSquared: 50, groundOffset: -2, ambient: 40 });
    expect(m.vertices[2]).toEqual({ x: 0, y: 10, z: 0, mode: 1 });
    expect(m.faces[0]).toEqual({
      indices: [0, 1, 2],
      normalIndices: [0, 0, 0],
      texture: 16,
      u: [1, 2, 3],
      v: [-4, -5, -6],
      kind: 0,
      flags: 2,
    });
    expect(m.normals).toEqual([{ x: 0, y: 0, z: 100 }]);
  });

  it("refuse un bloc dont la taille ne recouvre pas les tableaux", () => {
    const bytes = syntheticModel();
    expect(() => parseModel(bytes.subarray(0, bytes.length - 4), 1)).toThrow(/incohérents/);
    expect(() => parseModel(bytes.subarray(0, 8), 1)).toThrow(/trop court/);
  });
});

describe.skipIf(!hasOriginalFiles)("modèles 3D de SWIV 3D (fichiers du jeu)", () => {
  const levels = listOriginal((name) => name.endsWith(".SLV"));

  it("trouve les 5 niveaux", () => {
    expect(levels).toEqual(["DEMO.SLV", "TERRAN00.SLV", "TERRAN01.SLV", "TERRAN02.SLV", "TERRAN03.SLV"]);
  });

  describe.each(levels)("%s", (name) => {
    const bd = parseBd(readOriginal(name), name);
    const ids = listModels(bd);

    it("contient 151 modèles, ids 10100 à 10991, sans 11003 ni 11004", () => {
      expect(ids).toHaveLength(151);
      expect(ids[0]).toBe(10100);
      expect(ids[ids.length - 1]).toBe(10991);
      expect(ids).not.toContain(11003);
      expect(ids).not.toContain(11004);
    });

    it("lit chaque bloc en consommant exactement ses octets, avec des indices valides", () => {
      for (const id of ids) {
        const m = parseModel(bd.get(id), id);
        expect(m.vertices).toHaveLength(m.vertexCount);
        expect(m.faces).toHaveLength(m.faceCount);
        expect(m.normals).toHaveLength(m.normalCount);
        expect(m.normalsOffset + 12 * m.normalCount).toBe(bd.get(id).length);
        for (const face of m.faces) {
          for (const index of face.indices) expect(index).toBeLessThan(m.vertexCount);
          // Les faces de type 0x28 n'ombrent pas : leurs champs normales/texture contiennent des octets résiduels.
          if (face.kind === FACE_KIND_FLAT) continue;
          for (const index of face.normalIndices) expect(index).toBeLessThan(m.normalCount);
          expect(face.texture).toBeGreaterThanOrEqual(0);
          expect(face.texture).toBeLessThanOrEqual(68);
        }
      }
    });

    it("n'emploie que les types de face et modes de sommet connus", () => {
      const kinds = new Set<number>();
      const modes = new Set<number>();
      for (const id of ids) {
        const m = parseModel(bd.get(id), id);
        for (const face of m.faces) kinds.add(face.kind);
        for (const vertex of m.vertices) modes.add(vertex.mode);
      }
      expect([...kinds].sort((a, b) => a - b)).toEqual([0, 1, 2, 4, 5, FACE_KIND_FLAT]);
      expect([...modes].sort()).toEqual([0, 1, 2]);
    });

    it("oriente les triangles dans le sens des normales (produit vectoriel b-a, c-a)", () => {
      let agree = 0;
      let disagree = 0;
      for (const id of ids) {
        const m = parseModel(bd.get(id), id);
        for (const face of m.faces) {
          if (face.kind === FACE_KIND_FLAT) continue;
          const [a, b, c] = face.indices.map((i) => m.vertices[i]!);
          const e1 = [b!.x - a!.x, b!.y - a!.y, b!.z - a!.z];
          const e2 = [c!.x - a!.x, c!.y - a!.y, c!.z - a!.z];
          const cross = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
          let dot = 0;
          for (const ni of face.normalIndices) {
            const n = m.normals[ni]!;
            dot += cross[0]! * n.x + cross[1]! * n.y + cross[2]! * n.z;
          }
          if (dot > 0) agree++;
          else if (dot < 0) disagree++;
        }
      }
      expect(agree).toBeGreaterThan(2000);
      expect(disagree).toBeLessThan(agree / 100);
    });

    it("lit des modèles connus : nombres de sommets, triangles et normales", () => {
      const counts = (id: number) => {
        const m = parseModel(bd.get(id), id);
        return [m.vertexCount, m.faceCount, m.normalCount];
      };
      expect(counts(10800)).toEqual([19, 14, 12]);
      expect(counts(10990)).toEqual([42, 60, 55]);
      expect(counts(10203)).toEqual([32, 60, 28]);
      expect(counts(10300)).toEqual([28, 39, 42]);
      expect(counts(10504)).toEqual([22, 36, 9]);
      expect(parseModel(bd.get(10990), 10990)).toMatchObject({ slot: 990, groundOffset: -12, ambient: 30 });
    });
  });

  it("les 5 niveaux partagent les mêmes modèles, octet pour octet", () => {
    const reference = parseBd(readOriginal("TERRAN00.SLV"), "TERRAN00.SLV");
    for (const name of levels) {
      const bd = parseBd(readOriginal(name), name);
      for (const id of listModels(reference)) expect(bd.get(id)).toEqual(reference.get(id));
    }
  });
});
