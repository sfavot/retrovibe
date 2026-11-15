import { describe, expect, it } from "vitest";
import { CTP_MAX_NEIGHBOURS, CTP_MAX_POINTS, parseCtp } from "../../../src/games/croisiere/data/ctp";
import { CruiseVolumes } from "../../../src/games/croisiere/data/volumes";
import { originalFiles } from "../../support/original";

const original = originalFiles("croisiere", "VOL.CNF");
const REQUIRED = ["VOL.CNF", "D1", "D2", "D3", "D4", "D5"];
const hasOriginalFiles = original.has && REQUIRED.every((name) => original.list((n) => n === name).length === 1);

/** CTP minimal : 2 nœuds, 1 route, 1 zone triangulaire. */
function tinyCtp(): Uint8Array {
  const words: number[] = [];
  const sizes = [8, 20, 80, 2, 2, 2, 2];
  words.push(0x4354, 0x5020, 2, ...sizes);
  words.push(10, 20, 30, 40); // nœuds
  words.push(1, 1, 0, 0, 0, 0, 0, 0, 0, 0); // route : un voisin (nœud 1)
  words.push(3, 0, 0, 100, 0, 50, 60, ...new Array(33).fill(0)); // polygone : 3 points
  words.push(1, 0, 7, 0xfffe); // couleur 1, état 0, indice 7, zoom -2
  const out = new Uint8Array(words.length * 2);
  const view = new DataView(out.buffer);
  words.forEach((w, i) => view.setUint16(i * 2, w & 0xffff));
  return out;
}

describe("ctp (synthétique)", () => {
  it("lit nœuds, routes, polygones et attributs d'une zone", () => {
    const ctp = parseCtp(tinyCtp());
    expect(ctp.numNodes).toBe(2);
    expect(ctp.nodes).toEqual([{ x: 10, y: 20 }, { x: 30, y: 40 }]);
    expect(ctp.routes).toEqual([[1]]);
    expect(ctp.walkboxes).toEqual([{ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 60 }], color: 1, state: 0, colorIndex: 7, zoom: -2 }]);
    expect(ctp.walkboxRows[0]).toHaveLength(40);
    expect(ctp.routeRows[0]![0]).toBe(1);
  });

  it("refuse une signature, une taille ou un segment incohérents", () => {
    const bytes = tinyCtp();
    expect(() => parseCtp(bytes.subarray(0, bytes.length - 2))).toThrow(/segments/);
    const wrongMagic = bytes.slice();
    wrongMagic[0] = 0x58;
    expect(() => parseCtp(wrongMagic)).toThrow(/signature/);
    const wrongRow = bytes.slice();
    new DataView(wrongRow.buffer).setInt16(6 + 2, 19); // segment des routes : pas un multiple de 20
    expect(() => parseCtp(wrongRow)).toThrow(RangeError);
    expect(() => parseCtp(new Uint8Array(10))).toThrow(/trop court/);
  });
});

describe.skipIf(!hasOriginalFiles)("ctp (fichiers originaux)", () => {
  const volumes = CruiseVolumes.open((name) => original.read(name));
  const names = [...new Set(volumes.entries.filter((e) => e.name.endsWith(".CTP")).map((e) => e.name))];

  it("analyse les 33 CTP distincts : la somme des segments tombe sur la taille du fichier", () => {
    expect(names).toHaveLength(33);
    for (const name of names) {
      const ctp = parseCtp(volumes.readFile(name));
      expect(ctp.nodes, name).toHaveLength(ctp.numNodes);
      expect(ctp.routeRows, name).toHaveLength(ctp.numNodes);
      expect(ctp.walkboxRows, name).toHaveLength(ctp.walkboxes.length);
      for (const row of ctp.routeRows) expect(row[0]!, name).toBeLessThanOrEqual(CTP_MAX_NEIGHBOURS);
      ctp.routes.forEach((neighbours) => neighbours.forEach((id) => expect(id, name).toBeLessThan(ctp.numNodes)));
      for (const box of ctp.walkboxes) {
        expect(box.points.length, name).toBeGreaterThan(0);
        expect(box.points.length, name).toBeLessThanOrEqual(CTP_MAX_POINTS);
        expect([0, 1, 2], name).toContain(box.color);
        expect([0, 1], name).toContain(box.state);
      }
    }
  });

  it("S33.CTP : 15 nœuds et 11 zones (formats.md § 3.5)", () => {
    const ctp = parseCtp(volumes.readFile("S33.CTP"));
    expect(ctp.numNodes).toBe(15);
    expect(ctp.walkboxes).toHaveLength(11);
    expect(ctp.segmentSizes[0]).toBe(60); // 15 nœuds × 4 octets
    expect(ctp.segmentSizes[1]).toBe(300); // 15 routes × 20 octets
  });
});
