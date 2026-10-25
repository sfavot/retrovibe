import { parseDaw } from "../../src/games/indy/data/daw";
import type { GameData } from "../../src/games/indy/data/types";
import { originalFiles } from "../support/original";

const original = originalFiles("indy", "DESKTOP.DAW");

/** Les tests qui dépendent des fichiers du jeu sont ignorés si ceux-ci sont absents. */
export const hasOriginalFiles = original.has;

let cached: GameData | null = null;

export function loadGameData(): GameData {
  cached ??= parseDaw(original.read("DESKTOP.DAW"));
  return cached;
}

export function loadExe(): Uint8Array {
  return original.read("DESKADV.EXE");
}
