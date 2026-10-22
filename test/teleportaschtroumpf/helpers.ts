import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const ORIGINAL = resolve(import.meta.dirname, "../../original/teleportaschtroumpf");
const DATA = resolve(ORIGINAL, "DATA");

/** Les tests qui dépendent des fichiers du jeu sont ignorés si ceux-ci sont absents (voir `scripts/teleportaschtroumpf-extract.sh`). */
export const hasOriginalFiles = existsSync(resolve(DATA, "DESCRIPT.ION"));

/** Lit un fichier de `original/teleportaschtroumpf/DATA/`, chemin relatif tel que `S05/S05A/S05A.MCG`. */
export function readData(path: string): Uint8Array {
  return readFileSync(resolve(DATA, path));
}

/** Chemins relatifs à `DATA/` de tous les fichiers dont le nom satisfait `match`, triés. */
export function listData(match: (name: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (match(entry.name)) out.push(relative(DATA, full));
    }
  };
  if (hasOriginalFiles) walk(DATA);
  return out.sort();
}

/** Filtre `listData` par extension (insensible à la casse, sans le point). */
export function withExtension(ext: string): (name: string) => boolean {
  const suffix = `.${ext.toUpperCase()}`;
  return (name) => name.toUpperCase().endsWith(suffix);
}
