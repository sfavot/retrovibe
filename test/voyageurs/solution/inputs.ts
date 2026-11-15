/**
 * Entrées enregistrées d'une partie, au format `CINE_INPUT` du banc ScummVM (`bench/README-fw.md`), avec l'adressage des attentes
 * modales ajouté en vague K :
 * - `n op …` : livrée au début du tick `n` (avant `executePlayerInput`) ;
 * - `n@k op …` : livrée au premier tour de la `k`-ième attente modale du tick `n` (ligne `MW n …` du banc : clic sur un message, choix
 *   dans un menu, inventaire). Un fichier qui en contient n'a plus la livraison implicite « une entrée du tick n+1 par tour d'attente ».
 *
 * `op` : `m x y` (déplacement), `c x y b` (clic complet), `d x y b` (appui), `u x y b` (relâchement), `k action` (touche du moteur :
 * `examine`, `take`, `inventory`, `use`, `activate`, `speak`, `actionmenu`, `systemmenu`, `optionup`, `optiondown`).
 *
 * Le numéro de tick d'une attente est celui du banc (`VoyageursEngine.benchTick`) : une attente de menu pendant les entrées du tick n et
 * l'attente d'un clic après la ligne `TK n` portent toutes deux le numéro n.
 */

import { VoyageursEngine, type VoyageursEngineOptions } from "../../../src/games/voyageurs/engine/game";
import { type MouseButton, TestHost, type VoyageursAction, type VoyageursInput } from "../../../src/games/voyageurs/engine/host";
import { originalGameFiles } from "../engine/helpers";

const BUTTONS: Record<string, MouseButton> = { "1": "left", "2": "right", "3": "both" };
const KEYS: Record<string, VoyageursAction> = {
  examine: "examine", take: "take", inventory: "inventory", use: "use", activate: "activate", speak: "speak",
  actionmenu: "actionMenu", systemmenu: "systemMenu", optionup: "menuUp", optiondown: "menuDown",
};

/** Entrées du moteur d'une opération (`c 120 140 1`, `k use`…). */
export function parseOp(op: string): VoyageursInput[] {
  const parts = op.trim().split(/\s+/);
  const kind = parts[0];
  if (kind === "k") {
    const action = KEYS[(parts[1] ?? "").toLowerCase()];
    if (!action) throw new Error(`touche inconnue : ${op}`);
    return [{ type: "action", action }];
  }
  const x = Number(parts[1]);
  const y = Number(parts[2]);
  const button = BUTTONS[parts[3] ?? "1"] ?? "left";
  const move: VoyageursInput = { type: "move", x, y };
  switch (kind) {
    case "m":
      return [move];
    case "c":
      return [move, { type: "down", button, x, y }, { type: "up", button, x, y }];
    case "d":
      return [move, { type: "down", button, x, y }];
    case "u":
      return [move, { type: "up", button, x, y }];
    default:
      throw new Error(`opération inconnue : ${op}`);
  }
}

export interface RecordedInput {
  tick: number;
  /** 0 : début du tick ; k ≥ 1 : k-ième attente modale du tick. */
  wait: number;
  op: string;
}

export function formatInput(input: RecordedInput): string {
  return `${input.tick}${input.wait ? `@${input.wait}` : ""} ${input.op}`;
}

export function parseInputs(text: string): RecordedInput[] {
  const out: RecordedInput[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(\d+)(?:@(\d+))?\s+(.*)$/.exec(line);
    if (!match) throw new Error(`ligne d'entrée illisible : ${line}`);
    out.push({ tick: Number(match[1]), wait: match[2] ? Number(match[2]) : 0, op: match[3]! });
  }
  return out;
}

/**
 * Suit les attentes modales d'un moteur par ses lignes `MW` : numéro de l'attente dans le tick (`k`), source et condition de fin, et
 * premier tour (`fresh`).
 */
export class ModalTracker {
  tick = 0;
  index = 0;
  source = 0;
  target = 0;
  fresh = false;

  /** À appeler sur chaque ligne de trace. */
  line(line: string): void {
    if (!line.startsWith("MW ")) return;
    const [, n, src, tgt] = /^MW (\d+) src=(\d+) tgt=(\d+)/.exec(line) ?? [];
    const tick = Number(n);
    this.index = tick === this.tick ? this.index + 1 : 1;
    this.tick = tick;
    this.source = Number(src);
    this.target = Number(tgt);
    this.fresh = true;
  }

  /** Premier tour de l'attente en cours (vrai une seule fois par attente). */
  takeFresh(): boolean {
    const fresh = this.fresh;
    this.fresh = false;
    return fresh;
  }
}

/** Moteur de test sur les vrais fichiers, avec trace. */
export function makeTracedEngine(trace: (line: string) => void, onModalPoll: (source: number) => void, options: Partial<VoyageursEngineOptions> = {}): { engine: VoyageursEngine; host: TestHost } {
  const host = new TestHost(originalGameFiles);
  const engine = new VoyageursEngine({ seed: 1, ...options, host, trace, onModalPoll });
  return { engine, host };
}

/**
 * Rejoue des entrées enregistrées comme le banc (`Trace::beginTick`, `Trace::modalPoll` en mode adressé) jusqu'à la fin du tick `stop`.
 * `onTick` reçoit chaque ligne `TK`.
 */
export function replayRecorded(
  inputs: readonly RecordedInput[],
  stop: number,
  onTick?: (line: string, engine: VoyageursEngine) => void,
  options: Partial<VoyageursEngineOptions> = {},
): VoyageursEngine {
  const atTick = inputs.filter((i) => i.wait === 0);
  const modal = inputs.filter((i) => i.wait > 0);
  let tickPos = 0;
  let modalPos = 0;
  const tracker = new ModalTracker();
  let engine: VoyageursEngine | null = null;
  const made = makeTracedEngine(
    (line) => {
      tracker.line(line);
      if (line.startsWith("TK ") && engine) onTick?.(line, engine);
    },
    () => {
      if (!engine || !tracker.takeFresh()) return;
      while (modalPos < modal.length) {
        const next = modal[modalPos]!;
        if (next.tick < tracker.tick || (next.tick === tracker.tick && next.wait < tracker.index)) throw new Error(`entrée modale manquée : ${formatInput(next)} (attente ${tracker.tick}@${tracker.index})`);
        if (next.tick !== tracker.tick || next.wait !== tracker.index) break;
        engine.input(...parseOp(next.op));
        modalPos++;
      }
    },
    options,
  );
  engine = made.engine;
  let guard = 0;
  while (engine.ticks < stop && !engine.quitRequested) {
    if (engine.betweenTicks) {
      while (tickPos < atTick.length && atTick[tickPos]!.tick <= engine.ticks + 1) engine.input(...parseOp(atTick[tickPos++]!.op));
    }
    engine.step();
    if (++guard > (stop + 100) * 2000) throw new Error(`rejeu bloqué au tick ${engine.ticks}`);
  }
  return engine;
}
