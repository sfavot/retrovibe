/**
 * Fichiers de l'audio numérique pour le navigateur (`DigitalFiles` de `audio/digital.ts`) : les `index.json` et `sync.json`
 * d'un module sont téléchargés à la première demande et gardés ; les MP3 sont téléchargés à chaque lecture (le son décodé,
 * lui, est gardé par `digital.ts`). `audio/index.json` est demandé dès la création : `DoSound` ne sait pas attendre.
 *
 * Branchement, dans la page qui crée la machine virtuelle : `digitalAudioOf(vm).files = digitalFiles(base, chemins)`, où
 * `chemins` est la liste de `files.json`. Un fichier introuvable ou en erreur est rendu absent : le jeu continue en texte seul.
 */
import { fetchBytes } from "../../../ui/files";
import { DIGITAL_LOADING, type DigitalFiles, type DigitalLoading } from "../audio/digital";
import { AUDIO_INDEX_PATH } from "../data/audio-index";

/** `base` : URL du dossier des fichiers du jeu, sans barre finale ; `paths` : chemins du manifeste. */
export function digitalFiles(base: string, paths: Iterable<string>): DigitalFiles {
  const known = new Set(paths);
  const texts = new Map<string, string | undefined | DigitalLoading>();
  const decoder = new TextDecoder();
  const text = (path: string): string | undefined | DigitalLoading => {
    if (!known.has(path)) return undefined;
    if (!texts.has(path)) {
      texts.set(path, DIGITAL_LOADING);
      fetchBytes(base, path).then(
        (bytes) => texts.set(path, decoder.decode(bytes)),
        (error: unknown) => {
          console.error(error);
          texts.set(path, undefined);
        },
      );
    }
    return texts.get(path);
  };
  text(AUDIO_INDEX_PATH);
  return { has: (path) => known.has(path), text, load: (path) => fetchBytes(base, path) };
}
