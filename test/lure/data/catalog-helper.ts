import { classifyResources, type CatalogEntry } from "../../../src/games/lure/data/catalog";
import { loadLureData, type LureData } from "../../../src/games/lure/data/lure-data";
import { DAT_FILE_NAME, DISK_FILE_NAMES } from "../../../src/games/lure/data/container";
import { readOriginal } from "./helpers";

let data: LureData | undefined;
let catalog: CatalogEntry[] | undefined;

/** Données du jeu décodées une seule fois (nécessite `original/lure/`). */
export function lureData(): LureData {
  data ??= loadLureData({
    disks: DISK_FILE_NAMES.map(readOriginal) as unknown as [Uint8Array, Uint8Array, Uint8Array, Uint8Array],
    dat: readOriginal(DAT_FILE_NAME),
  });
  return data;
}

export function catalogOf(): CatalogEntry[] {
  const d = lureData();
  catalog ??= classifyResources(d.resources, d.rooms, d.anims);
  return catalog;
}
