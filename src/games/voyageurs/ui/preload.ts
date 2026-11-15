import { GameFiles, fetchGameFileEntries } from "../../../data/game-files";
import { type Fetcher, FileStore, loadInto } from "../../../ui/file-store";
import { MissingFilesError } from "../../../ui/files";
import type { VoyageursFiles } from "../engine/part";

/**
 * Préchargement des fichiers du jeu. Le moteur lit tout en synchrone : les six fichiers du jeu (`PART01` à `PART04B`, `AUTO00.PRC`,
 * `TEXTE.DAT`, 0,9 Mo en tout) sont donc chargés **au départ**. La musique (`music/trackNN.mp3`, 17 Mo) est lue en flux à la demande par
 * `TrackMusicOutput`, la jaquette est servie telle quelle (écran titre).
 */

/** Charge `files.json` sous `base` (ex. `/voyageurs`). */
export async function fetchVoyageursFiles(base: string): Promise<GameFiles> {
  return new GameFiles(await fetchGameFileEntries(base));
}

/** Fichiers de données lus au départ. */
export const DATA_FILE_NAMES = ["PART01", "PART02", "PART03", "PART04", "PART04B", "AUTO00.PRC", "TEXTE.DAT"] as const;

/** Chemins (de `files.json`) chargés avant de démarrer. Lève `MissingFilesError` (qui les nomme) si l'un manque. */
export function baseFiles(files: GameFiles): string[] {
  const paths: string[] = [];
  const missing: string[] = [];
  for (const name of DATA_FILE_NAMES) {
    const path = files.resolve(name);
    if (path === undefined) missing.push(name);
    else paths.push(path);
  }
  if (missing.length > 0) throw new MissingFilesError(`fichiers absents : ${missing.join(", ")}`);
  return paths;
}

/** Les fichiers chargés en mémoire, tels que le moteur les lit. */
export function voyageursFilesFrom(store: FileStore): VoyageursFiles {
  return { read: (name) => store.get(name) ?? null };
}

/** Charge les fichiers de données (progression en fraction de 0 à 1 de leur taille). Un fichier absent du manifeste ou en 404 donne `MissingFilesError`. */
export async function loadVoyageursFiles(files: GameFiles, fetcher: Fetcher, onProgress?: (fraction: number) => void): Promise<VoyageursFiles> {
  const store = new FileStore();
  await loadInto(store, files, baseFiles(files), fetcher, (done, total) => onProgress?.(total === 0 ? 1 : done / total));
  return voyageursFilesFrom(store);
}
