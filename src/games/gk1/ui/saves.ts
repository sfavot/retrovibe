import { decodeCp850, encodeCp850 } from "../../../data/cp850";
import { SaveSlots, type SlotSummary, type StoredSave } from "../../../engine/save-slots";
import type { HostStorage } from "../../../engine/storage";
import { copy } from "../copy";
import { parseSaveImage, SAVE_NAME_LENGTH, SAVE_SLOT_COUNT, type SaveImage } from "../engine/save-image";

/**
 * Emplacements de sauvegarde de Gabriel Knight vus de la page (`docs/gk1/plan.md`, D10) : les mêmes que ceux des fenêtres du
 * jeu (`engine/save.ts`), 20 comme dans l'original. Une partie sauvée par la fenêtre du jeu se reprend par « Continuer » ou
 * « Charger » de la page, et inversement. Ce module ne charge pas le moteur : l'écran titre s'en sert.
 */

/** État d'une partie : l'image de la machine virtuelle. */
export type SaveData = SaveImage;
export type Gk1SaveSlots = SaveSlots<SaveData>;

/** Préfixe des clés du jeu dans le stockage (`gk1:slot01`…). */
export const SAVE_PREFIX = "gk1:";
export const SLOT_COUNT = SAVE_SLOT_COUNT;

/** Les emplacements de sauvegarde sur `store` (déjà préfixé par `SAVE_PREFIX`). */
export function createSaveSlots(store: HostStorage): Gk1SaveSlots {
  return new SaveSlots<SaveData>(store, { count: SLOT_COUNT, parse: parseSaveImage, name: copy.title });
}

/** Nom d'une sauvegarde tel que le joueur l'a tapé (les chaînes du jeu sont en CP850, un caractère par octet). */
export function describeSave(stored: StoredSave<SaveData>): string {
  return decodeCp850(Uint8Array.from(stored.save.name, (character) => character.charCodeAt(0))) || copy.saveUnnamed;
}

/** Nom donné à une partie sauvée par le menu de la page, qui ne demande pas de nom : la date et l'heure, dans le jeu de caractères du jeu. */
export function defaultSaveName(date: Date): string {
  return String.fromCharCode(...encodeCp850(copy.saveDefaultName(date))).slice(0, SAVE_NAME_LENGTH);
}

/** Les `SLOT_COUNT` emplacements, dans l'ordre, pour le sélecteur. */
export function summarizeSlots(slots: Gk1SaveSlots): SlotSummary[] {
  return slots.summaries(describeSave, copy.saveSlot);
}
