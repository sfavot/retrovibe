import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ORIGINAL = resolve(import.meta.dirname, "../../original/mathemagique");

/** Les tests qui dépendent des fichiers du jeu sont ignorés si ceux-ci sont absents (voir `scripts/mathemagique-extract.sh`). */
export const hasOriginalFiles = existsSync(resolve(ORIGINAL, "files.json"));

/** Lit un fichier de `original/mathemagique/`, chemin relatif tel que `NIM.DAT` ou `MPC/PVG.MHK`. */
export function readOriginal(path: string): Uint8Array {
  return readFileSync(resolve(ORIGINAL, path));
}

export function readManifest(): { path: string; size: number }[] {
  return JSON.parse(readFileSync(resolve(ORIGINAL, "files.json"), "utf8"));
}

/** Chemins des 19 archives Mohawk (18 `.DAT` + `MPC/PVG.MHK`). */
export function archivePaths(): string[] {
  return readManifest()
    .map((entry) => entry.path)
    .filter((path) => /\.DAT$/i.test(path) || /\.MHK$/i.test(path))
    .sort();
}
