import type { SoundFiles } from "../../../audio/voice-bank";
import { GameFiles, fetchGameFileEntries } from "../../../data/game-files";
import { type Fetcher, FileStore, loadInto } from "../../../ui/file-store";
import { MissingFilesError } from "../../../ui/files";
import { SkyCpt } from "../data/cpt";
import { SkyDisk } from "../data/disk";
import type { BassData } from "../engine/game";

/**
 * Préchargement des fichiers du jeu. Le moteur lit tout par `SkyDisk` (`sky.dnr` + `sky.dsk`, 13,3 Mo : les 5 097 fichiers du jeu sauf les
 * voix) et `SkyCpt` (`sky.cpt`, 0,4 Mo) : le navigateur les charge donc **tout au départ** (13,7 Mo), sans chargement par scène. Les voix
 * des répliques (`voices/<id>.mp3`, 3 491 fichiers, 21 Mo) sont lues **à la demande** (`createVoiceFiles`), au début de chaque réplique.
 * `README-BASS.txt` et la jaquette ne sont pas chargés : ils sont servis tels quels (lien de la page d'aide, écran titre).
 */

/** Charge `files.json` sous `base` (ex. `/bass`). */
export async function fetchBassFiles(base: string): Promise<GameFiles> {
  return new GameFiles(await fetchGameFileEntries(base));
}

/** Noms des fichiers de données lus au départ. */
export const DATA_FILE_NAMES = ["sky.dsk", "sky.dnr", "sky.cpt"] as const;

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

/** Les fichiers de données chargés en mémoire, ouverts pour le moteur (`SkyDisk`, `SkyCpt`). */
export function bassDataFrom(store: FileStore): BassData & { disk: SkyDisk; cpt: SkyCpt } {
  const read = (name: string): Uint8Array => {
    const bytes = store.get(name);
    if (!bytes) throw new Error(`Fichier du jeu introuvable : ${name}`);
    return bytes;
  };
  return { disk: new SkyDisk(read("sky.dnr"), read("sky.dsk")), cpt: new SkyCpt(read("sky.cpt")) };
}

/**
 * Charge les fichiers de données (progression en fraction de 0 à 1 de leur taille) et les ouvre. Un fichier absent du manifeste ou en
 * 404 donne `MissingFilesError`.
 */
export async function loadBassData(files: GameFiles, fetcher: Fetcher, onProgress?: (fraction: number) => void): Promise<BassData & { disk: SkyDisk; cpt: SkyCpt }> {
  const store = new FileStore();
  await loadInto(store, files, baseFiles(files), fetcher, (done, total) => onProgress?.(total === 0 ? 1 : done / total));
  return bassDataFrom(store);
}

/** Chemin d'une voix dans le dossier du jeu (`data/speech.ts` : identifiants 50000 à 55277). */
export function voiceFile(id: number): string {
  return `voices/${id}.mp3`;
}

/**
 * Voix lues à la demande : `has` est synchrone (liste de `files.json` : environ 1 700 répliques n'ont pas de voix), `load` rend les
 * octets du MP3. Le décodage est gardé en cache par `VoiceBank`, pas ici.
 */
export function createVoiceFiles(files: GameFiles, fetcher: Fetcher): SoundFiles<number> {
  return {
    has: (id) => files.has(voiceFile(id)),
    load(id) {
      const path = files.resolve(voiceFile(id));
      return path === undefined ? Promise.reject(new Error(`Voix introuvable : ${id}`)) : fetcher(path);
    },
  };
}
