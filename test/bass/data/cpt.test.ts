import { describe, expect, it } from "vitest";
import { CPT_TALK_TABLE_LIST, CptType, ID_SC31_GUARD_TALK, ID_SC31_GUARD_TALK2, OFFICER_BLUNT_TALK_INDEX, SkyCpt } from "../../../src/games/bass/data/cpt";
import { hasOriginalFiles, readOriginal, skyCpt } from "./helpers";

describe.skipIf(!hasOriginalFiles)("SkyCpt (sky.cpt du jeu)", () => {
  const cpt = skyCpt();

  it("lit 9 listes, 3 258 compacts répartis par type, 76 alias, 854 identifiants à sauvegarder", () => {
    expect(cpt.listLengths).toEqual([1046, 272, 353, 412, 487, 608, 257, 198, 2]);
    const histogram: Record<number, number> = {};
    let real = 0;
    for (const id of cpt.realIds()) {
      real++;
      const type = cpt.get(id)!.type;
      histogram[type] = (histogram[type] ?? 0) + 1;
    }
    expect(real).toBe(3258);
    expect(histogram).toEqual({ 1: 846, 2: 29, 3: 624, 4: 1630, 5: 101, 6: 19, 7: 9 });
    expect(cpt.raw.length).toBe(148603);
    expect(cpt.saveIds).toHaveLength(854);
    expect(cpt.diffs288).toHaveLength(188);
    expect(cpt.aliasPairs).toHaveLength(76);
  });

  it("rend données, type, taille et nom d'un compact ; les vues partagent le tampon brut", () => {
    const joey = cpt.get(1)!;
    expect(joey.type).toBe(CptType.compact);
    expect(joey.data.length).toBe(joey.size);
    expect(joey.data.buffer).toBe(cpt.raw.buffer);
    expect(joey.name.length).toBeGreaterThan(0);
    expect(cpt.findId(joey.name)).toBe(1);
    expect(cpt.findId(joey.name.toUpperCase())).toBe(1);
    expect(cpt.get(0xffff)).toBeUndefined();
    expect(() => cpt.get(9 << 12)).toThrow(RangeError);
    expect(() => cpt.get(0x0fff)).toThrow(RangeError);
  });

  it("résout les alias vers leur cible (mêmes données) ; une cible vide donne undefined", () => {
    let empty = 0;
    for (const [alias, target] of cpt.aliasPairs) {
      const entry = cpt.get(alias);
      if (!entry) {
        empty++;
        expect(cpt.resolve(alias)).toBeUndefined();
        continue;
      }
      expect(entry.aliasOf).toBe(target);
      expect(cpt.resolve(alias)).toBe(target);
      expect(cpt.resolve(target)).toBe(target);
      const real = cpt.get(target)!;
      expect(entry.data.byteOffset).toBe(real.data.byteOffset);
      expect(entry.type).toBe(real.type);
      expect(entry.name).not.toBe(real.name);
    }
    expect(empty).toBeLessThan(cpt.aliasPairs.length);
    expect(cpt.resolve(0xffff)).toBeUndefined();
  });

  it("corrige l'erreur d'Officer Blunt au chargement (talkTable[158])", () => {
    expect(cpt.officerBluntFixed).toBe(true);
    const table = cpt.get(CPT_TALK_TABLE_LIST)!;
    expect(table.data[OFFICER_BLUNT_TALK_INDEX]).toBe(0x4138);
    expect(ID_SC31_GUARD_TALK2).toBe(0x4138);
    expect(ID_SC31_GUARD_TALK).toBe(0x40df);
    // Le fichier d'origine porte bien 0x40DF aux octets 17 142-17 143 (le fichier de ScummVM : 0x4138).
    const file = readOriginal("sky.cpt");
    expect(file[17142]! | (file[17143]! << 8)).toBe(0x40df);
    // Un second chargement refait la correction ; une version déjà corrigée ne la déclare pas.
    const patched = Uint8Array.from(file);
    patched[17142] = 0x38;
    patched[17143] = 0x41;
    const again = new SkyCpt(patched);
    expect(again.officerBluntFixed).toBe(false);
    expect(again.get(CPT_TALK_TABLE_LIST)!.data[OFFICER_BLUNT_TALK_INDEX]).toBe(0x4138);
  });

  it("garde les données de remise à zéro brutes (61 742 octets) et sait construire l'état initial de la v0.0372", () => {
    expect(cpt.resetData).toHaveLength(61742);
    const words = cpt.resetData[0]! | (cpt.resetData[1]! << 8);
    const reset = cpt.createResetData(372);
    expect(reset).toHaveLength(words);
    expect(() => cpt.createResetData(999)).toThrow(/version/);
  });

  it("lit les différences v0.0288 sans les appliquer", () => {
    const first = cpt.diffs288[0]!;
    expect(first.values.length).toBeGreaterThan(0);
    const target = cpt.get(first.id)!;
    expect(first.offset + first.values.length).toBeLessThanOrEqual(target.size);
    expect(cpt.diffs288.some((d) => d.values.some((v, i) => cpt.get(d.id)!.data[d.offset + i] !== v))).toBe(true);
  });

  it("refuse une taille ou une version incorrectes", () => {
    expect(() => new SkyCpt(new Uint8Array(10))).toThrow(/octets/);
    const wrongVersion = Uint8Array.from(readOriginal("sky.cpt"));
    wrongVersion[0] = 1;
    expect(() => new SkyCpt(wrongVersion)).toThrow(/version/);
  });
});
