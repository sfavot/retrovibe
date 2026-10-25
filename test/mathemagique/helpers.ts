import { originalFiles } from "../support/original";

const original = originalFiles("mathemagique", "files.json");

/** Les tests qui dépendent des fichiers du jeu sont ignorés si ceux-ci sont absents (voir `scripts/mathemagique-extract.sh`). */
export const hasOriginalFiles = original.has;

/** Lit un fichier de `original/mathemagique/`, chemin relatif tel que `NIM.DAT` ou `MPC/PVG.MHK`. */
export function readOriginal(path: string): Uint8Array {
  return original.read(path);
}

export function readManifest(): { path: string; size: number }[] {
  const manifest = original.manifest();
  if (!manifest) throw new Error("original/mathemagique/files.json absent (voir scripts/mathemagique-extract.sh)");
  return manifest;
}

/** Chemins des 19 archives Mohawk (18 `.DAT` + `MPC/PVG.MHK`). */
export function archivePaths(): string[] {
  return readManifest()
    .map((entry) => entry.path)
    .filter((path) => /\.DAT$/i.test(path) || /\.MHK$/i.test(path))
    .sort();
}
