import { describe, expect, it } from "vitest";
import { GameFiles, stemOf } from "../../../src/games/fotaq/data/files";
import { LIGHT_TABLE_SIZE, lightDelta, lightRowAt, MASK_SIZE, parseRoomLight } from "../../../src/games/fotaq/data/dynalum";
import { dataFiles, hasOriginalFiles, readManifest, readOriginal } from "../helpers";

describe("lumière dynamique (données synthétiques)", () => {
  const mask = new Uint8Array(MASK_SIZE);
  // Cellule (colonne 10, ligne 5) : x 40 à 43, y 20 à 23.
  mask[5 * 160 + 10] = 3;
  const table = Uint8Array.from({ length: LIGHT_TABLE_SIZE }, (_, i) => (i < 3 ? 0 : 256 - (Math.floor(i / 3) * 3 + (i % 3))));
  const light = parseRoomLight(mask, table);

  it("lit la ligne du masque à (y / 4) * 160 + (x / 4)", () => {
    expect(lightRowAt(light, 40, 20, 640)).toBe(3);
    expect(lightRowAt(light, 43, 23, 640)).toBe(3);
    expect(lightRowAt(light, 44, 20, 640)).toBe(0);
  });

  it("borne x à la largeur du décor et y à 149", () => {
    mask[37 * 160 + 80] = 5;
    expect(lightRowAt(light, 5000, 149, 320)).toBe(5);
    expect(lightRowAt(light, -50, -50, 320)).toBe(0);
    expect(lightRowAt(light, 320, 400, 320)).toBe(5);
  });

  it("lit la table en entiers signés et multiplie par 4 ; rend null hors table", () => {
    expect(lightDelta(light, 0)).toEqual([0, 0, 0]);
    // Ligne 1 de la table : octets 253, 252, 251, soit -3, -4, -5, multipliés par 4.
    expect(lightDelta(light, 1)).toEqual([-12, -16, -20]);
    expect(lightDelta(light, 7)).not.toBeNull();
    expect(lightDelta(light, 8)).toBeNull();
    expect(lightDelta(light, 255)).toBeNull();
  });

  it("refuse un masque ou une table de mauvaise taille", () => {
    expect(() => parseRoomLight(new Uint8Array(10), table)).toThrow(/MSK invalide/);
    expect(() => parseRoomLight(mask, new Uint8Array(10))).toThrow(/LUM invalide/);
  });
});

describe.skipIf(!hasOriginalFiles)("masques et tables de lumière du jeu", () => {
  const masks = dataFiles("MSK");
  const lums = dataFiles("LUM");
  const files = new GameFiles(hasOriginalFiles ? readManifest() : []);

  it("compte 65 masques de 8 000 octets et 63 tables de 24 octets", () => {
    expect(masks).toHaveLength(65);
    expect(lums).toHaveLength(63);
    for (const name of masks) expect(readOriginal(name), name).toHaveLength(8000);
    for (const name of lums) expect(readOriginal(name), name).toHaveLength(24);
  });

  it("n'associe masque et table que dans 63 pièces ; T4 et V5 n'ont pas de table", () => {
    const withLight = files.roomsWithLight();
    expect(withLight).toHaveLength(63);
    const noTable = masks.map(stemOf).filter((name) => !withLight.includes(name));
    expect(noTable.sort()).toEqual(["T4", "V5"]);
  });

  it("lit B1 : une table décroissante par pas de 3 (0, -3, -6…), à zéro pour la première ligne", () => {
    const light = parseRoomLight(readOriginal("B1.MSK"), readOriginal("B1.LUM"));
    expect(Array.from(light.table.subarray(0, 21))).toEqual([0, 0, 0, -3, -3, -3, -6, -6, -6, -9, -9, -9, -12, -12, -12, -15, -15, -15, -18, -18, -18]);
    expect(Array.from(light.table.subarray(21))).toEqual([8, 8, 8]);
    expect(lightDelta(light, 1)).toEqual([-12, -12, -12]);
    // Les cellules du haut de B1 sont toutes à 0 ; le bas du jeu (ligne 37) contient des valeurs 1 à 3.
    expect(lightRowAt(light, 0, 0, 640)).toBe(0);
    const row37 = new Set(readOriginal("B1.MSK").subarray(37 * 160, 38 * 160));
    expect([...row37].sort()).toEqual([0, 1, 2, 3]);
  });

  it("n'a de valeur de masque hors des 8 lignes de la table que dans T6 (1 912 cellules à 255)", () => {
    const outside: Record<string, number> = {};
    for (const name of masks) {
      const count = readOriginal(name).filter((value) => value >= 8).length;
      if (count) outside[stemOf(name)] = count;
    }
    expect(outside).toEqual({ T6: 1912 });
    const light = parseRoomLight(readOriginal("T6.MSK"), readOriginal("T6.LUM"));
    expect(lightDelta(light, 255)).toBeNull();
  });
});
