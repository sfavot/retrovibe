import { prefixedStorage } from "../../../engine/storage";
import { localStorageStore } from "../../../ui/local-storage";
import { type TitleActions, renderTitle as renderGameTitle } from "../../../ui/point-click-pages";
import { copy } from "../copy";
import type { VoyageursSave } from "../engine/save";
import { SAVE_PREFIX, type VoyageursSlots, createSaveSlots, describeSave, summarizeSlots } from "./saves";

/** Dossier des fichiers du jeu (servi depuis `original/voyageurs/`). */
export const GAME_URL = `${import.meta.env.BASE_URL}voyageurs`;
/** Jaquette : un décor de la première scène (pixel art 320×200), générée par `scripts/voyageurs-cover.mts`. */
export const COVER_URL = `${GAME_URL}/COVER.png`;
export const COVER_SIZE: [number, number] = [320, 200];

/** Les emplacements de sauvegarde du navigateur (`voyageurs:slot01`…). */
export function browserSaveSlots(): VoyageursSlots {
  return createSaveSlots(prefixedStorage(localStorageStore(), SAVE_PREFIX));
}

/** Écran de présentation (composant commun des jeux de pointer-et-cliquer : `ui/point-click-pages.ts`). */
export function renderTitle(actions: TitleActions<VoyageursSave>): HTMLElement {
  const slots = browserSaveSlots();
  return renderGameTitle({ copy, cover: { url: COVER_URL, size: COVER_SIZE }, slots, describe: describeSave, summaries: () => summarizeSlots(slots), actions });
}
