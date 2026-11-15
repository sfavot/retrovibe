import { describe, expect, it } from "vitest";
import {
  parseExtTable,
  readExtResource,
} from "../../../src/engine/coktel/data/ext";
import { parseSnd } from "../../../src/engine/coktel/data/snd";
import { entriesWithExt, entry, hasOriginalFiles, sha1 } from "../helpers";

/** Un SND : taille u32 BE (hors 6 octets d'en-tête) puis fréquence u16 BE ; recherché parmi les ressources sans dimensions. */
function looksLikeSnd(d: Uint8Array): boolean {
  if (d.length <= 6) return false;
  const size =
    new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(0, false) &
    0x00ffffff;
  const frequency = (d[4] << 8) | d[5];
  return size + 6 === d.length && frequency >= 3000 && frequency <= 12000;
}

describe.skipIf(!hasOriginalFiles)("SND de Ween", () => {
  it("lit les 274 références, soit 192 échantillons distincts de 3 024 à 11 363 Hz", () => {
    const common = entry("COMMUN.EX1");
    const unique = new Map<string, Uint8Array>();
    let references = 0;
    for (const name of entriesWithExt(".EXT")) {
      const file = entry(name);
      for (const item of parseExtTable(file)) {
        if (item.size === 0 || item.width !== 0 || item.height !== 0) continue;
        const data = readExtResource(file, item, common).data;
        if (!looksLikeSnd(data)) continue;
        references++;
        unique.set(sha1(data), data);
      }
    }
    expect(references).toBe(274);
    expect(unique.size).toBe(192);

    const sounds = [...unique.values()].map(parseSnd);
    // `parseSnd` relève les fréquences à 4 700 Hz (comme ScummVM) ; les fichiers vont de 3 024 à 11 363 Hz.
    const raw = [...unique.values()].map((d) => (d[4] << 8) | d[5]);
    expect([Math.min(...raw), Math.max(...raw)]).toEqual([3024, 11363]);
    expect(Math.min(...sounds.map((s) => s.frequency))).toBe(4700);
    expect(sounds.reduce((sum, s) => sum + s.data.length, 0)).toBe(1_048_944);
    for (const s of sounds) expect(s.data.length).toBeGreaterThan(0);
  });
});
