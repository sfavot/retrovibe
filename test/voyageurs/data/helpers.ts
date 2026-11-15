import { createHash } from "node:crypto";
import { Bundle } from "../../../src/games/voyageurs/data/bundle";
import { originalFiles } from "../../support/original";

const original = originalFiles("voyageurs", "PART01");

export const BUNDLE_NAMES = ["PART01", "PART02", "PART03", "PART04", "PART04B"] as const;
export type BundleName = (typeof BUNDLE_NAMES)[number];

/** Faux si `original/voyageurs/` n'est pas installé : les tests sur les vrais fichiers sont alors ignorés. */
export const hasOriginalFiles = original.has && [...BUNDLE_NAMES, "AUTO00.PRC", "TEXTE.DAT"].every((name) => original.list((n) => n === name).length === 1);

export function readOriginal(name: string): Uint8Array {
  return original.read(name);
}

const bundles = new Map<BundleName, Bundle>();

/** Bundle ouvert une seule fois pour toute la série de tests. */
export function bundle(name: BundleName): Bundle {
  let cached = bundles.get(name);
  if (!cached) {
    cached = new Bundle(readOriginal(name));
    bundles.set(name, cached);
  }
  return cached;
}

export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Extension en majuscules d'un nom de fichier (sans le point), ou vide. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toUpperCase();
}
