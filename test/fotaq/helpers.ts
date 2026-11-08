import { originalFiles } from "../support/original";

const original = originalFiles("fotaq", "QUEEN.JAS");

/** Les tests qui dépendent des fichiers du jeu sont ignorés si ceux-ci sont absents (voir `scripts/fotaq-extract.sh`). */
export const hasOriginalFiles = original.has;

/** Lit un fichier de `original/fotaq/`, tel que `QUEEN.JAS` ou `voices/020001P2.mp3`. */
export function readOriginal(path: string): Uint8Array {
  return original.read(path);
}

/** Chemins des fichiers de `original/fotaq/` (voix comprises) dont le nom satisfait `match`, triés. */
export function listOriginal(match: (name: string) => boolean): string[] {
  return original.list(match);
}

/** Entrées de `files.json`. */
export function readManifest() {
  const manifest = original.manifest();
  if (!manifest) throw new Error("files.json absent");
  return manifest;
}

export const byExtension = (extension: string) => (name: string) => name.toUpperCase().endsWith(`.${extension}`);

/** Fichiers de données d'une extension (hors `voices/`), triés. */
export function dataFiles(extension: string): string[] {
  return listOriginal(byExtension(extension)).filter((path) => !path.includes("/"));
}
