import { type GameSnapshot, SAVE_VERSION } from "../engine/game";

const KEY = "indy-desktop-save";

/** Sauvegarde locale (un seul emplacement). Le stockage peut être indisponible : on échoue sans bruit. */
export const saveSlot = {
  read(): GameSnapshot | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const snapshot = JSON.parse(raw) as GameSnapshot;
      return snapshot.version === SAVE_VERSION ? snapshot : null;
    } catch {
      return null;
    }
  },
  write(snapshot: GameSnapshot): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(snapshot));
    } catch {
      // stockage plein ou bloqué : la partie continue sans sauvegarde
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // ignoré
    }
  },
};
