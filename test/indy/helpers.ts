import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDaw } from "../../src/games/indy/data/daw";
import type { GameData } from "../../src/games/indy/data/types";

const ORIGINAL = resolve(import.meta.dirname, "../../original");

/** Les tests qui dépendent des fichiers du jeu sont ignorés si ceux-ci sont absents. */
export const hasOriginalFiles = existsSync(resolve(ORIGINAL, "DESKTOP.DAW"));

let cached: GameData | null = null;

export function loadGameData(): GameData {
  cached ??= parseDaw(readFileSync(resolve(ORIGINAL, "DESKTOP.DAW")));
  return cached;
}

export function loadExe(): Uint8Array {
  return readFileSync(resolve(ORIGINAL, "DESKADV.EXE"));
}
