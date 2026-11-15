/**
 * Comparaison de la partie complète au banc ScummVM (vague K) : empreintes communes au portage et au banc.
 *
 * - Trace : sha1 (12 chiffres) des lignes `TK` sans le champ `mus` (pilote CD, hors comparaison), du tick suivant le point de contrôle
 *   précédent jusqu'au point de contrôle, jointes par `\n`.
 * - Image : sha1 (12 chiffres) de la page de fin de tick (320 × 200 indices) suivie de la palette RVB 8 bits (16 × 3), comme les captures
 *   `tk-NNNN.idx` et `tk-NNNN.pal` du banc (`CINE_SHOT_TICKS`).
 *
 * `fixtures/scummvm-checkpoints.txt` : `tick trace image décor`, un point par fin d'étape de la solution (ticks distincts).
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export interface Checkpoint {
  tick: number;
  trace: string;
  image: string;
  bg: string;
}

/** Ligne `TK` sans le champ `mus`. */
export function tkWithoutMusic(line: string): string {
  return line.replace(/ mus=\S+/, "");
}

export function sha12(...parts: (string | Uint8Array)[]): string {
  const hash = createHash("sha1");
  for (const part of parts) hash.update(part);
  return hash.digest("hex").slice(0, 12);
}

/** Empreinte de la trace des ticks `from` à `to` compris (`lines[i]` = ligne `TK i + 1`). */
export function traceHash(lines: readonly string[], from: number, to: number): string {
  return sha12(lines.slice(from - 1, to).map(tkWithoutMusic).join("\n"));
}

export function parseCheckpoints(text: string): Checkpoint[] {
  return text
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => {
      const [tick, trace, image, bg] = line.trim().split(/\s+/);
      return { tick: Number(tick), trace: trace!, image: image!, bg: bg ?? "-" };
    });
}

export function formatCheckpoint(c: Checkpoint): string {
  return `${c.tick} ${c.trace} ${c.image} ${c.bg}`;
}

/** Fichier de `fixtures/` (à côté de ce module). */
export function readSolutionFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}
