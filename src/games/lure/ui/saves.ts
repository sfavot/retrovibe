import { SaveSlots, type SlotSummary, type StoredSave as StoredSlot } from "../../../engine/save-slots";
import type { HostStorage } from "../../../engine/storage";
import { copy } from "../copy";
import type { LureEngine } from "../engine/game";
import { type SaveData, captureSave, parseSave, restoreSave } from "../engine/save";

/**
 * Emplacements de sauvegarde de *Lure of the Temptress* dans un stockage clé / valeur (vague S, décision D5 : comme FOTAQ, pas de
 * dialogue de sauvegarde d'origine) : la mécanique (clés, JSON, valeur illisible ou d'une autre version = emplacement vide, écriture
 * refusée signalée) est celle de `src/engine/save-slots.ts` ; ici le réglage du jeu (préfixe, nombre, validation par `parseSave`), la
 * description d'un emplacement plein (nom de la pièce et date) et les passerelles vers le moteur.
 *
 * C'est l'hôte qui préfixe : `prefixedStorage(store, SAVE_PREFIX)` est ce qu'on passe à `createSaveSlots` (et ce que l'hôte du
 * navigateur expose en `host.storage`). Dix emplacements, numérotés de 1 à 10 ; chacun contient `{ savedAt, save }` en JSON.
 */

/** Préfixe des clés du jeu dans le stockage (`lure:slot01`…). */
export const SAVE_PREFIX = "lure:";
/** Nombre d'emplacements. */
export const SLOT_COUNT = 10;

/** Ce qu'un emplacement contient : la date d'écriture (millisecondes depuis 1970) et l'état de la partie. */
export type StoredSave = StoredSlot<SaveData>;
/** Les emplacements de *Lure of the Temptress*. */
export type LureSaveSlots = SaveSlots<SaveData>;
export type { SlotSummary };

/** Résultat de `saveToSlot` : `busy` = pas maintenant (menu d'origine indisponible), `failed` = le stockage a refusé l'écriture. */
export type SaveResult = "saved" | "busy" | "failed";
/** Résultat de `loadFromSlot` : `empty` = rien (ou rien de lisible) dans l'emplacement, `failed` = la partie n'a pas pu être reprise. */
export type LoadResult = "loaded" | "empty" | "failed";

/** Date lisible, dans la langue du jeu. */
function formatDate(savedAt: number): string {
  return new Date(savedAt).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Titre d'une description de pièce : la première phrase, quand elle est en capitales (`LA CELLULE. Une puanteur…`). */
const ROOM_TITLE = /^([A-ZÀ-Ý][A-ZÀ-Ý0-9'\- ]+)\.(?:\s|$)/;

/**
 * Lieu d'une sauvegarde : le titre de la pièce, tel que le jeu l'écrit (la plupart des descriptions commencent par lui, en
 * capitales) ; les pièces sans titre (ruelles, cavernes) ont un nom de `copy.roomNames`, à défaut « Pièce N ». `roomName`
 * porte toute la description de la pièce : elle ne tient pas dans une ligne de la liste.
 */
export function placeOf(save: Pick<SaveData, "room" | "roomName">): string {
  const title = ROOM_TITLE.exec(save.roomName)?.[1];
  return title ?? copy.roomNames[save.room] ?? copy.unknownPlace(save.room);
}

/** Texte d'un emplacement plein : le lieu (`placeOf`) et la date. */
export function describeSave(stored: StoredSave): string {
  return copy.saveDescription(placeOf(stored.save), formatDate(stored.savedAt));
}

/** Les emplacements de sauvegarde sur `store` (déjà préfixé par `SAVE_PREFIX`). */
export function createSaveSlots(store: HostStorage): LureSaveSlots {
  return new SaveSlots(store, { count: SLOT_COUNT, parse: parseSave, name: "Lure of the Temptress" });
}

/** Les `SLOT_COUNT` emplacements, dans l'ordre, pour le sélecteur. */
export function summarizeSlots(slots: LureSaveSlots): SlotSummary[] {
  return slots.summaries(describeSave, copy.saveSlot);
}

/**
 * Sauvegarde la partie dans l'emplacement `slot` (`now` : l'heure, en millisecondes depuis 1970, `Date.now()` pour l'hôte). Refusée
 * (`busy`) quand le menu d'origine n'est pas disponible (séquence, dialogue, vue à distance, combat : `canSave`).
 */
export function saveToSlot(engine: LureEngine, slots: LureSaveSlots, slot: number, now: number): SaveResult {
  const save = captureSave(engine);
  if (!save) return "busy";
  return slots.write(slot, save, now) ? "saved" : "failed";
}

/** Charge l'emplacement `slot` dans le moteur. À appeler entre deux ticks (la partie en cours est abandonnée). */
export function loadFromSlot(engine: LureEngine, slots: LureSaveSlots, slot: number): LoadResult {
  const stored = slots.read(slot);
  if (!stored) return "empty";
  return restoreSave(engine, stored.save) ? "loaded" : "failed";
}

/** Le message à montrer au joueur après `saveToSlot` / `loadFromSlot`. */
export function resultMessage(result: SaveResult | LoadResult, kind: "save" | "load"): string {
  if (result === "busy") return copy.saveBusy;
  if (result === "empty") return copy.loadEmpty;
  if (result === "failed") return kind === "save" ? copy.saveFailed : copy.loadFailed;
  return kind === "save" ? copy.saveDone : copy.loadDone;
}
