import { SaveSlots, type SlotSummary, type StoredSave as StoredSlot } from "../../../engine/save-slots";
import type { HostStorage } from "../../../engine/storage";
import { copy } from "../copy";
import type { CroisiereSave } from "../engine/save";

/**
 * Emplacements de sauvegarde de *Croisière pour un cadavre* (plan.md D5) : comme Lure et BASS, la mécanique (clés, JSON, valeur illisible
 * = emplacement vide, écriture refusée signalée) est celle de `src/engine/save-slots.ts`. Le contenu vient de `engine/save.ts`
 * (`captureSave`) ; on y joint le lieu (`describeSave` du moteur, calculé au moment de sauvegarder), que l'écran titre et les fenêtres
 * affichent sans reconstruire de moteur. Ce module n'importe du moteur que des types : l'écran titre (page d'accueil) reste léger.
 *
 * C'est l'hôte qui préfixe : `prefixedStorage(store, SAVE_PREFIX)` est ce qu'on passe à `createSaveSlots`. Dix emplacements, de 1 à 10.
 */

/** Préfixe des clés du jeu dans le stockage (`croisiere:slot01`…). */
export const SAVE_PREFIX = "croisiere:";
/** Nombre d'emplacements. */
export const SLOT_COUNT = 10;

/** Ce qu'un emplacement contient : le lieu affiché et l'état du moteur. */
export interface SlotData {
  place: string;
  state: CroisiereSave;
}

export type StoredSave = StoredSlot<SlotData>;
export type CroisiereSaveSlots = SaveSlots<SlotData>;
export type { SlotSummary };

/** Résultat de `saveToSlot` : `saved`, `refused` (le jeu ne permet pas de sauvegarder maintenant) ou `failed` (stockage plein ou bloqué). */
export type SaveResult = "saved" | "refused" | "failed";

/** Valeur lue sous `save` : un objet `{ place, state }`, sinon `null` (emplacement vu comme vide). La validation fine est celle du moteur. */
export function parseSlot(value: unknown): SlotData | null {
  if (value === null || typeof value !== "object") return null;
  const { place, state } = value as Partial<SlotData>;
  if (typeof place !== "string" || state === null || typeof state !== "object") return null;
  return { place, state };
}

/** Date lisible, dans la langue du site. */
function formatDate(savedAt: number): string {
  return new Date(savedAt).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Texte d'un emplacement plein : le lieu et la date. */
export function describeSave(stored: StoredSave): string {
  return copy.saveDescription(stored.save.place, formatDate(stored.savedAt));
}

/** Les emplacements de sauvegarde sur `store` (déjà préfixé par `SAVE_PREFIX`). */
export function createSaveSlots(store: HostStorage): CroisiereSaveSlots {
  return new SaveSlots(store, { count: SLOT_COUNT, parse: parseSlot, name: "Croisière pour un cadavre" });
}

/** Les `SLOT_COUNT` emplacements, dans l'ordre, pour le sélecteur. */
export function summarizeSlots(slots: CroisiereSaveSlots): SlotSummary[] {
  return slots.summaries(describeSave, copy.saveSlot);
}

/** Écrit `data` dans l'emplacement `slot` (`now` : `Date.now()` pour l'hôte) ; `null` : le jeu ne permet pas de sauvegarder maintenant. */
export function writeSlot(slots: CroisiereSaveSlots, slot: number, data: SlotData | null, now: number): SaveResult {
  if (!data) return "refused";
  return slots.write(slot, data, now) ? "saved" : "failed";
}

/** Le message à montrer au joueur après `writeSlot`. */
export function saveMessage(result: SaveResult): string {
  if (result === "saved") return copy.saveDone;
  return result === "refused" ? copy.saveBusy : copy.saveFailed;
}
