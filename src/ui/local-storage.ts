import type { HostStorage } from "../engine/storage";

/** `localStorage`, qui peut être absent, plein ou bloqué (mode privé) : on échoue sans bruit. */
export function localStorageStore(): HostStorage {
  return {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignoré
      }
    },
  };
}
