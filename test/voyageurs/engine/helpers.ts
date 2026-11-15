import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { VoyageursEngine, type VoyageursEngineOptions } from "../../../src/games/voyageurs/engine/game";
import { TestHost, type MouseButton, type VoyageursAction, type VoyageursInput } from "../../../src/games/voyageurs/engine/host";
import type { VoyageursFiles } from "../../../src/games/voyageurs/engine/part";
import { hasOriginalFiles, readOriginal } from "../data/helpers";

export { hasOriginalFiles };

/** Fichiers d'origine (`original/voyageurs/`), lus à la demande. */
export const originalGameFiles: VoyageursFiles = {
  read(name) {
    try {
      return readOriginal(name);
    } catch {
      return null;
    }
  },
};

/** Moteur sur les vrais fichiers. */
export function makeEngine(options: Partial<VoyageursEngineOptions> = {}): { engine: VoyageursEngine; host: TestHost } {
  const host = (options.host as TestHost | undefined) ?? new TestHost(originalGameFiles);
  const engine = new VoyageursEngine({ ...options, host });
  return { engine, host };
}

/** Entrée du banc (`CINE_INPUT`) : appliquée au début du tick `tick`. */
export interface BenchInput {
  tick: number;
  op: "m" | "c" | "d" | "u" | "k";
  inputs: VoyageursInput[];
}

const BUTTONS: Record<string, MouseButton> = { "1": "left", "2": "right", "3": "both" };
const KEYS: Record<string, VoyageursAction> = {
  examine: "examine", take: "take", inventory: "inventory", use: "use", activate: "activate", speak: "speak",
  actionmenu: "actionMenu", systemmenu: "systemMenu", optionup: "menuUp", optiondown: "menuDown",
};

/** Lit un fichier d'entrées du banc (`n m x y`, `n c x y b`, `n d x y b`, `n u x y b`, `n k TOUCHE`). */
export function parseBenchInputs(text: string): BenchInput[] {
  const out: BenchInput[] = [];
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2 || line.startsWith("#")) continue;
    const tick = Number(parts[0]);
    const op = parts[1] as BenchInput["op"];
    if (op === "k") {
      const action = KEYS[parts[2]!.toLowerCase()];
      if (action) out.push({ tick, op, inputs: [{ type: "action", action }] });
      continue;
    }
    const x = Number(parts[2]);
    const y = Number(parts[3]);
    const button = BUTTONS[parts[4] ?? "1"] ?? "left";
    const move: VoyageursInput = { type: "move", x, y };
    if (op === "m") out.push({ tick, op, inputs: [move] });
    else if (op === "c") out.push({ tick, op, inputs: [move, { type: "down", button, x, y }, { type: "up", button, x, y }] });
    else if (op === "d") out.push({ tick, op, inputs: [move, { type: "down", button, x, y }] });
    else if (op === "u") out.push({ tick, op, inputs: [move, { type: "up", button, x, y }] });
  }
  return out.sort((a, b) => a.tick - b.tick);
}

/**
 * Rejoue des entrées comme le banc (`Trace::beginTick`, `Trace::modalPoll`) jusqu'au tick `stopTick` ; rend les lignes de trace.
 * Au début du tick n : toutes les entrées de tick ≤ n ; dans une attente modale du tick n : celles de tick ≤ n + 1, une par tour,
 * jusqu'à la première décisive (clic, bouton, touche) incluse.
 */
export function replay(inputs: readonly BenchInput[], stopTick: number, options: Partial<VoyageursEngineOptions> = {}): { engine: VoyageursEngine; host: TestHost; lines: string[] } {
  const queue = [...inputs];
  const lines: string[] = [];
  let engine: VoyageursEngine | null = null;
  const onModalPoll = () => {
    while (engine && queue.length && queue[0]!.tick <= engine.ticks + 1) {
      const next = queue.shift()!;
      engine.input(...next.inputs);
      if (next.op !== "m") break;
    }
  };
  const made = makeEngine({ ...options, trace: (line) => lines.push(line), onModalPoll });
  engine = made.engine;
  let guard = 0;
  try {
    while (engine.ticks < stopTick && !engine.quitRequested) {
      if (engine.betweenTicks) while (queue.length && queue[0]!.tick <= engine.ticks + 1) engine.input(...queue.shift()!.inputs);
      engine.step();
      if (++guard > stopTick * 400) throw new Error(`rejeu bloqué au tick ${engine.ticks}`);
    }
  } catch (error) {
    // Lignes déjà produites : utiles pour situer l'écart.
    if (error instanceof Error) Object.assign(error, { lines });
    throw error;
  }
  return { engine, host: made.host, lines };
}

/** Lignes d'une trace de référence de `fixtures/` (commentaires `#` retirés). */
export function readFixture(name: string): string[] {
  const path = fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"));
}

/** Ligne `TK` sans le champ `mus` (pilote CD de la vague A). */
export function withoutMusic(line: string): string {
  return line.replace(/ mus=\S+/, "");
}
