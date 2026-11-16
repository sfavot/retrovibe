import { ResourceIndex } from "../../../src/games/gk1/data/resource-map";
import { originalFiles } from "../../support/original";

/** Fichiers réels de Gabriel Knight ; les tests qui en dépendent sont ignorés si `original/gk1` est absent. */
export const original = originalFiles("gk1", "RESOURCE.MAP");

export const PATCH_FILES = ["PATCHES/316.SND", "PATCHES/803.SND"];

let main: ResourceIndex | undefined;
let alt: ResourceIndex | undefined;

/** `RESOURCE.MAP` + `RESOURCE.000`, sans les patchs. */
export function mainIndex(): ResourceIndex {
  if (!main) {
    main = new ResourceIndex();
    main.addVolume(original.read("RESOURCE.MAP"), original.read("RESOURCE.000"), "RESOURCE.000");
  }
  return main;
}

/** `ALT.MAP` + `RESOURCE.ALT` (vues haute résolution). */
export function altIndex(): ResourceIndex {
  if (!alt) {
    alt = new ResourceIndex();
    alt.addVolume(original.read("ALT.MAP"), original.read("RESOURCE.ALT"), "RESOURCE.ALT");
  }
  return alt;
}

/** Compte les valeurs d'une liste. */
export function tally<T>(values: Iterable<T>): Map<T, number> {
  const out = new Map<T, number>();
  for (const v of values) out.set(v, (out.get(v) ?? 0) + 1);
  return out;
}

/** Somme de contrôle FNV-1a 32 bits, pour figer une image décodée. */
export function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
}
