import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CruiseVolumes } from "../../../src/games/croisiere/data/volumes";
import { originalFiles } from "../../support/original";

export const original = originalFiles("croisiere", "VOL.CNF");
const REQUIRED = ["VOL.CNF", "D1", "D2", "D3", "D4", "D5"];
export const hasOriginalFiles = original.has && REQUIRED.every((name) => original.list((n) => n === name).length === 1);

let cached: CruiseVolumes | undefined;
/** Volumes du jeu, ouverts une fois pour tous les tests. */
export function volumes(): CruiseVolumes {
  cached ??= CruiseVolumes.open((name) => original.read(name));
  return cached;
}

/** Fichiers des volumes au format `GameFiles`. */
export function gameFiles() {
  const v = volumes();
  return { has: (name: string) => v.has(name), readFile: (name: string) => v.readFile(name) };
}

/** Trace du banc ScummVM (fixture gzip), découpée par tour : `frames[n]` = lignes du tour n (`FR n` compris). */
export function benchTrace(file: string): Map<number, string[]> {
  const text = gunzipSync(readFileSync(resolve(import.meta.dirname, "fixtures", file))).toString("latin1");
  const frames = new Map<number, string[]>();
  let current: string[] | null = null;
  for (const line of text.split("\n")) {
    if (!line) continue;
    if (line.startsWith("FR ")) {
      current = [];
      frames.set(Number(line.split(" ")[1]), current);
    }
    current?.push(line);
  }
  return frames;
}

/** Fichiers libres lus hors des volumes par le moteur : police système et chaînes de langue. */
const LOOSE_FILES = ["SYSTEM.FNT", "DELPHINE.LNG"];

/** `gameFiles` plus `SYSTEM.FNT` et `DELPHINE.LNG` (les menus en dépendent : hauteur de ligne, textes). */
export function gameFilesWithLooseFiles() {
  const v = gameFiles();
  const loose = new Map(LOOSE_FILES.map((name) => [name, new Uint8Array(original.read(name))]));
  return { has: (name: string) => loose.has(name) || v.has(name), readFile: (name: string) => loose.get(name) ?? v.readFile(name) };
}

/** Lignes d'une trace du banc (fixture gzip), sans les lignes `SC` sauf si `screens`. */
export function benchLines(file: string, screens = false): string[] {
  return gunzipSync(readFileSync(resolve(import.meta.dirname, "fixtures", file)))
    .toString("latin1")
    .split("\n")
    .filter((l) => l && (screens || !l.startsWith("SC ")));
}

/** Entrées par tour du banc : `n x y b` (`CRUISE_INPUT`) ou `n TOUCHE` (`CRUISE_KEYS`), `#` = commentaire. */
export function benchInputs(file: string): string[][] {
  return readFileSync(resolve(import.meta.dirname, "fixtures", file), "latin1")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(/\s+/));
}
