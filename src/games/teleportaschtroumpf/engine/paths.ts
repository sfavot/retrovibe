import type { GameFiles } from "../data/files";

/**
 * Développe un nom `sNNxXXX.ext` en `DATA/SNN/SNNx/SNNXXX.EXT` (gabarit `s??\s???\` de `134d:03af`, §7 de engine.md).
 * Renvoie `undefined` si le nom n'a pas cette forme.
 */
export function expandName(name: string): string | undefined {
  const match = /^(s\d\d)([a-z])([^/\\]*)$/i.exec(name);
  if (!match) return undefined;
  const scene = match[1].toUpperCase();
  return `DATA/${scene}/${scene}${match[2].toUpperCase()}/${name.toUpperCase()}`;
}

/**
 * Chemin (relatif à `original/teleportaschtroumpf/`) d'un fichier demandé par nom d'origine ou chemin `DATA/...`.
 * Ordre : chemin explicite (casse indifférente), puis nom développé par `expandName` s'il est dans le manifeste,
 * puis recherche par nom de fichier. `undefined` si introuvable.
 */
export function resolveGameFile(files: GameFiles, name: string): string | undefined {
  const normalized = name.replace(/\\/g, "/");
  if (normalized.includes("/")) {
    const wanted = normalized.toUpperCase();
    return files.resolveAll(normalized).find((path) => path.toUpperCase() === wanted);
  }
  const expanded = expandName(normalized);
  if (expanded && files.size(expanded) !== undefined) return expanded;
  return files.resolve(normalized);
}

/** Voix parlée `sNNv` + numéro sur 3 chiffres + `t.voc` (`15f9:0db1`) : `voiceName("s07v", 4)` → `s07v004t.voc`. */
export function voiceName(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(3, "0")}t.voc`;
}

/** Musique de fond `s52m00Nm.voc`, N de 1 à 3. */
export function musicName(n: number): string {
  return `s52m00${n}m.voc`;
}
