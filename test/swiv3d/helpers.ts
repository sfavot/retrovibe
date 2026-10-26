import { originalFiles } from "../support/original";

const original = originalFiles("swiv3d", "GLOBAL.BD");

/** Les tests qui dépendent des fichiers du jeu sont ignorés si ceux-ci sont absents (voir `scripts/swiv3d-extract.sh`). */
export const hasOriginalFiles = original.has;

/** Lit un fichier de `original/swiv3d/`, tel que `ANIMS/BR_TER0.SMK`. */
export function readOriginal(path: string): Uint8Array {
  return original.read(path);
}

/** Noms des fichiers de `original/swiv3d/` qui satisfont `match`, triés. */
export function listOriginal(match: (name: string) => boolean): string[] {
  return original.list(match);
}
