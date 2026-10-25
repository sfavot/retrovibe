/** Un fichier du jeu manque (`files.json` absent, ressource en 404) : le jeu n'est pas installé, ce n'est pas un bogue d'exécution. */
export class MissingFilesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingFilesError";
  }
}

/**
 * Télécharge un fichier du jeu. `base` : URL du dossier des fichiers, sans barre finale (ex. `./teleportaschtroumpf`) ;
 * `path` : chemin relatif réel (déjà résolu par `GameFiles.resolve`), encodé segment par segment.
 * 404 -> `MissingFilesError` ; toute autre erreur HTTP -> `Error`.
 */
export async function fetchBytes(base: string, path: string): Promise<Uint8Array> {
  const url = `${base}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(url);
  if (response.status === 404) throw new MissingFilesError(`${path} : HTTP 404`);
  if (!response.ok) throw new Error(`${path} : HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
