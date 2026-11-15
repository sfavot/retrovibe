import { prefixedStorage } from "../../../engine/storage";
import { localStorageStore } from "../../../ui/local-storage";
import { type TitleActions, renderTitle as renderGameTitle } from "../../../ui/point-click-pages";
import { copy } from "../copy";
import { type CroisiereSaveSlots, SAVE_PREFIX, type SlotData, createSaveSlots, describeSave, summarizeSlots } from "./saves";

/** Dossier des fichiers du jeu (servi depuis `original/croisiere/`). */
export const GAME_URL = `${import.meta.env.BASE_URL}croisiere`;
/** Jaquette : l'écran titre du jeu (pixel art 320×200), composé par le moteur (`scripts/croisiere/cover.mts`). */
export const COVER_URL = `${GAME_URL}/COVER.png`;
export const COVER_SIZE: [number, number] = [320, 200];

/** Les emplacements de sauvegarde du navigateur (`croisiere:slot01`…). */
export function browserSaveSlots(): CroisiereSaveSlots {
  return createSaveSlots(prefixedStorage(localStorageStore(), SAVE_PREFIX));
}

/** Écran de présentation (composant commun des jeux de pointer-et-cliquer : `ui/point-click-pages.ts`). */
export function renderTitle(actions: TitleActions<SlotData>): HTMLElement {
  const slots = browserSaveSlots();
  return renderGameTitle({ copy, cover: { url: COVER_URL, size: COVER_SIZE, pixelated: true }, slots, describe: describeSave, summaries: () => summarizeSlots(slots), actions });
}
