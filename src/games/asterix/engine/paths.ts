import type { GameFiles } from "../../../data/game-files";

/** Seule langue des données du CD : le dossier `MDF` (docs/asterix/engine.md §5.4, décision D9). */
const LANGUAGE_FOLDER = "MDF";

/**
 * Développe un nom demandé par l'exécutable en chemin de `original/asterix/` (`13ef:011b`, engine.md §5.4) :
 *  - nom nu (`M21AA.MUX`, `b01-01b.voc`) : gabarit `md?\??\` + nom, où `??` sont les caractères 1 et 2 du nom (le numéro
 *    du module) ;
 *  - chemin déjà complet (`md?\nn\…`) : la lettre de langue est remplacée ;
 *  - dans les deux cas le premier `-` devient `_` (les fichiers du CD n'ont pas de tiret).
 * Renvoie `undefined` si le nom n'a aucune de ces formes.
 */
export function expandName(name: string): string | undefined {
  const normalized = name.replace(/\\/g, "/").replace("-", "_").toUpperCase();
  const full = /^MD.\/(\d\d\/[^/]+)$/.exec(normalized);
  if (full) return `${LANGUAGE_FOLDER}/${full[1]}`;
  if (normalized.includes("/") || normalized.length < 3) return undefined;
  return `${LANGUAGE_FOLDER}/${normalized.slice(1, 3)}/${normalized}`;
}

/**
 * Chemin (relatif à `original/asterix/`) d'un fichier demandé par son nom d'origine, par un chemin `md?\nn\…` ou par un
 * chemin du manifeste (`audio.json`, `MDF/06/M06AB.MUX.vid`), casse indifférente. Les suffixes des fichiers convertis
 * (`.mp3`, `.vid`) suivent le nom d'origine et gardent leur casse : celle du manifeste fait foi. `undefined` si
 * introuvable.
 */
export function resolveGameFile(files: GameFiles, name: string): string | undefined {
  const wanted = expandName(name)?.toUpperCase();
  const expanded = wanted === undefined ? undefined : files.resolveAll(wanted).find((path) => path.toUpperCase() === wanted);
  if (expanded) return expanded;
  const normalized = name.replace(/\\/g, "/");
  return files.list((path) => path.toUpperCase() === normalized.toUpperCase())[0];
}
