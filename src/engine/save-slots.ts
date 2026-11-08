import type { HostStorage } from "./storage";

/**
 * Emplacements de sauvegarde d'un jeu dans un stockage clé / valeur (`storage.ts`) : une valeur illisible (JSON cassé, autre version,
 * champ manquant) vaut « emplacement vide », le moteur ne reçoit jamais une sauvegarde qu'il ne sait pas relire, et une écriture
 * refusée (stockage plein ou bloqué) est signalée, pas levée.
 *
 * C'est l'hôte qui préfixe les clés : on passe ici `prefixedStorage(store, prefix)`. Les emplacements sont numérotés de 1 à `count`,
 * la clé de chacun est `slot01`, `slot02`… et sa valeur est `{ savedAt, save }` en JSON. Le contenu `save` est propre au jeu : il
 * fournit `parse`, qui le valide (et le versionne) ; la description d'un emplacement plein et le moteur à reprendre restent aussi au jeu.
 *
 * Module pur : aucune dépendance au navigateur ni à un jeu.
 */

/** Ce qu'un emplacement contient : la date d'écriture (millisecondes depuis 1970) et la sauvegarde du jeu. */
export interface StoredSave<T> {
  savedAt: number;
  save: T;
}

/** Ce que le sélecteur affiche d'un emplacement. */
export interface SlotSummary {
  /** De 1 à `count`. */
  slot: number;
  empty: boolean;
  /** Le texte de `describe` (emplacement plein) ou de `emptyLabel` (vide). */
  description: string;
  /** `null` pour un emplacement vide. */
  savedAt: number | null;
}

export interface SaveSlotsOptions<T> {
  /** Nombre d'emplacements. */
  count: number;
  /** Valide la valeur lue sous `save` : la sauvegarde, ou `null` si elle est illisible ou d'une autre version. */
  parse(value: unknown): T | null;
  /** Nom du jeu, en tête des avertissements de la console. */
  name: string;
}

/** Clé d'un emplacement dans le stockage (sans le préfixe, que l'hôte ajoute). */
export function slotKey(slot: number): string {
  return `slot${String(slot).padStart(2, "0")}`;
}

export class SaveSlots<T> {
  /** Nombre d'emplacements. */
  readonly count: number;
  private readonly parse: (value: unknown) => T | null;
  private readonly name: string;

  constructor(
    private readonly store: HostStorage,
    { count, parse, name }: SaveSlotsOptions<T>,
  ) {
    this.count = count;
    this.parse = parse;
    this.name = name;
  }

  private isSlot(slot: number): boolean {
    return Number.isInteger(slot) && slot >= 1 && slot <= this.count;
  }

  /** Le contenu de l'emplacement `slot`, ou `null` s'il est vide, illisible ou d'une autre version (jamais d'exception). */
  read(slot: number): StoredSave<T> | null {
    if (!this.isSlot(slot)) return null;
    const text = this.store.get(slotKey(slot));
    if (text === null) return null;
    try {
      const value: unknown = JSON.parse(text);
      const save = value !== null && typeof value === "object" ? this.parse((value as { save?: unknown }).save) : null;
      const savedAt = (value as { savedAt?: unknown } | null)?.savedAt;
      if (save && typeof savedAt === "number" && Number.isFinite(savedAt)) return { savedAt, save };
    } catch {
      // JSON cassé : traité comme absent
    }
    console.warn(`${this.name} : la sauvegarde de l'emplacement ${slot} est illisible et ignorée.`);
    return null;
  }

  /** Écrit `save` dans l'emplacement `slot` ; faux si le numéro est hors des emplacements ou si le stockage refuse. */
  write(slot: number, save: T, savedAt: number): boolean {
    if (!this.isSlot(slot)) return false;
    const ok = this.store.set(slotKey(slot), JSON.stringify({ savedAt, save } satisfies StoredSave<T>));
    if (!ok) console.warn(`${this.name} : la sauvegarde de l'emplacement ${slot} n'a pas pu être écrite (stockage plein ou bloqué).`);
    return ok;
  }

  /** Vide l'emplacement. */
  clear(slot: number): void {
    if (this.isSlot(slot)) this.store.remove(slotKey(slot));
  }

  /** La sauvegarde la plus récente (`savedAt`) parmi les emplacements lisibles, ou `null` s'il n'y en a aucune. */
  latest(): StoredSave<T> | null {
    let latest: StoredSave<T> | null = null;
    for (let slot = 1; slot <= this.count; slot++) {
      const stored = this.read(slot);
      if (stored && (!latest || stored.savedAt > latest.savedAt)) latest = stored;
    }
    return latest;
  }

  /** Les `count` emplacements, dans l'ordre, pour le sélecteur : `describe` pour un emplacement plein, `emptyLabel` pour un vide. */
  summaries(describe: (stored: StoredSave<T>) => string, emptyLabel: (slot: number) => string): SlotSummary[] {
    return Array.from({ length: this.count }, (_, index) => {
      const slot = index + 1;
      const stored = this.read(slot);
      return stored ? { slot, empty: false, description: describe(stored), savedAt: stored.savedAt } : { slot, empty: true, description: emptyLabel(slot), savedAt: null };
    });
  }
}
