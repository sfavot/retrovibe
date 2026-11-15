import { type GameSnapshot, migrateSnapshot } from "../../engine/desktop-adventures/game";
import { storage } from "./storage";

export type SaveSlot = ReturnType<typeof createSaveSlot>;

/** Sauvegarde locale d'un jeu (un seul emplacement, clé `key`). Le stockage peut être indisponible : on échoue sans bruit. */
export function createSaveSlot(key: string) {
  return {
    read(): GameSnapshot | null {
      const raw = storage.get(key);
      if (!raw) return null;
      try {
        return migrateSnapshot(JSON.parse(raw));
      } catch {
        return null;
      }
    },
    write(snapshot: GameSnapshot): void {
      // stockage plein ou bloqué : la partie continue sans sauvegarde
      storage.set(key, JSON.stringify(snapshot));
    },
    clear(): void {
      storage.remove(key);
    },
  };
}
