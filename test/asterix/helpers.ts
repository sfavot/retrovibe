import { originalFiles } from "../support/original";

const original = originalFiles("asterix", "ASTERIX.EXE");

/** Les tests qui dépendent des fichiers du jeu sont ignorés si ceux-ci sont absents (voir `scripts/asterix-extract.sh`). */
export const hasOriginalFiles = original.has;

/** Lit un fichier de `original/asterix/`, chemin relatif tel que `MDF/40/M40GAULE.TXT`. */
export function readOriginal(path: string): Uint8Array {
  return original.read(path);
}

/** Chemins relatifs à `original/asterix/` de tous les fichiers dont le nom satisfait `match`, triés. */
export function listOriginal(match: (name: string) => boolean = () => true): string[] {
  return original.list(match);
}

/** Filtre `listOriginal` par suffixe de nom (insensible à la casse), par ex. `.MCC` ou `.MUX.vid`. */
export function withSuffix(suffix: string): (name: string) => boolean {
  const wanted = suffix.toUpperCase();
  return (name) => name.toUpperCase().endsWith(wanted);
}

export function fromBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64"));
}
