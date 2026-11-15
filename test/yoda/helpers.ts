import { parseDaw } from "../../src/engine/desktop-adventures/data/daw";
import type { GameData } from "../../src/engine/desktop-adventures/data/types";
import { originalFiles } from "../support/original";

const original = originalFiles("yoda", "YODESK.DTA");

/** Les tests qui dépendent des fichiers du jeu sont ignorés si ceux-ci sont absents. */
export const hasOriginalFiles = original.has;

let cached: GameData | null = null;

export function loadGameData(): GameData {
  cached ??= parseDaw(original.read("YODESK.DTA"), "yoda");
  return cached;
}

export function loadExe(): Uint8Array {
  return original.read("YODESK.EXE");
}
