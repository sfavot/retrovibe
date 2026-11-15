import { prefixedStorage } from "../../../engine/storage";
import { localStorageStore } from "../../../ui/local-storage";
import { type TitleActions, renderTitle as renderGameTitle } from "../../../ui/point-click-pages";
import { copy } from "../copy";
import type { SaveData } from "../engine/save";
import { type LureSaveSlots, SAVE_PREFIX, createSaveSlots, describeSave, summarizeSlots } from "./saves";

/** Dossier des fichiers du jeu (servi depuis `original/lure/`). */
export const GAME_URL = `${import.meta.env.BASE_URL}lure`;
/** Jaquette : la boîte d'origine (Wikipédia anglophone, image de l'infobox). */
export const COVER_URL = `${GAME_URL}/COVER.webp`;
export const COVER_SIZE: [number, number] = [276, 360];

/** Les emplacements de sauvegarde du navigateur (`lure:slot01`…). */
export function browserSaveSlots(): LureSaveSlots {
  return createSaveSlots(prefixedStorage(localStorageStore(), SAVE_PREFIX));
}

/** Écran de présentation (composant commun des jeux de pointer-et-cliquer : `ui/point-click-pages.ts`). */
export function renderTitle(actions: TitleActions<SaveData>): HTMLElement {
  const slots = browserSaveSlots();
  return renderGameTitle({ copy, cover: { url: COVER_URL, size: COVER_SIZE, pixelated: false }, slots, describe: describeSave, summaries: () => summarizeSlots(slots), actions });
}
