import { describe, expect, it } from "vitest";
import {
  parseExtTable,
  readExtResource,
} from "../../../src/engine/coktel/data/ext";
import { entriesWithExt, entry, hasOriginalFiles, sha1 } from "../helpers";

describe.skipIf(!hasOriginalFiles)("EXT de Ween", () => {
  it("analyse les 57 EXT et lit chaque ressource, dans le fichier ou dans COMMUN.EX1", () => {
    const common = entry("COMMUN.EX1");
    const names = entriesWithExt(".EXT");
    expect(names).toHaveLength(57);
    expect(common).toHaveLength(440_103);

    let items = 0;
    let inCommon = 0;
    let packed = 0;
    const unpacked: Uint8Array[] = [];
    for (const name of names) {
      const file = entry(name);
      for (const [i, item] of parseExtTable(file).entries()) {
        items++;
        if (item.inCommun) inCommon++;
        if (item.packed) packed++;
        // L'extension de taille de Lost in Time (bits 0x4000-0x1000 de la largeur) est inutilisée ici.
        const source = item.inCommun ? common : file;
        expect(item.offset + item.size, `${name} #${i}`).toBeLessThanOrEqual(
          source.length,
        );
        unpacked.push(readExtResource(file, item, common).data);
      }
    }
    expect([items, inCommon, packed]).toEqual([1749, 1395, 412]);
    expect(unpacked.reduce((sum, d) => sum + d.length, 0)).toBeGreaterThan(0);
    expect(sha1(...unpacked)).toBe("3ec3b4c2b1800cd02b6185f9548d13e03be0e2f8");
  });

  it("garde les six morceaux AdLib de ADL.EXT (compressés)", () => {
    const items = parseExtTable(entry("ADL.EXT"));
    expect(items).toHaveLength(6);
    expect(items.every((i) => i.packed)).toBe(true);
  });
});
