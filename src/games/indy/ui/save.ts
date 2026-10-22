import { type GameSnapshot, migrateSnapshot } from "../engine/game";
import { storage } from "./storage";

const KEY = "indy-desktop-save";

/** Sauvegarde locale (un seul emplacement). Le stockage peut être indisponible : on échoue sans bruit. */
export const saveSlot = {
  read(): GameSnapshot | null {
    const raw = storage.get(KEY);
    if (!raw) return null;
    try {
      return migrateSnapshot(JSON.parse(raw));
    } catch {
      return null;
    }
  },
  write(snapshot: GameSnapshot): void {
    // stockage plein ou bloqué : la partie continue sans sauvegarde
    storage.set(KEY, JSON.stringify(snapshot));
  },
  clear(): void {
    storage.remove(KEY);
  },
};
