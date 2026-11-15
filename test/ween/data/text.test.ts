import { describe, expect, it } from "vitest";
import { parseTot } from "../../../src/engine/coktel/data/tot";
import {
  cp850,
  entriesWithExt,
  entry,
  hasOriginalFiles,
  loadIntro,
  sha1,
  textLines,
} from "../helpers";

describe.skipIf(!hasOriginalFiles)("textes .DAT de Ween", () => {
  const texts = (base: string) =>
    parseTot(entry(`${base}.TOT`), entry(`${base}.DAT`)).texts!;

  it("lit les premiers textes français d'INTRO1", () => {
    const table = texts("INTRO1");
    expect(table.count).toBe(4);
    expect(textLines(table.get(0)!)[0]).toBe(
      "WEEN, mes forces m'abandonnent, mes",
    );
    expect(textLines(table.get(3)!).join(" ")).toContain(
      "Je sais qu'il a projeté de revenir",
    );
  });

  it("décode l'accent CP850 en passant par le texte réel", () => {
    expect(cp850(Uint8Array.from([0x82, 0x88, 0x8a, 0x85, 0x87]))).toBe(
      "éêèàç",
    );
  });

  it("compte les items et lignes de tous les .DAT, avec une empreinte stable", () => {
    const names = entriesWithExt(".DAT");
    expect(names).toHaveLength(59);
    // Deux fichiers de texte n'ont pas de TOT (ECOPE.DAT, INTRO016.DAT) : jamais lus par un TOT.
    const orphans = names.filter(
      (n) => !loadIntro().has(n.replace(/\.DAT$/, ".TOT")),
    );
    expect(orphans).toEqual(["ECOPE.DAT", "INTRO016.DAT"]);
    let items = 0;
    let empty = 0;
    let lines = 0;
    const all: string[] = [];
    for (const name of names.filter((n) => !orphans.includes(n))) {
      const base = name.replace(/\.DAT$/, "");
      const table = parseTot(entry(`${base}.TOT`), loadIntro().get(name)).texts;
      expect(table, name).not.toBeNull();
      for (let i = 0; i < table!.count; i++) {
        const item = table!.get(i);
        if (!item || item.length < 12) {
          empty++;
          continue;
        }
        const itemLines = textLines(item);
        items++;
        lines += itemLines.length;
        all.push(...itemLines);
      }
    }
    expect([items, empty]).toEqual([2385, 271]);
    expect(lines).toBe(4136);
    expect(sha1(new TextEncoder().encode(all.join("\n")))).toBe(
      "8ff171b3e4c6dc4e982f6d8b63b5b0db2e1089eb",
    );
  });
});
