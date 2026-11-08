import { SaveSlots, type SlotSummary, type StoredSave as StoredSlot } from "../../../engine/save-slots";
import type { HostStorage } from "../../../engine/storage";
import { copy } from "../copy";
import type { FotaqEngine } from "../engine/loop";
import { type SaveData, parseSave } from "../engine/save";
import { OWNERSHIP } from "../engine/specials/ownership";

/**
 * Emplacements de sauvegarde de *Flight of the Amazon Queen* dans un stockage clé / valeur (vague S, décision D7 : comme Drascula, pas
 * d'écran journal) : la mécanique (clés, JSON, valeur illisible = emplacement vide, écriture refusée signalée) est celle de
 * `src/engine/save-slots.ts` ; ici le réglage du jeu (préfixe, nombre, validation par `parseSave`), la description d'un emplacement
 * plein et les passerelles vers le moteur.
 *
 * C'est l'hôte qui préfixe : `prefixedStorage(store, SAVE_PREFIX)` est ce qu'on passe à `createSaveSlots` (et ce que l'hôte du
 * navigateur expose en `host.storage`). Dix emplacements, numérotés de 1 à 10 ; chacun contient `{ savedAt, save }` en JSON (`save`
 * est l'état de `engine/save.ts`, qui porte la version du format).
 */

/** Préfixe des clés du jeu dans le stockage (`fotaq:slot01`…). */
export const SAVE_PREFIX = "fotaq:";
/** Nombre d'emplacements. */
export const SLOT_COUNT = 10;

/** Ce qu'un emplacement contient : la date d'écriture (millisecondes depuis 1970) et l'état de la partie. */
export type StoredSave = StoredSlot<SaveData>;
/** Les emplacements de *Flight of the Amazon Queen*. */
export type FotaqSaveSlots = SaveSlots<SaveData>;
export type { SlotSummary };

/** Résultat de `saveToSlot` : `busy` = pas maintenant (séquence en cours), `failed` = le stockage a refusé l'écriture. */
export type SaveResult = "saved" | "busy" | "failed";
/** Résultat de `loadFromSlot` : `empty` = rien (ou rien de lisible) dans l'emplacement, `failed` = la partie n'a pas pu être reprise. */
export type LoadResult = "loaded" | "empty" | "failed";

/** Date lisible, dans la langue du jeu. */
function formatDate(savedAt: number): string {
  return new Date(savedAt).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Pièces du début de la partie : la chambre où Joe est libre après l'introduction, l'hôtel et la course de voiture (70 à 74), puis
 * l'avion d'Anderson (75) ; le joueur n'y revient jamais (`docs/fotaq/specials.md` § 7 : passage 4a, avant le crash). Elles sont aux
 * groupes 4 et 5 de `OWNERSHIP` (fichier de répartition du moteur) mais, dans la description d'une sauvegarde, elles font partie de
 * la zone 6 (« Le début de l'aventure »), comme l'introduction.
 */
const START_ROOMS: readonly number[] = [70, 71, 72, 73, 74, 75];
/** Zone des pièces du début de la partie (`copy.zoneNames`). */
const START_ZONE = 6;

/**
 * Lieu d'une pièce : la zone du jeu qui la contient (`copy.zoneNames`), sinon son nom propre (`copy.roomNames` : écrans d'objets et
 * de cinématiques, hors des zones), « Pièce N » pour un numéro inconnu.
 */
export function placeName(room: number): string {
  if (START_ROOMS.includes(room)) return copy.zoneNames[START_ZONE];
  const zone = Object.entries(OWNERSHIP).find(([, group]) => group.rooms.includes(room));
  return (zone && copy.zoneNames[Number(zone[0])]) ?? copy.roomNames[room] ?? copy.unknownPlace(room);
}

/** Texte d'un emplacement plein : le lieu et la date. */
export function describeSave(stored: StoredSave): string {
  return copy.saveDescription(placeName(stored.save.room), formatDate(stored.savedAt));
}

/** Les emplacements de sauvegarde sur `store` (déjà préfixé par `SAVE_PREFIX`). */
export function createSaveSlots(store: HostStorage): FotaqSaveSlots {
  return new SaveSlots(store, { count: SLOT_COUNT, parse: parseSave, name: "Flight of the Amazon Queen" });
}

/** Les `SLOT_COUNT` emplacements, dans l'ordre, pour le sélecteur. */
export function summarizeSlots(slots: FotaqSaveSlots): SlotSummary[] {
  return slots.summaries(describeSave, copy.saveSlot);
}

/**
 * Sauvegarde la partie dans l'emplacement `slot` (`now` : l'heure, en millisecondes depuis 1970, `Date.now()` pour l'hôte). Refusée
 * (`busy`) quand le moteur ne laisse pas sauvegarder (`canSave` : cinématique, dialogue, séquence).
 */
export function saveToSlot(engine: FotaqEngine, slots: FotaqSaveSlots, slot: number, now: number): SaveResult {
  const save = engine.saveGame();
  if (!save) return "busy";
  return slots.write(slot, save, now) ? "saved" : "failed";
}

/** Charge l'emplacement `slot` dans le moteur. À appeler entre deux ticks (`FotaqEngine.loadGame`). */
export function loadFromSlot(engine: FotaqEngine, slots: FotaqSaveSlots, slot: number): LoadResult {
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
