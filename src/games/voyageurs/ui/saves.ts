import type { SlotSummary, StoredSave as StoredSlot } from "../../../engine/save-slots";
import type { SaveSlots } from "../../../engine/save-slots";
import type { HostStorage } from "../../../engine/storage";
import { copy } from "../copy";
import type { VoyageursEngine } from "../engine/game";
import { type VoyageursSave, describeSave as describeSaveData, voyageursSaveSlots } from "../engine/save";

/**
 * Emplacements de sauvegarde des *Voyageurs du temps* dans un stockage clé / valeur (D10) : la mécanique (clés, JSON, valeur illisible ou
 * d'une autre version = emplacement vide) est celle de `engine/save.ts` (`voyageursSaveSlots`, `SaveSlots`) ; ici le préfixe, la
 * description d'un emplacement plein (décor et date) et les passerelles vers le moteur (`save`, `load`).
 *
 * C'est l'hôte qui préfixe : `prefixedStorage(store, SAVE_PREFIX)` est ce qu'on passe à `createSaveSlots`. Dix emplacements, de 1 à 10.
 */

/** Préfixe des clés du jeu dans le stockage (`voyageurs:slot01`…). */
export const SAVE_PREFIX = "voyageurs:";

export type StoredSave = StoredSlot<VoyageursSave>;
export type VoyageursSlots = SaveSlots<VoyageursSave>;
export type { SlotSummary };

/** Résultat de `saveToSlot` : `saved`, `refused` (le moteur ne peut pas sauvegarder maintenant) ou `failed` (le stockage a refusé l'écriture). */
export type SaveResult = "saved" | "refused" | "failed";
/** Résultat de `loadFromSlot` : `empty` = rien (ou rien de lisible) dans l'emplacement, `failed` = la partie n'a pas pu être reprise. */
export type LoadResult = "loaded" | "empty" | "failed";

/** Date lisible, dans la langue du site. */
function formatDate(savedAt: number): string {
  return new Date(savedAt).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Texte d'un emplacement plein : le décor et la date. */
export function describeSave(stored: StoredSave): string {
  return copy.saveDescription(copy.backgroundName(describeSaveData(stored.save).bg), formatDate(stored.savedAt));
}

/** Les emplacements de sauvegarde sur `store` (déjà préfixé par `SAVE_PREFIX`). */
export function createSaveSlots(store: HostStorage): VoyageursSlots {
  return voyageursSaveSlots(store);
}

/** Les emplacements, dans l'ordre, pour le sélecteur. */
export function summarizeSlots(slots: VoyageursSlots): SlotSummary[] {
  return slots.summaries(describeSave, copy.saveSlot);
}

/** Sauvegarde la partie dans l'emplacement `slot` (`now` : `Date.now()` pour l'hôte). Refusée quand `engine.canSave()` est faux. */
export function saveToSlot(engine: Pick<VoyageursEngine, "save">, slots: VoyageursSlots, slot: number, now: number): SaveResult {
  const save = engine.save();
  if (!save) return "refused";
  return slots.write(slot, save, now) ? "saved" : "failed";
}

/** Charge l'emplacement `slot` dans le moteur (la reprise abandonne le tick en cours). Une erreur du moteur (fichier manquant) donne `failed`. */
export function loadFromSlot(engine: Pick<VoyageursEngine, "load">, slots: VoyageursSlots, slot: number): LoadResult {
  const stored = slots.read(slot);
  if (!stored) return "empty";
  try {
    engine.load(stored.save);
    return "loaded";
  } catch (error) {
    console.error(error);
    return "failed";
  }
}

/** Le message à montrer au joueur après `saveToSlot` / `loadFromSlot`. */
export function resultMessage(result: SaveResult | LoadResult, kind: "save" | "load"): string {
  if (result === "saved") return copy.saveDone;
  if (result === "loaded") return copy.loadDone;
  if (result === "empty") return copy.loadEmpty;
  if (result === "refused") return copy.saveBusy;
  return kind === "save" ? copy.saveFailed : copy.loadFailed;
}
