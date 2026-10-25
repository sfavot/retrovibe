import { originalFiles } from "../support/original";

const original = originalFiles("armaeth", "AM1.EXE");

/** Les tests qui dépendent des fichiers du jeu sont ignorés si ceux-ci sont absents (voir `scripts/armaeth-extract.sh`). */
export const hasOriginalFiles = original.has;

/** Lit un fichier de `original/armaeth/`, tel que `A1F00A.VGA`. */
export function readOriginal(path: string): Uint8Array {
  return original.read(path);
}

/** Noms des fichiers de `original/armaeth/` qui satisfont `match`, triés. */
export function listOriginal(match: (name: string) => boolean): string[] {
  return original.list(match);
}
