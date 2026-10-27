/**
 * Manifeste des fichiers du jeu (`original/zoombinis/files.json`, généré par `scripts/zoombinis-extract.sh`)
 * et résolution de noms : le contrat est celui de `src/data/game-files.ts`, partagé par les jeux.
 *
 * Les archives sont à plat dans `original/zoombinis/` (`BASECAMP.MHK`, `ZOOMBINI.MHK`, `MIDIMAP.DAT`…) ; `GameFiles.resolve`
 * fait la correspondance sans tenir compte de la casse.
 */
export { baseName, fetchGameFiles, GameFiles, type GameFileEntry } from "../../../data/game-files";
