import type { HostStorage } from "../../../engine/storage";
import type { DrasculaEngine } from "../engine/loop";
import { type SaveData, parseSave } from "../engine/save";
import { copy } from "../copy";

/**
 * Emplacements de sauvegarde de *Drascula* dans un stockage clé / valeur (vague S), sur le modèle d'Armaeth (`armaeth/ui/saves.ts`) :
 * une valeur illisible (JSON cassé, autre version, champ manquant) vaut « emplacement vide », le moteur ne reçoit jamais une
 * sauvegarde qu'il ne sait pas relire, et une écriture refusée (stockage plein ou bloqué) est signalée, pas levée.
 *
 * Comme pour Armaeth, c'est l'hôte qui préfixe : `prefixedStorage(store, SAVE_PREFIX)` est ce qu'on passe ici (et ce que l'hôte du
 * navigateur expose en `host.storage`). Dix emplacements, numérotés de 1 à 10 comme `NUM_SAVES` de ScummVM ; chacun contient
 * `{ savedAt, save }` en JSON (`save` est l'état de `engine/save.ts`, qui porte la version du format).
 */

/** Préfixe des clés du jeu dans le stockage (`drascula:slot01`…). */
export const SAVE_PREFIX = "drascula:";
/** Nombre d'emplacements (`NUM_SAVES`, écran de sauvegarde d'origine). */
export const SLOT_COUNT = 10;

/** Ce qu'un emplacement contient : la date d'écriture (millisecondes depuis 1970) et l'état de la partie. */
export interface StoredSave {
  savedAt: number;
  save: SaveData;
}

/** Ce que le sélecteur affiche d'un emplacement. */
export interface SlotSummary {
  /** De 1 à `SLOT_COUNT`. */
  slot: number;
  empty: boolean;
  /** « Emplacement 3 » (vide) ou « Chapitre 2 – L'auberge – 7 nov. 2026, 16:05 ». */
  description: string;
  /** `null` pour un emplacement vide. */
  savedAt: number | null;
}

/** Résultat de `saveToSlot` : `busy` = pas maintenant (séquence en cours), `failed` = le stockage a refusé l'écriture. */
export type SaveResult = "saved" | "busy" | "failed";
/** Résultat de `loadFromSlot` : `empty` = rien (ou rien de lisible) dans l'emplacement, `failed` = la partie n'a pas pu être reprise. */
export type LoadResult = "loaded" | "empty" | "failed";

const isSlot = (slot: number): boolean => Number.isInteger(slot) && slot >= 1 && slot <= SLOT_COUNT;

/** Clé d'un emplacement dans le stockage (sans le préfixe, que l'hôte ajoute). */
export function slotKey(slot: number): string {
  return `slot${String(slot).padStart(2, "0")}`;
}

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

export class SaveSlots {
  constructor(private readonly store: HostStorage) {}

  /** Le contenu de l'emplacement `slot`, ou `null` s'il est vide, illisible ou d'une autre version (jamais d'exception). */
  read(slot: number): StoredSave | null {
    if (!isSlot(slot)) return null;
    const text = this.store.get(slotKey(slot));
    if (text === null) return null;
    try {
      const value: unknown = JSON.parse(text);
      const save = value !== null && typeof value === "object" ? parseSave((value as { save?: unknown }).save) : null;
      const savedAt = (value as { savedAt?: unknown } | null)?.savedAt;
      if (save && typeof savedAt === "number" && Number.isFinite(savedAt)) return { savedAt, save };
    } catch {
      // JSON cassé : traité comme absent
    }
    console.warn(`Drascula : la sauvegarde de l'emplacement ${slot} est illisible et ignorée.`);
    return null;
  }

  /** Écrit `save` dans l'emplacement `slot` ; faux si le numéro est hors des emplacements ou si le stockage refuse. */
  write(slot: number, save: SaveData, savedAt: number): boolean {
    if (!isSlot(slot)) return false;
    const ok = this.store.set(slotKey(slot), JSON.stringify({ savedAt, save } satisfies StoredSave));
    if (!ok) console.warn(`Drascula : la sauvegarde de l'emplacement ${slot} n'a pas pu être écrite (stockage plein ou bloqué).`);
    return ok;
  }

  /** Vide l'emplacement. */
  clear(slot: number): void {
    if (isSlot(slot)) this.store.remove(slotKey(slot));
  }

  /** Les `SLOT_COUNT` emplacements, dans l'ordre, pour le sélecteur. */
  summaries(): SlotSummary[] {
    return Array.from({ length: SLOT_COUNT }, (_, index) => {
      const slot = index + 1;
      const stored = this.read(slot);
      return stored
        ? { slot, empty: false, description: describeSave(stored), savedAt: stored.savedAt }
        : { slot, empty: true, description: copy.saveSlot(slot), savedAt: null };
    });
  }
}

/**
 * Sauvegarde la partie dans l'emplacement `slot` (`now` : l'heure, en millisecondes depuis 1970, `Date.now()` pour l'hôte). Refusée
 * (`busy`) pendant une séquence : le moteur ne laisse pas sauvegarder (`canSave`, comme `_canSaveLoad` de ScummVM).
 */
export function saveToSlot(engine: DrasculaEngine, slots: SaveSlots, slot: number, now: number): SaveResult {
  const save = engine.saveGame();
  if (!save) return "busy";
  return slots.write(slot, save, now) ? "saved" : "failed";
}

/** Charge l'emplacement `slot` dans le moteur (même chapitre ou non : le chapitre sauvegardé est rouvert). */
export function loadFromSlot(engine: DrasculaEngine, slots: SaveSlots, slot: number): LoadResult {
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
