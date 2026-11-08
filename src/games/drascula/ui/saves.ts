import { SaveSlots, type SlotSummary, type StoredSave as StoredSlot } from "../../../engine/save-slots";
import type { HostStorage } from "../../../engine/storage";
import type { DrasculaEngine } from "../engine/loop";
import { type SaveData, parseSave } from "../engine/save";
import { copy } from "../copy";

/**
 * Emplacements de sauvegarde de *Drascula* dans un stockage clé / valeur (vague S) : la mécanique (clés, JSON, valeur illisible =
 * emplacement vide, écriture refusée signalée) est celle de `src/engine/save-slots.ts` ; ici le réglage du jeu (préfixe, nombre,
 * validation par `parseSave`), la description d'un emplacement plein et les passerelles vers le moteur.
 *
 * C'est l'hôte qui préfixe : `prefixedStorage(store, SAVE_PREFIX)` est ce qu'on passe à `createSaveSlots` (et ce que l'hôte du
 * navigateur expose en `host.storage`). Dix emplacements, numérotés de 1 à 10 comme `NUM_SAVES` de ScummVM ; chacun contient
 * `{ savedAt, save }` en JSON (`save` est l'état de `engine/save.ts`, qui porte la version du format).
 */

/** Préfixe des clés du jeu dans le stockage (`drascula:slot01`…). */
export const SAVE_PREFIX = "drascula:";
/** Nombre d'emplacements (`NUM_SAVES`, écran de sauvegarde d'origine). */
export const SLOT_COUNT = 10;

/** Ce qu'un emplacement contient : la date d'écriture (millisecondes depuis 1970) et l'état de la partie. */
export type StoredSave = StoredSlot<SaveData>;
/** Les emplacements de *Drascula*. */
export type DrasculaSaveSlots = SaveSlots<SaveData>;
export type { SlotSummary };

/** Résultat de `saveToSlot` : `busy` = pas maintenant (séquence en cours), `failed` = le stockage a refusé l'écriture. */
export type SaveResult = "saved" | "busy" | "failed";
/** Résultat de `loadFromSlot` : `empty` = rien (ou rien de lisible) dans l'emplacement, `failed` = la partie n'a pas pu être reprise. */
export type LoadResult = "loaded" | "empty" | "failed";

/** Date lisible, dans la langue du jeu. */
function formatDate(savedAt: number): string {
  return new Date(savedAt).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Nom lisible d'une pièce (`copy.roomNames`), « Pièce N » pour un numéro inconnu. */
export function roomName(room: number): string {
  return copy.roomNames[room] ?? copy.unknownPlace(room);
}

/** Texte d'un emplacement plein : le chapitre, le lieu et la date. */
export function describeSave(stored: StoredSave): string {
  return copy.saveDescription(stored.save.chapter, roomName(stored.save.room.number), formatDate(stored.savedAt));
}

/** Les emplacements de sauvegarde de *Drascula* sur `store` (déjà préfixé par `SAVE_PREFIX`). */
export function createSaveSlots(store: HostStorage): DrasculaSaveSlots {
  return new SaveSlots(store, { count: SLOT_COUNT, parse: parseSave, name: "Drascula" });
}

/** Les `SLOT_COUNT` emplacements, dans l'ordre, pour le sélecteur. */
export function summarizeSlots(slots: DrasculaSaveSlots): SlotSummary[] {
  return slots.summaries(describeSave, copy.saveSlot);
}

/**
 * Sauvegarde la partie dans l'emplacement `slot` (`now` : l'heure, en millisecondes depuis 1970, `Date.now()` pour l'hôte). Refusée
 * (`busy`) pendant une séquence : le moteur ne laisse pas sauvegarder (`canSave`, comme `_canSaveLoad` de ScummVM).
 */
export function saveToSlot(engine: DrasculaEngine, slots: DrasculaSaveSlots, slot: number, now: number): SaveResult {
  const save = engine.saveGame();
  if (!save) return "busy";
  return slots.write(slot, save, now) ? "saved" : "failed";
}

/** Charge l'emplacement `slot` dans le moteur (même chapitre ou non : le chapitre sauvegardé est rouvert). */
export function loadFromSlot(engine: DrasculaEngine, slots: DrasculaSaveSlots, slot: number): LoadResult {
  const stored = slots.read(slot);
  if (!stored) return "empty";
  return engine.loadGame(stored.save) ? "loaded" : "failed";
}

/** Le message à montrer au joueur après `saveToSlot` / `loadFromSlot`. */
export function resultMessage(result: SaveResult | LoadResult, kind: "save" | "load"): string {
  if (result === "busy") return copy.saveBusy;
  if (result === "empty") return copy.loadEmpty;
  if (result === "failed") return kind === "save" ? copy.saveFailed : copy.loadFailed;
  return kind === "save" ? copy.saveDone : copy.loadDone;
}
