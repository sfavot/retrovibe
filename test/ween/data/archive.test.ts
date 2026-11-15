import { describe, expect, it } from "vitest";
import {
  entriesWithExt,
  entry,
  hasOriginalFiles,
  loadIntro,
  sha1,
} from "../helpers";

/** Octets de l'archive que la table ne référence pas (rien n'y est lu). */
const SLACK = 11_730;

describe.skipIf(!hasOriginalFiles)("INTRO.STK de Ween", () => {
  const archive = () => loadIntro();

  it("contient 264 entrées uniques réparties par type", () => {
    const counts: Record<string, number> = {};
    for (const e of archive().entries) {
      const ext = e.name.split(".").pop()!;
      counts[ext] = (counts[ext] ?? 0) + 1;
    }
    expect(archive().entries).toHaveLength(264);
    expect(
      new Set(archive().entries.map((e) => e.name.toUpperCase())).size,
    ).toBe(264);
    expect(counts).toEqual({
      INF: 1,
      TOT: 67,
      DAT: 59,
      LET: 7,
      IM1: 1,
      EXT: 57,
      CAT: 41,
      IMD: 30,
      EX1: 1,
    });
  });

  it("n'utilise que les compressions 0 et 1 (117 blocs LZSS)", () => {
    expect(archive().entries.filter((e) => e.packed)).toHaveLength(117);
  });

  it("jointoie les entrées sans trou et décompresse chacune à sa taille déclarée", () => {
    const a = archive();
    // La table n'est pas dans l'ordre du fichier ; il reste des octets non référencés entre certaines entrées.
    let end = 2 + a.entries.length * 22;
    let stored = 0;
    for (const e of [...a.entries].sort((x, y) => x.offset - y.offset)) {
      expect(e.offset, e.name).toBeGreaterThanOrEqual(end);
      end = e.offset + e.size;
      stored += e.size;
    }
    expect(end).toBeLessThanOrEqual(7_029_591);
    expect(7_029_591 - 2 - a.entries.length * 22 - stored).toBe(SLACK);
    let unpacked = 0;
    for (const e of a.entries) {
      const data = a.extract(e);
      if (e.packed) {
        const raw = a.extract({ ...e, packed: false });
        const declared = new DataView(
          raw.buffer,
          raw.byteOffset,
          raw.byteLength,
        ).getUint32(0, true);
        expect(data.length, e.name).toBe(declared);
      } else {
        expect(data.length, e.name).toBe(e.size);
      }
      expect(data.length, e.name).toBeGreaterThan(0);
      unpacked += data.length;
    }
    expect(unpacked).toBe(7_598_016);
  });

  it("produit un contenu décompressé stable", () => {
    const a = archive();
    expect(sha1(...a.entries.map((e) => a.extract(e)))).toBe(
      "477861de8377d604048b022bb8623d6e7fc9321b",
    );
  });

  it("ne cite d'autre archive que DISK2.STK et DISK3.STK, une seule fois chacune, dans MENU.TOT", () => {
    const citations: string[] = [];
    for (const e of archive().entries) {
      const text = Buffer.from(archive().extract(e)).toString("latin1");
      for (const m of text.matchAll(/[A-Z0-9_]{1,8}\.STK/gi))
        citations.push(`${e.name}:${m[0].toUpperCase()}`);
    }
    // Invite de changement de disquette : `o1_manageDataFile` sur un fichier absent est sans effet dans ScummVM.
    expect(citations.sort()).toEqual([
      "MENU.TOT:DISK2.STK",
      "MENU.TOT:DISK3.STK",
    ]);
  });
});

describe.skipIf(!hasOriginalFiles)(".CAT du jeu", () => {
  it("sont 41 fichiers non compressés, servis tels quels (lus par readData)", () => {
    const names = entriesWithExt(".CAT");
    expect(names).toHaveLength(41);
    const entries = loadIntro().entries.filter((e) =>
      e.name.toUpperCase().endsWith(".CAT"),
    );
    expect(entries.some((e) => e.packed)).toBe(false);
    expect(entries.reduce((sum, e) => sum + e.size, 0)).toBe(198_644);
    expect(entry("CAT.CAT")).toHaveLength(42_324);
  });
});
