/** Accès à localStorage : le stockage peut être indisponible ou plein, on échoue sans bruit. */
export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  /** Renvoie faux si l'écriture a échoué (stockage plein ou bloqué). */
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignoré
    }
  },
};
