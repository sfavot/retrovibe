import { describe, expect, it } from "vitest";
import { parsePolyRecord } from "../../../src/games/croisiere/data/poly-model";

/** Modèle minimal : 3 points, un triangle de couleur 7 (minScale 0x0180) et un polygone dégénéré à 1 sommet. */
const MODEL = [
  1, 40, 100, 5, 6, 3, // octet 0 inutilisé, upperX, upperY, lowerX, lowerY, nb de points
  10, 20, 30, 40, 50, 60, // points
  3, 7, 9, 0x01, 0x80, 0, 1, 2, // polygone : n, couleur, inutilisé, minScale BE, indices
  1, 0, 0, 0, 0, // polygone d'un sommet : 4 octets sautés après n
  0xff, 9, 9, 9, 9,
];

describe("modèles vectoriels", () => {
  it("lit l'en-tête, les points, les polygones (en sautant ceux de moins de 2 sommets) et la queue", () => {
    const model = parsePolyRecord(Uint8Array.from(MODEL));
    expect(model).toEqual({
      kind: "model",
      upperX: 40,
      upperY: 100,
      lowerX: 5,
      lowerY: 6,
      points: Uint8Array.from([10, 20, 30, 40, 50, 60]),
      polygons: [{ color: 7, unused: 9, minScale: 0x180, indices: Uint8Array.from([0, 1, 2]) }],
      trailer: Uint8Array.from([9, 9, 9, 9]),
    });
  });

  it("lit un renvoi miroir signé (u16 initial nul)", () => {
    const record = parsePolyRecord(Uint8Array.from([0, 0, 0xff, 0xfa, 0, 12, 0xff, 0xfe]));
    expect(record).toEqual({ kind: "mirror", offset: -6, newX: 12, newY: -2 });
  });

  it("refuse les enregistrements tronqués ou incohérents", () => {
    expect(() => parsePolyRecord(Uint8Array.from([1, 2, 3]))).toThrow(/trop court/);
    expect(() => parsePolyRecord(Uint8Array.from([0, 0, 0, 1]))).toThrow(/trop court/);
    expect(() => parsePolyRecord(Uint8Array.from([1, 40, 100, 5, 6, 1, 10, 20, 0xff]))).toThrow(/1 point/);
    expect(() => parsePolyRecord(Uint8Array.from(MODEL.slice(0, 9)))).toThrow(/tronquée/);
    expect(() => parsePolyRecord(Uint8Array.from(MODEL.slice(0, 18)))).toThrow(/tronqué/);
    const badIndex = [...MODEL];
    badIndex[19] = 3;
    expect(() => parsePolyRecord(Uint8Array.from(badIndex))).toThrow(/hors liste/);
  });
});
