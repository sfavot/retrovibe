/**
 * Fichiers du jeu (`original/drascula/files.json`, généré par `scripts/manifest.py`) : la résolution de
 * noms est dans `src/data/game-files.ts` ; ce module y ajoute ce qui est propre au jeu (noms des fiches
 * de pièces, des dialogues et des voix).
 *
 * Le jeu demande ses fichiers en casse arbitraire (`214.als`, `BJ1.als`, `96.alg`, `op_5.cal`) alors que
 * les fichiers sont en majuscules : `GameFiles.resolve` fait la correspondance, insensible à la casse.
 */

import { GameFiles as BaseGameFiles, baseName, fetchGameFileEntries } from "../../../data/game-files";

export { baseName };
export type { GameFileEntry } from "../../../data/game-files";

/** Extension en majuscules, sans le point ; chaîne vide s'il n'y en a pas. */
export function extensionOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toUpperCase();
}

/** Nom de la fiche d'une pièce (`14` -> `14.ald`). */
export function roomFile(room: number): string {
  return `${room}.ald`;
}

/** Nom du fichier de choix d'un dialogue (`5` -> `op_5.cal`). */
export function dialogFile(dialog: number): string {
  return `op_${dialog}.cal`;
}

/** Nom du fichier de voix `prefix` + `number` (`("BJ", 3)` -> `BJ3.als` ; préfixe vide : `214.als`). */
export function voiceFile(prefix: string, number: number): string {
  return `${prefix}${number}.als`;
}

export interface VoiceName {
  /** Préfixe de catégorie en majuscules (`D`, `BJ`, `VB`, `S`…), vide pour les répliques de `text`. */
  prefix: string;
  number: number;
}

/** Découpe un nom de fichier `.ALS` ; `null` si ce n'en est pas un. */
export function parseVoiceName(name: string): VoiceName | null {
  const match = /^([A-Z]*)(\d+)\.ALS$/i.exec(baseName(name));
  return match ? { prefix: match[1].toUpperCase(), number: Number.parseInt(match[2], 10) } : null;
}

export class GameFiles extends BaseGameFiles {
  /** Numéros des pièces qui ont une fiche `.ALD`, triés. */
  rooms(): number[] {
    return this.numbered("ALD");
  }

  /** Numéros des dialogues qui ont un fichier `OP_<n>.CAL`, triés. */
  dialogs(): number[] {
    return this.list((path) => extensionOf(path) === "CAL")
      .map((path) => /^OP_(\d+)\.CAL$/i.exec(baseName(path)))
      .flatMap((match) => (match ? [Number.parseInt(match[1], 10)] : []))
      .sort((a, b) => a - b);
  }

  /** Voix et sons `.ALS` regroupés par préfixe ; les numéros sont triés. */
  voices(): Map<string, number[]> {
    const byPrefix = new Map<string, number[]>();
    for (const path of this.list((p) => extensionOf(p) === "ALS")) {
      const voice = parseVoiceName(path);
      if (!voice) continue;
      const numbers = byPrefix.get(voice.prefix);
      if (numbers) numbers.push(voice.number);
      else byPrefix.set(voice.prefix, [voice.number]);
    }
    for (const numbers of byPrefix.values()) numbers.sort((a, b) => a - b);
    return byPrefix;
  }

  /** Fichiers `<n>.<ext>` (nom entièrement numérique), numéros triés. */
  private numbered(extension: string): number[] {
    return this.list((path) => extensionOf(path) === extension)
      .map((path) => /^(\d+)\./.exec(baseName(path)))
      .flatMap((match) => (match ? [Number.parseInt(match[1], 10)] : []))
      .sort((a, b) => a - b);
  }
}

/** Charge `files.json` sous `base` (ex. `/drascula`). */
export async function fetchGameFiles(base: string): Promise<GameFiles> {
  return new GameFiles(await fetchGameFileEntries(base));
}
