import { prefixedStorage } from "../../../engine/storage";
import { localStorageStore } from "../../../ui/local-storage";
import { type TitleActions, renderTitle as renderGameTitle } from "../../../ui/point-click-pages";
import { copy } from "../copy";
import type { SaveData } from "../engine/save";
import { type FotaqSaveSlots, SAVE_PREFIX, createSaveSlots, describeSave, summarizeSlots } from "./saves";

/** Dossier des fichiers du jeu (servi depuis `original/fotaq/`). */
export const GAME_URL = `${import.meta.env.BASE_URL}fotaq`;
/** Jaquette : la boîte d'origine (Wikipédia anglophone, image de l'infobox). */
export const COVER_URL = `${GAME_URL}/COVER.webp`;
export const COVER_SIZE: [number, number] = [280, 357];

/** Les emplacements de sauvegarde du navigateur (`fotaq:slot01`…). */
export function browserSaveSlots(): FotaqSaveSlots {
  return createSaveSlots(prefixedStorage(localStorageStore(), SAVE_PREFIX));
}

/** Écran de présentation (composant commun des jeux de pointer-et-cliquer : `ui/point-click-pages.ts`). */
export function renderTitle(actions: TitleActions<SaveData>): HTMLElement {
  const slots = browserSaveSlots();
  return renderGameTitle({ copy, cover: { url: COVER_URL, size: COVER_SIZE, pixelated: false }, slots, describe: describeSave, summaries: () => summarizeSlots(slots), actions });
}
