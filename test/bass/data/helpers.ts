import { SkyCpt } from "../../../src/games/bass/data/cpt";
import { SkyDisk } from "../../../src/games/bass/data/disk";
import { originalFiles } from "../../support/original";

const original = originalFiles("bass", "sky.dnr");
const REQUIRED = ["sky.dnr", "sky.dsk", "sky.cpt"];

/** Faux si `original/bass/` n'est pas installé : les tests sur les vrais fichiers sont alors ignorés. */
export const hasOriginalFiles = original.has && REQUIRED.every((name) => original.list((n) => n === name).length === 1);

export function readOriginal(name: string): Uint8Array {
  return original.read(name);
}

let cachedDisk: SkyDisk | undefined;
let cachedCpt: SkyCpt | undefined;

/** `sky.dsk` + `sky.dnr` ouverts une seule fois pour toute la série de tests. */
export function skyDisk(): SkyDisk {
  cachedDisk ??= new SkyDisk(readOriginal("sky.dnr"), readOriginal("sky.dsk"));
  return cachedDisk;
}

/** `sky.cpt` lu une seule fois (la correction d'Officer Blunt est déjà appliquée ; ne pas en modifier les données). */
export function skyCpt(): SkyCpt {
  cachedCpt ??= new SkyCpt(readOriginal("sky.cpt"));
  return cachedCpt;
}

let cachedFiles: Map<number, Uint8Array> | undefined;

/** Contenu décompressé des 1 606 fichiers, calculé une seule fois (lecture seule). */
export function allFiles(): Map<number, Uint8Array> {
  if (!cachedFiles) {
    const disk = skyDisk();
    cachedFiles = new Map(disk.entries.map((entry) => [entry.id, disk.load(entry.id)]));
  }
  return cachedFiles;
}
