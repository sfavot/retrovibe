import { originalFiles } from "../support/original";

const original = originalFiles("teleportaschtroumpf/DATA", "DESCRIPT.ION");

/** Les tests qui dépendent des fichiers du jeu sont ignorés si ceux-ci sont absents (voir `scripts/teleportaschtroumpf-extract.sh`). */
export const hasOriginalFiles = original.has;

/** Lit un fichier de `original/teleportaschtroumpf/DATA/`, chemin relatif tel que `S05/S05A/S05A.MCG`. */
export function readData(path: string): Uint8Array {
  return original.read(path);
}

/** Chemins relatifs à `DATA/` de tous les fichiers dont le nom satisfait `match`, triés. */
export function listData(match: (name: string) => boolean): string[] {
  return original.list(match);
}

/** Filtre `listData` par extension (insensible à la casse, sans le point). */
export function withExtension(ext: string): (name: string) => boolean {
  const suffix = `.${ext.toUpperCase()}`;
  return (name) => name.toUpperCase().endsWith(suffix);
}
