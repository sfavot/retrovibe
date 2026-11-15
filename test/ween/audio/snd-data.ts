import { parseExtTable, readExtResource } from "../../../src/engine/coktel/data/ext";
import { entriesWithExt, entry, sha1 } from "../helpers";

/** Un SND : taille u32 BE (hors 6 octets d'en-tête) puis fréquence u16 BE, sur une ressource sans dimensions. */
function looksLikeSnd(d: Uint8Array): boolean {
  if (d.length <= 6) return false;
  const size = new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(0, false) & 0x00ffffff;
  const frequency = (d[4] << 8) | d[5];
  return size + 6 === d.length && frequency >= 3000 && frequency <= 12000;
}

/** Les 192 échantillons distincts du jeu (fichiers SND complets), dans l'ordre de première rencontre. */
export function weenSounds(): Uint8Array[] {
  const common = entry("COMMUN.EX1");
  const unique = new Map<string, Uint8Array>();
  for (const name of entriesWithExt(".EXT")) {
    const file = entry(name);
    for (const item of parseExtTable(file)) {
      if (item.size === 0 || item.width !== 0 || item.height !== 0) continue;
      const data = readExtResource(file, item, common).data;
      if (looksLikeSnd(data)) unique.set(sha1(data), data);
    }
  }
  return [...unique.values()];
}
