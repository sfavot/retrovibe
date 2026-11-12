import { DAT_FILE_NAME, DISK_FILE_NAMES, LureResources } from "../../../src/games/lure/data/container";
import { originalFiles } from "../../support/original";

const original = originalFiles("lure", DAT_FILE_NAME);

/** Faux si `original/lure/` n'est pas installé : les tests sur les vrais fichiers sont alors ignorés. */
export const hasOriginalFiles = original.has && DISK_FILE_NAMES.every((name) => original.list((n) => n === name).length === 1);

export function readOriginal(name: string): Uint8Array {
  return original.read(name);
}

let cached: LureResources | undefined;

/** Les quatre disques et le bloc de `lure.dat`, ouverts une seule fois pour toute la série de tests. */
export function lureResources(): LureResources {
  cached ??= new LureResources({
    disks: DISK_FILE_NAMES.map(readOriginal) as unknown as [Uint8Array, Uint8Array, Uint8Array, Uint8Array],
    dat: readOriginal(DAT_FILE_NAME),
  });
  return cached;
}
