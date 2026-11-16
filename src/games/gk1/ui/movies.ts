/**
 * Fichiers des cinématiques pour le navigateur : `SEQ/<nom>` téléchargé à la première demande de `ShowMovie`, gardé ensuite.
 * Le lecteur (`render/seq-player.ts`) attend sans faire tourner les scripts tant que la réponse est `MOVIE_LOADING`.
 *
 * Branchement, dans la page qui crée la machine virtuelle : `seqPlayerOf(vm).source = movieFiles(base)`.
 * Un fichier introuvable ou en erreur est rendu absent : la cinématique est passée et le lecteur le signale.
 */
import { fetchBytes } from "../../../ui/files";
import { MOVIE_LOADING, type MovieSource } from "../render/seq-player";

const MOVIE_FOLDER = "SEQ";

/** `base` : URL du dossier des fichiers du jeu, sans barre finale. */
export function movieFiles(base: string): MovieSource {
  const files = new Map<string, Uint8Array | undefined | typeof MOVIE_LOADING>();
  return (name) => {
    if (!files.has(name)) {
      files.set(name, MOVIE_LOADING);
      fetchBytes(base, `${MOVIE_FOLDER}/${name}`).then(
        (bytes) => files.set(name, bytes),
        (error: unknown) => {
          console.error(error);
          files.set(name, undefined);
        },
      );
    }
    return files.get(name);
  };
}
