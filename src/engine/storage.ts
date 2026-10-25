/**
 * Stockage clé / valeur persistant des jeux. Module pur : l'implémentation navigateur est `src/ui/local-storage.ts`,
 * celle des tests `MemoryStorage`. Les erreurs (quota, mode privé) sont avalées par l'implémentation.
 */
export interface HostStorage {
  get(key: string): string | null;
  /** Renvoie faux si l'écriture a échoué (stockage plein ou bloqué). */
  set(key: string, value: string): boolean;
  /** Efface la clé. */
  remove(key: string): void;
}

/** Stockage en mémoire (tests, repli sans `localStorage`). */
export class MemoryStorage implements HostStorage {
  readonly data = new Map<string, string>();

  get(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  set(key: string, value: string): boolean {
    this.data.set(key, value);
    return true;
  }

  remove(key: string): void {
    this.data.delete(key);
  }
}

/** Vue d'un stockage dont toutes les clés sont préfixées (`prefix + key`). */
export function prefixedStorage(storage: HostStorage, prefix: string): HostStorage {
  return {
    get: (key) => storage.get(prefix + key),
    set: (key, value) => storage.set(prefix + key, value),
    remove: (key) => storage.remove(prefix + key),
  };
}
