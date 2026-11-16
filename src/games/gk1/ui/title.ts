import { prefixedStorage } from "../../../engine/storage";
import { localStorageStore } from "../../../ui/local-storage";
import { type TitleActions, renderTitle as renderGameTitle } from "../../../ui/point-click-pages";
import { copy } from "../copy";
import { type Gk1SaveSlots, type SaveData, SAVE_PREFIX, createSaveSlots, describeSave, summarizeSlots } from "./saves";

/** Dossier des fichiers du jeu (servi depuis `original/gk1/`). */
export const GAME_URL = `${import.meta.env.BASE_URL}gk1`;
/** Jaquette : l'écran titre du jeu, 320 × 200, composé par notre moteur (`scripts/gk1/cover.mts`). */
export const COVER_URL = `${GAME_URL}/COVER.webp`;
export const COVER_SIZE: [number, number] = [320, 200];

/** Les emplacements de sauvegarde du navigateur (`gk1:slot01`…). */
export function browserSaveSlots(): Gk1SaveSlots {
  return createSaveSlots(prefixedStorage(localStorageStore(), SAVE_PREFIX));
}

/**
 * Écran de présentation (composant commun des jeux de pointer-et-cliquer : `ui/point-click-pages.ts`). « Continuer » et
 * « Charger une partie » n'apparaissent que s'il existe une sauvegarde lisible (`saves.ts`).
 */
export function renderTitle(actions: TitleActions<SaveData>): HTMLElement {
  const slots = browserSaveSlots();
  return renderGameTitle({ copy, cover: { url: COVER_URL, size: COVER_SIZE, pixelated: true }, slots, describe: describeSave, summaries: () => summarizeSlots(slots), actions });
}
