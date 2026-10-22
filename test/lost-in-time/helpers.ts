import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Archive } from "../../src/games/lost-in-time/data/archive";

const ORIGINAL = resolve(import.meta.dirname, "../../original/lost-in-time");

/** Les tests qui dépendent des fichiers du jeu sont ignorés si ceux-ci sont absents. */
export const hasOriginalFiles = existsSync(resolve(ORIGINAL, "INTRO.STK"));

export function readOriginal(name: string): Uint8Array {
  return readFileSync(resolve(ORIGINAL, name));
}

const archives = new Map<string, Archive>();

export function loadArchive(name: string): Archive {
  let archive = archives.get(name);
  if (!archive) {
    archive = new Archive(readOriginal(name));
    archives.set(name, archive);
  }
  return archive;
}

export const ITK_FILES = ["BATCOM.ITK", "COMMUN1.ITK", "PARTIE1.ITK", "PARTIE2.ITK", "PARTIE3.ITK", "PARTIE4.ITK"];
