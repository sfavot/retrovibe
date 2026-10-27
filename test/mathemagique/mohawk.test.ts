import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MohawkArchive, TAG_SHAP, TAG_SND } from "../../src/data/mohawk/mohawk";
import { archivePaths, hasOriginalFiles, readOriginal } from "./helpers";

/** Archive minimale : un type `TEST` à deux ressources (ids 7 et 9). */
function tinyArchive(): Uint8Array {
  const abs = 28;
  const bytes = new Uint8Array(200);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("MHWK"), 0);
  bytes.set(new TextEncoder().encode("RSRC"), 8);
  view.setUint32(20, abs);
  // abs+0 : offset noms (0), nombre de types (1)
  view.setUint16(abs + 2, 1);
  bytes.set(new TextEncoder().encode("TEST"), abs + 4);
  view.setUint16(abs + 8, 20); // table de ressources à abs+20
  view.setUint16(abs + 10, 40); // table de noms (vide)
  view.setUint16(abs + 12, 50); // table de fichiers à abs+50 (offset dans l'entête)
  view.setUint16(24, 50);
  view.setUint16(abs + 20, 2);
  view.setUint16(abs + 22, 7);
  view.setUint16(abs + 24, 1);
  view.setUint16(abs + 26, 9);
  view.setUint16(abs + 28, 2);
  view.setUint32(abs + 50, 2);
  view.setUint32(abs + 54, 150);
  view.setUint16(abs + 58, 3);
  view.setUint32(abs + 64, 153);
  view.setUint16(abs + 68, 2);
  bytes.set([1, 2, 3, 4, 5], 150);
  return bytes;
}

describe("MohawkArchive (données synthétiques)", () => {
  it("lit les types, les ids et les octets des ressources", () => {
    const archive = MohawkArchive.parse(tinyArchive());
    expect(archive.types()).toEqual(["TEST"]);
    expect(archive.count("TEST")).toBe(2);
    expect(archive.ids("TEST")).toEqual([7, 9]);
    expect([...archive.get("TEST", 7)]).toEqual([1, 2, 3]);
    expect([...archive.get("TEST", 9)]).toEqual([4, 5]);
    expect(archive.has("TEST", 8)).toBe(false);
    expect(archive.find("TEST", 8)).toBeUndefined();
    expect(archive.count("AUTR")).toBe(0);
    expect(() => archive.get("TEST", 8)).toThrow(/introuvable/);
  });

  it("refuse une signature invalide", () => {
    expect(() => MohawkArchive.parse(new Uint8Array(64))).toThrow(/MHWK/);
  });
});

/** Tableau de `docs/mathemagique/files.md` : types de ressources attendus par archive. */
function expectedTypes(): Map<string, Map<string, number>> {
  const doc = readFileSync(resolve(import.meta.dirname, "../../docs/mathemagique/files.md"), "utf8");
  const out = new Map<string, Map<string, number>>();
  for (const line of doc.split("\n")) {
    const match = /^\| `([^`]+\.(?:DAT|MHK))` \| [^|]+ \| (.+) \|$/.exec(line);
    if (!match) continue;
    const counts = new Map<string, number>();
    for (const [, tag, n] of match[2].matchAll(/`([^`]+)` : (\d+)/g)) counts.set(tag.replace(/\\x00/g, "\0"), Number(n));
    out.set(match[1], counts);
  }
  return out;
}

describe.skipIf(!hasOriginalFiles)("archives Mohawk du jeu", () => {
  const paths = archivePaths();

  it("trouve les 19 archives", () => {
    expect(paths).toHaveLength(19);
  });

  it("retrouve les types et les nombres de ressources de docs/mathemagique/files.md", () => {
    const expected = expectedTypes();
    expect([...expected.keys()].sort()).toEqual(paths);
    for (const path of paths) {
      const archive = MohawkArchive.parse(readOriginal(path));
      const actual = new Map(archive.types().map((tag) => [tag, archive.count(tag)]));
      expect(actual, path).toEqual(expected.get(path));
    }
  });

  it("donne accès aux octets de chaque ressource", () => {
    for (const path of paths) {
      const archive = MohawkArchive.parse(readOriginal(path));
      for (const tag of archive.types()) {
        for (const id of archive.ids(tag)) expect(archive.get(tag, id).length, `${path} ${tag} ${id}`).toBeGreaterThan(0);
      }
    }
  });

  it("lit les en-têtes de SHAP (largeur, hauteur) de TROPHY.DAT", () => {
    const archive = MohawkArchive.parse(readOriginal("TROPHY.DAT"));
    const shap = archive.get(TAG_SHAP, 1000);
    const view = new DataView(shap.buffer, shap.byteOffset, shap.byteLength);
    expect([view.getUint16(0), view.getUint16(2)]).toEqual([19, 14]);
  });

  it("référence les sons par le tag \\0SND (NUL initial)", () => {
    const archive = MohawkArchive.parse(readOriginal("TITLE.DAT"));
    expect(archive.count(TAG_SND)).toBe(2);
  });
});
