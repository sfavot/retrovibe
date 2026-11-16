import { GameFiles, fetchGameFileEntries } from "../../../data/game-files";
import { type Fetcher, FileStore, loadInto } from "../../../ui/file-store";
import { MissingFilesError } from "../../../ui/files";
import { ResourceIndex } from "../data/resource-map";

/**
 * Préchargement de Gabriel Knight. La machine virtuelle lit ses ressources en synchrone : `RESOURCE.MAP`, `RESOURCE.000`
 * (13,3 Mo : scripts, vues, décors, polices, messages, sons MIDI) et les patchs de `PATCHES/` sont chargés **avant le départ**.
 * `VERSION` (50 octets : numéro de version, nom et date du CD) l'est aussi : les scripts l'ouvrent par `FileIO` pour afficher
 * la version du jeu et la ranger dans les sauvegardes (`engine/kernel/fileio.ts`, `GameFiles.provide`).
 * Le reste vient à la demande ou par un lien : cinématiques `SEQ/` (`movies.ts`), voix et sons numérisés (vague A2), manuel, BD
 * et jaquette. `ALT.MAP` et `RESOURCE.ALT` (vues haute résolution, 3,6 Mo) ne sont pas chargés : rien ne les lit tant que
 * `IsHiRes` répond faux (`docs/gk1/plan.md`, D4 et vague H).
 */

/** La map et son volume. */
export const MAP_FILE = "RESOURCE.MAP";
export const VOLUME_FILE = "RESOURCE.000";
/** Dossier des patchs : chaque fichier remplace la ressource de même type et de même numéro. */
export const PATCH_FOLDER = "PATCHES/";

/** Fichiers du CD que les scripts ouvrent par `FileIO` : fournis en lecture seule à la machine virtuelle sous ce nom. */
export const CD_FILES: readonly string[] = ["VERSION"];

/** Ce qui est chargé avant le départ. */
export interface PreloadedGame {
  /** Index des ressources, patchs appliqués. */
  resources: ResourceIndex;
  /** Fichiers du CD lus par les scripts, par nom (`CD_FILES`) ; un fichier absent du manifeste n'y est pas. */
  cdFiles: ReadonlyMap<string, Uint8Array>;
}

/** Charge `files.json` sous `base` (ex. `/gk1`). */
export async function fetchGk1Files(base: string): Promise<GameFiles> {
  return new GameFiles(await fetchGameFileEntries(base));
}

/** Chemins (de `files.json`) des patchs, triés. */
export function patchFiles(files: GameFiles): string[] {
  return files.list((path) => path.toUpperCase().startsWith(PATCH_FOLDER));
}

/** Chemins chargés avant de démarrer : la map, le volume, puis les patchs. Lève `MissingFilesError` (qui les nomme) si la map ou le volume manque. */
export function baseFiles(files: GameFiles): string[] {
  const paths: string[] = [];
  const missing: string[] = [];
  for (const name of [MAP_FILE, VOLUME_FILE]) {
    const path = files.resolve(name);
    if (path === undefined) missing.push(name);
    else paths.push(path);
  }
  if (missing.length > 0) throw new MissingFilesError(`fichiers absents : ${missing.join(", ")}`);
  return [...paths, ...patchFiles(files)];
}

/** Fichiers du CD lus par les scripts (`CD_FILES`) présents dans le manifeste : nom du CD et chemin de `files.json`. */
export function cdFiles(files: GameFiles): { name: string; path: string }[] {
  return CD_FILES.flatMap((name) => {
    const path = files.resolve(name);
    return path === undefined ? [] : [{ name, path }];
  });
}

/**
 * Charge les fichiers de départ (progression en fraction de 0 à 1 de leur taille) et rend l'index des ressources, patchs
 * appliqués, avec les fichiers du CD que lisent les scripts. Un fichier absent du manifeste ou en 404 donne `MissingFilesError`.
 */
export async function loadResources(files: GameFiles, fetcher: Fetcher, onProgress?: (fraction: number) => void): Promise<PreloadedGame> {
  const [map, volume, ...patches] = baseFiles(files);
  const provided = cdFiles(files);
  const store = new FileStore();
  const paths = [map, volume, ...patches, ...provided.map((file) => file.path)];
  await loadInto(store, files, paths, fetcher, (done, total) => onProgress?.(total === 0 ? 1 : done / total));
  const resources = new ResourceIndex();
  resources.addVolume(store.get(map)!, store.get(volume)!, VOLUME_FILE);
  for (const path of patches) resources.addPatch(path, store.get(path)!);
  return { resources, cdFiles: new Map(provided.map((file) => [file.name, store.get(file.path)!])) };
}
