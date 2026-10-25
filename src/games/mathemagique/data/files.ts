/**
 * Manifeste des fichiers du jeu (`original/mathemagique/files.json`, généré par `scripts/manifest.py`)
 * et résolution de noms : le contrat est celui de `src/data/game-files.ts`, partagé par les jeux.
 *
 * L'EXE demande des noms en casse mixte (`nim.DAT`, `PatFill.DAT`, `milkyway.dat`) alors que les fichiers
 * sont rangés en `NIM.DAT`, `PATFILL.DAT`, `MPC/PVG.MHK` : `GameFiles.resolve` fait la correspondance,
 * insensible à la casse.
 */
export { baseName, fetchGameFiles, GameFiles, type GameFileEntry } from "../../../data/game-files";
