import { describe, expect, it } from "vitest";
import { getTotResource, parseTot } from "../../../src/engine/coktel/data/tot";
import { entriesWithExt, entry, hasOriginalFiles, loadIntro } from "../helpers";

const NO_TEXT_FILE = [
  "ADL",
  "EDIT",
  "EMAJ1008",
  "EMAJ1010",
  "FEUFX",
  "FIOLFX",
  "JOKER",
  "PARTIE",
  "PONTFX",
  "REGLAGE",
];

describe.skipIf(!hasOriginalFiles)("TOT de Ween", () => {
  const bases = () =>
    entriesWithExt(".TOT").map((n) => n.replace(/\.TOT$/, ""));
  const load = (base: string) =>
    parseTot(entry(`${base}.TOT`), loadIntro().get(`${base}.DAT`));

  it("analyse les 67 TOT : version 1.2, COMMUN.IM1 / COMMUN.EX1 (sauf 7 TOT système sans im ni ex)", () => {
    expect(bases()).toHaveLength(67);
    const withoutCommon: string[] = [];
    for (const base of bases()) {
      const { header } = load(base);
      expect(header.version, base).toBe("1.2");
      expect(header.communHandling, base).toBe(2);
      expect(header.imFileNumber, base).toBe(header.exFileNumber);
      if (header.imFileNumber === 0) withoutCommon.push(base);
      else expect(header.imFileNumber, base).toBe(1);
      expect(header.scriptEnd, base).toBeGreaterThan(128);
    }
    expect(withoutCommon).toEqual([
      "ADL",
      "EDIT",
      "INTRO",
      "JOKER",
      "MENU",
      "PARTIE",
      "REGLAGE",
    ]);
  });

  it("compte les variables : 3 885 pour le jeu, 287 (bloc-notes) et 101 (réglages)", () => {
    expect(load("INTRO").header.variablesCount).toBe(3885);
    expect(load("EDIT").header.variablesCount).toBe(287);
    expect(load("REGLAGE").header.variablesCount).toBe(101);
  });

  it("résout toutes les ressources, partagées (COMMUN.IM1) ou embarquées", () => {
    const im = entry("COMMUN.IM1");
    let total = 0;
    let shared = 0;
    for (const base of bases()) {
      const tot = load(base);
      (tot.resources ?? []).forEach((r, i) => {
        total++;
        if (r.inIm) shared++;
        if (r.size > 0)
          expect(getTotResource(tot, i, im), `${base} #${i}`).not.toBeNull();
      });
    }
    expect([total, shared]).toEqual([2989, 2600]);
  });

  it("la table de ressources et ses données finissent exactement avec le fichier", () => {
    for (const base of bases()) {
      const tot = load(base);
      if (!tot.resources) continue;
      const embedded = tot.resources
        .filter((r) => !r.inIm)
        .reduce((sum, r) => sum + r.size, 0);
      const start = tot.header.resourcesOffset + 3 + tot.resources.length * 10;
      expect(start + embedded, base).toBe(tot.file.length);
    }
  });

  it("charge les textes dans le .DAT sauf pour 10 TOT sans texte", () => {
    const without: string[] = [];
    let items = 0;
    for (const base of bases()) {
      const tot = load(base);
      if (!tot.texts) without.push(base);
      items += tot.texts?.count ?? 0;
    }
    expect(without).toEqual(NO_TEXT_FILE);
    expect(items).toBe(2656);
  });

  it("fait finir le bloc @190 d'INTRO1.TOT sur la fin du script (cas limite de seek)", () => {
    const tot = load("INTRO1");
    const data = tot.script;
    const u16 = (at: number) => data[at] | (data[at + 1] << 8);
    // Bloc principal : 14 commandes, déclaré jusqu'à 1 237 = fin du script (ressources en 1 237).
    expect(data[191]).toBe(14);
    expect(190 + 2 + u16(192)).toBe(1237);
    expect(tot.header.scriptEnd).toBe(1237);
    // Dernière commande du bloc : if @386, avec un `else` (marqueur 0xC0 en 1 224) de 12 octets sur 1 225-1 237.
    expect(data[1224] >> 4).toBe(12);
    expect(data[1225]).toBe(1);
    expect(1225 + 2 + u16(1227)).toBe(1237);
    expect(data.length).toBe(1237);
  });
});
