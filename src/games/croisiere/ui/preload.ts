import { GameFiles, fetchGameFileEntries } from "../../../data/game-files";
import { type Fetcher, FileStore, loadInto } from "../../../ui/file-store";
import { MissingFilesError } from "../../../ui/files";
import { CruiseVolumes } from "../data/volumes";
import type { GameFiles as EngineFiles } from "../engine/overlays";

/**
 * Préchargement des fichiers du jeu. Le moteur lit tout en synchrone dans les volumes d'origine (`D1` à `D5`, catalogue `VOL.CNF`,
 * plan.md D2), plus deux fichiers libres : `SYSTEM.FNT` (police des menus) et `DELPHINE.LNG` (textes du menu joueur, de l'inventaire…).
 * Le navigateur charge donc **tout au départ** (3,5 Mo) ; chaque fichier des volumes est dépaqueté quand le moteur le lit, comme le jeu.
 * `LISEZ.MOI` et la jaquette ne sont pas chargés.
 */

/** Charge `files.json` sous `base` (ex. `/croisiere`). */
export async function fetchCroisiereFiles(base: string): Promise<GameFiles> {
  return new GameFiles(await fetchGameFileEntries(base));
}

/** Volumes et catalogue. */
const VOLUME_FILES = ["VOL.CNF", "D1", "D2", "D3", "D4", "D5"] as const;
/** Fichiers lus hors des volumes. */
export const LOOSE_FILES = ["SYSTEM.FNT", "DELPHINE.LNG"] as const;
/** Noms des fichiers lus au départ. */
export const DATA_FILE_NAMES = [...VOLUME_FILES, ...LOOSE_FILES] as const;

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

/** Les fichiers chargés, ouverts pour le moteur : les volumes, puis les fichiers libres (qui priment). */
export function engineFilesFrom(store: FileStore): EngineFiles {
  const read = (name: string): Uint8Array => {
    const bytes = store.get(name);
    if (!bytes) throw new Error(`Fichier du jeu introuvable : ${name}`);
    return bytes;
  };
  const volumes = CruiseVolumes.open(read);
  const loose = new Map<string, Uint8Array>(LOOSE_FILES.map((name) => [name, read(name)]));
  return {
    has: (name) => loose.has(name.toUpperCase()) || volumes.has(name),
    readFile: (name) => loose.get(name.toUpperCase()) ?? volumes.readFile(name),
  };
}

/**
 * Charge les fichiers de données (progression en fraction de 0 à 1 de leur taille) et les ouvre. Un fichier absent du manifeste ou en
 * 404 donne `MissingFilesError`.
 */
export async function loadCroisiereData(files: GameFiles, fetcher: Fetcher, onProgress?: (fraction: number) => void): Promise<EngineFiles> {
  const store = new FileStore();
  await loadInto(store, files, baseFiles(files), fetcher, (done, total) => onProgress?.(total === 0 ? 1 : done / total));
  return engineFilesFrom(store);
}
