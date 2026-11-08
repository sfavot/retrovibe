import { type GameFiles, baseName } from "../data/game-files";

/**
 * Magasin de fichiers préchargés des jeux dont le moteur lit ses fichiers en synchrone (`host.readFile`) : l'hôte du navigateur les
 * charge avant de s'en servir. Commun à Drascula (images et vidéos par chapitre) et à Flight of the Amazon Queen (données au départ,
 * décors par pièce). Les voix et la musique, lues à la demande, ne passent pas par là.
 */

/** Fichiers du jeu en mémoire, par nom (casse indifférente, dossier ignoré) : ce que lit `readFile` du moteur. */
export class FileStore {
  private readonly bytes = new Map<string, Uint8Array>();

  private static key(name: string): string {
    return baseName(name).toUpperCase();
  }

  has(name: string): boolean {
    return this.bytes.has(FileStore.key(name));
  }

  get(name: string): Uint8Array | undefined {
    return this.bytes.get(FileStore.key(name));
  }

  set(name: string, data: Uint8Array): void {
    this.bytes.set(FileStore.key(name), data);
  }

  get size(): number {
    return this.bytes.size;
  }
}

/** Chargeur d'un fichier (`fetchBytes(base, chemin)`) ; injecté pour les tests. */
export type Fetcher = (path: string) => Promise<Uint8Array>;

/** Fichiers chargés en même temps au plus. */
const CONCURRENCY = 8;

/**
 * Charge `paths` dans `store` (ceux qui y sont déjà sont sautés) par petits lots ; `onProgress(chargé, total)` compte en octets
 * (taille du manifeste). Une erreur arrête les chargements non commencés et est relancée.
 */
export async function loadInto(
  store: FileStore,
  files: GameFiles,
  paths: readonly string[],
  fetcher: Fetcher,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const wanted = paths.filter((path) => !store.has(path));
  const sizeOf = (path: string): number => files.size(path) ?? 0;
  const total = wanted.reduce((sum, path) => sum + sizeOf(path), 0);
  let done = 0;
  let next = 0;
  let failure: unknown;
  let failed = false;
  onProgress?.(0, total);
  const worker = async (): Promise<void> => {
    while (!failed && next < wanted.length) {
      const path = wanted[next++];
      try {
        store.set(path, await fetcher(path));
      } catch (error) {
        failed = true;
        failure = error;
        return;
      }
      done += sizeOf(path);
      onProgress?.(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, wanted.length) }, worker));
  if (failed) throw failure;
}
