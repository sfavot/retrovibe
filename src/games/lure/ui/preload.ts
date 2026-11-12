import { GameFiles, fetchGameFileEntries } from "../../../data/game-files";
import { type Fetcher, FileStore, loadInto } from "../../../ui/file-store";
import { MissingFilesError } from "../../../ui/files";
import { DAT_FILE_NAME, DISK_FILE_NAMES, type LureFiles } from "../data/container";

/**
 * Préchargement des fichiers du jeu. Le moteur lit tout par `LureData`, décodé d'un coup à partir des quatre disques et de
 * `LURE-FR.DAT` : le navigateur charge donc **tout au départ** (2,7 Mo : `DISK1.VGA` à `DISK4.VGA`, `LURE-FR.DAT`), sans chargement
 * par pièce ni son à la demande (tout le son est MIDI, dans les disques). Le manuel (1,7 Mo), la licence et la jaquette ne sont pas
 * chargés : ils sont servis tels quels (liens de la page d'aide, écran titre).
 */

/** Charge `files.json` sous `base` (ex. `/lure`). */
export async function fetchLureFiles(base: string): Promise<GameFiles> {
  return new GameFiles(await fetchGameFileEntries(base));
}

/** Noms des fichiers de données, dans l'ordre : les quatre disques puis `LURE-FR.DAT`. */
export const DATA_FILE_NAMES: readonly string[] = [...DISK_FILE_NAMES, DAT_FILE_NAME];

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

/** Les fichiers de données chargés en mémoire, sous la forme que `loadLureData` attend. */
export function lureFilesFrom(store: FileStore): LureFiles {
  const read = (name: string): Uint8Array => {
    const bytes = store.get(name);
    if (!bytes) throw new Error(`Fichier du jeu introuvable : ${name}`);
    return bytes;
  };
  return { disks: DISK_FILE_NAMES.map(read) as unknown as LureFiles["disks"], dat: read(DAT_FILE_NAME) };
}

/**
 * Charge les fichiers de données (progression en fraction de 0 à 1 de leur taille) et les rend. Un fichier absent du manifeste ou en
 * 404 donne `MissingFilesError`.
 */
export async function loadLureFiles(files: GameFiles, fetcher: Fetcher, onProgress?: (fraction: number) => void): Promise<LureFiles> {
  const store = new FileStore();
  await loadInto(store, files, baseFiles(files), fetcher, (done, total) => onProgress?.(total === 0 ? 1 : done / total));
  return lureFilesFrom(store);
}
