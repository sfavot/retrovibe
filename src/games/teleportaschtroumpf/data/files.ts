/**
 * Fichiers du jeu (`original/teleportaschtroumpf/files.json`, généré par
 * `scripts/teleportaschtroumpf/manifest.py`) : la résolution de noms est dans `src/data/game-files.ts` ;
 * ce module y ajoute ce qui est propre au jeu (dossiers de scène, extensions).
 *
 * L'EXE demande des noms en minuscules (`s22a001d.mcg`) alors que les fichiers sont rangés en
 * `DATA/S22/S22A/S22A001D.MCG` : `GameFiles.resolve` fait la correspondance, insensible à la casse.
 */

import { GameFiles as BaseGameFiles, baseName, fetchGameFileEntries } from "../../../data/game-files";

export { baseName };
export type { GameFileEntry } from "../../../data/game-files";

export interface SceneFolder {
  /** Identifiant en minuscules, par ex. `s22`. */
  id: string;
  /** Chemin du dossier de la scène, par ex. `DATA/S22`. */
  path: string;
}

/** Extension en majuscules, sans le point ; chaîne vide s'il n'y en a pas (`S20H`). */
export function extensionOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toUpperCase();
}

export class GameFiles extends BaseGameFiles {
  /** Dossiers `DATA/Snn` triés. */
  scenes(): SceneFolder[] {
    const seen = new Map<string, SceneFolder>();
    for (const { path } of this.entries) {
      const match = /^DATA\/(S\d+)\//i.exec(path);
      if (match && !seen.has(match[1])) {
        seen.set(match[1], { id: match[1].toLowerCase(), path: `DATA/${match[1]}` });
      }
    }
    return [...seen.values()];
  }
}

/** Charge `files.json` sous `base` (ex. `/teleportaschtroumpf`). */
export async function fetchGameFiles(base: string): Promise<GameFiles> {
  return new GameFiles(await fetchGameFileEntries(base));
}
