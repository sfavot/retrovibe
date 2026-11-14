import { SaveSlots, type SlotSummary, type StoredSave as StoredSlot } from "../../../engine/save-slots";
import type { HostStorage } from "../../../engine/storage";
import { copy } from "../copy";
import type { GameControl } from "../engine/control/control";
import { type SaveData, type SaveRefusal, parseSave } from "../engine/save";

/**
 * Emplacements de sauvegarde de *Beneath a Steel Sky* dans un stockage clé / valeur (vague S, D6) : comme Lure, la mécanique (clés, JSON,
 * valeur illisible ou d'une autre version = emplacement vide, écriture refusée signalée) est celle de `src/engine/save-slots.ts` ; ici le
 * réglage du jeu (préfixe, nombre, validation par `parseSave`), la description d'un emplacement plein (section et date) et les passerelles vers
 * `GameControl` (`capture`, `load`, `finishDialog`).
 *
 * C'est l'hôte qui préfixe : `prefixedStorage(store, SAVE_PREFIX)` est ce qu'on passe à `createSaveSlots`. Dix emplacements, de 1 à 10 ;
 * chacun contient `{ savedAt, save }` en JSON (`engine/save.ts`).
 *
 * Utilisation par l'hôte : `requestSave` / `requestRestore` ouvrent `renderSlotDialog` avec `summarizeSlots`, `saveToSlot` / `loadFromSlot`
 * comme `choose` (leur résultat passe par `resultMessage`) et `control.finishDialog()` comme fermeture.
 */

/** Préfixe des clés du jeu dans le stockage (`bass:slot01`…). */
export const SAVE_PREFIX = "bass:";
/** Nombre d'emplacements. */
export const SLOT_COUNT = 10;

export type StoredSave = StoredSlot<SaveData>;
export type BassSaveSlots = SaveSlots<SaveData>;
export type { SlotSummary };

/** Résultat de `saveToSlot` : `saved`, `failed` (le stockage a refusé l'écriture) ou la cause du refus (`saveRefusal`). */
export type SaveResult = "saved" | "failed" | SaveRefusal;
/** Résultat de `loadFromSlot` : `empty` = rien (ou rien de lisible) dans l'emplacement, `failed` = la partie n'a pas pu être reprise. */
export type LoadResult = "loaded" | "empty" | "failed";

/** Date lisible, dans la langue du site. */
function formatDate(savedAt: number): string {
  return new Date(savedAt).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Texte d'un emplacement plein : la section et la date. */
export function describeSave(stored: StoredSave): string {
  return copy.saveDescription(copy.sectionName(stored.save.section), formatDate(stored.savedAt));
}

/** Les emplacements de sauvegarde sur `store` (déjà préfixé par `SAVE_PREFIX`). */
export function createSaveSlots(store: HostStorage): BassSaveSlots {
  return new SaveSlots(store, { count: SLOT_COUNT, parse: parseSave, name: "Beneath a Steel Sky" });
}

/** Les `SLOT_COUNT` emplacements, dans l'ordre, pour le sélecteur. */
export function summarizeSlots(slots: BassSaveSlots): SlotSummary[] {
  return slots.summaries(describeSave, copy.saveSlot);
}

/** Sauvegarde la partie dans l'emplacement `slot` (`now` : `Date.now()` pour l'hôte). Refusée pendant un choix, dans LINC, etc. (`GameControl.capture`). */
export function saveToSlot(control: Pick<GameControl, "capture">, slots: BassSaveSlots, slot: number, now: number): SaveResult {
  const save = control.capture();
  if (typeof save === "string") return save;
  return slots.write(slot, save, now) ? "saved" : "failed";
}

/** Charge l'emplacement `slot` dans le moteur (la reprise attend la fin d'un effet bloquant en cours). */
export function loadFromSlot(control: Pick<GameControl, "load">, slots: BassSaveSlots, slot: number): LoadResult {
  const stored = slots.read(slot);
  if (!stored) return "empty";
  return control.load(stored.save) ? "loaded" : "failed";
}

/** Le message à montrer au joueur après `saveToSlot` / `loadFromSlot`. */
export function resultMessage(result: SaveResult | LoadResult, kind: "save" | "load"): string {
  if (result === "saved") return copy.saveDone;
  if (result === "loaded") return copy.loadDone;
  if (result === "empty") return copy.loadEmpty;
  if (result === "failed") return kind === "save" ? copy.saveFailed : copy.loadFailed;
  return copy.saveRefused[result];
}
