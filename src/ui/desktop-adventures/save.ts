import type { Assets } from "../../engine/desktop-adventures/assets";
import { type GameSnapshot, migrateSnapshot } from "../../engine/desktop-adventures/game";
import { parseSnapshot } from "../../engine/desktop-adventures/snapshot";
import { storage } from "./storage";

export type SaveSlot = ReturnType<typeof createSaveSlot>;

/** Sauvegarde locale d'un jeu (un seul emplacement, clé `key`). Le stockage peut être indisponible : on échoue sans bruit.
 * Une sauvegarde illisible, forgée ou incohérente avec les données du jeu (`assets`) est traitée comme absente. */
export function createSaveSlot(key: string, assets: Assets) {
  return {
    read(): GameSnapshot | null {
      const raw = storage.get(key);
      if (!raw) return null;
      try {
        return parseSnapshot(migrateSnapshot(JSON.parse(raw)), assets);
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
