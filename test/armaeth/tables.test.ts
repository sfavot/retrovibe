import { describe, expect, it } from "vitest";
import { parseAni, parseDef, parseHelp, parseInstall, parseTmpScr } from "../../src/games/armaeth/data/tables";
import { hasOriginalFiles, readOriginal } from "./helpers";

describe("tables : données invalides", () => {
  it("refusent des tailles incohérentes", () => {
    expect(() => parseDef(new Uint8Array(8).fill(1))).toThrow(/DEF invalide/);
    expect(() => parseAni(Uint8Array.of(1, 0, 0, 0))).toThrow(/ANI invalide/);
    expect(() => parseInstall(new Uint8Array(3))).toThrow(/INS invalide/);
    expect(() => parseTmpScr(new Uint8Array(3))).toThrow(/TMP.SCR invalide/);
    expect(parseHelp(Uint8Array.of(0, 0))).toEqual([]);
    expect(() => parseHelp(Uint8Array.of(1, 0, 0, 0, 0, 0, 5, 0, 0, 0))).toThrow(/SOS invalide/);
  });
});

describe.skipIf(!hasOriginalFiles)("petites tables d'Armaeth (fichiers du jeu)", () => {
  it("DEF : 189 enregistrements dans l'ordre INT, DEC, OBJ, ANM", () => {
    const def = parseDef(readOriginal("A1FDEF.SYS"));
    expect(def.counts).toEqual({ INT: 30, DEC: 20, OBJ: 92, ANM: 47 });
    expect(def.records.ANM.map((r) => r.id)).toEqual(Array.from({ length: 47 }, (_, i) => i + 1));
    expect(def.records.INT.slice(0, 6).map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 101]);
    expect(def.records.DEC.map((r) => r.id).slice(-1)).toEqual([306]);
    expect(def.records.OBJ.some((r) => r.id === 307)).toBe(false);
    expect(def.records.OBJ).toHaveLength(92);
    expect(def.records.OBJ[0].bytes).toHaveLength(26);
  });

  it("DEF couvre les ressources des objets du monde", () => {
    const def = parseDef(readOriginal("A1FDEF.SYS"));
    const ids = [def.records.INT, def.records.DEC, def.records.OBJ].map((list) => new Set(list.map((r) => r.id)));
    expect(ids[2].has(308)).toBe(true);
    expect(ids[0].has(198)).toBe(true);
  });

  it("ANI : 47 animations, 147 mots, séquences dans la table", () => {
    const ani = parseAni(readOriginal("A1FANI.SYS"));
    expect(ani.records).toHaveLength(47);
    expect(ani.words).toHaveLength(147);
    expect(ani.records.map((r) => r.id)).toEqual(Array.from({ length: 47 }, (_, i) => i + 1));
    expect(ani.records[0]).toEqual({ id: 1, kind: 32, unknown2: 0, unknown3: 0, steps: 10, start: 0 });
    expect([...ani.sequence(1)]).toEqual(Array(10).fill(250));
    expect(ani.sequence(47)).toHaveLength(8);
    expect(ani.records.every((r) => r.kind === 32 || r.kind === 65)).toBe(true);
    expect(() => ani.sequence(48)).toThrow(/inconnue/);
  });

  it("INS : lecteur C et répertoire \\ARMAETH", () => {
    const ins = parseInstall(readOriginal("A1FINS.SYS"));
    expect(ins).toMatchObject({ type: 0, drive: "C", directory: "\\ARMAETH" });
  });

  it("TMP.SCR : 10 octets nuls", () => {
    expect([...parseTmpScr(readOriginal("A1FTMP.SCR"))]).toEqual(Array(10).fill(0));
  });

  it("SOS : arbre d'aide de 607 nœuds, texte consommé exactement", () => {
    const help = parseHelp(readOriginal("A1FSOS.SYS"));
    expect(help).toHaveLength(607);
    expect(help.reduce((sum, n) => sum + n.text.length, 0)).toBe(21436);
    expect(help.some((n) => n.text.includes("système d'aide pour ARMAETH"))).toBe(true);
  });
});
