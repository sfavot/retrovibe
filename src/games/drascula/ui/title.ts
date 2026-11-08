import { prefixedStorage } from "../../../engine/storage";
import { localStorageStore } from "../../../ui/local-storage";
import { type TitleActions, renderTitle as renderGameTitle } from "../../../ui/point-click-pages";
import { copy } from "../copy";
import { SAVE_PREFIX, type DrasculaSaveSlots, type StoredSave, createSaveSlots, describeSave, summarizeSlots } from "./saves";

/** Dossier des fichiers du jeu (servi depuis `original/drascula/`). */
export const GAME_URL = `${import.meta.env.BASE_URL}drascula`;
/** Jaquette : une image du jeu (pixel art 320×200), générée par `scripts/drascula-cover.mts`. */
export const COVER_URL = `${GAME_URL}/COVER.png`;
export const COVER_SIZE: [number, number] = [320, 200];

/** Les emplacements de sauvegarde du navigateur (`drascula:slot01`…). */
export function browserSaveSlots(): DrasculaSaveSlots {
  return createSaveSlots(prefixedStorage(localStorageStore(), SAVE_PREFIX));
}

/** Écran de présentation de Drascula (composant commun des jeux de pointer-et-cliquer : `ui/point-click-pages.ts`). */
export function renderTitle(actions: TitleActions<StoredSave["save"]>): HTMLElement {
  const slots = browserSaveSlots();
  return renderGameTitle({ copy, cover: { url: COVER_URL, size: COVER_SIZE }, slots, describe: describeSave, summaries: () => summarizeSlots(slots), actions });
}
