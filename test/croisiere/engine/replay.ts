/**
 * Rejeu d'un scénario du banc ScummVM (`cruise-replay.sh INPUTS DIR STOP 2` avec `KEYS=` facultatif) et comparaison ligne à ligne avec
 * sa trace : entrées appliquées au début de chaque tour, modal ou non, comme `Bench::applyInputs`. Avec `screensFrom`, les lignes `SC`
 * (CRC32 de l'image présentée et de la palette, en fin de tour) sont comparées aussi à partir de ce tour.
 */
import { crc32 } from "node:zlib";
import { TestHost } from "../../../src/games/croisiere/engine/host";
import { CroisiereEngine } from "../../../src/games/croisiere/engine/main-loop";
import { SoundService } from "../../../src/games/croisiere/engine/sound-service";
import type { EngineState } from "../../../src/games/croisiere/engine/state";
import { TraceRecorder } from "../../../src/games/croisiere/engine/trace";
import { benchInputs, benchLines, gameFilesWithLooseFiles } from "./support";

const hex = (value: number) => (value >>> 0).toString(16).padStart(8, "0");

/** Trace du banc avec, après `VH`, la ligne `SC n crc pal` (`CRUISE_VARHASH`) à partir du tour `from`. */
class ScreenTraceRecorder extends TraceRecorder {
  constructor(private readonly from: number) {
    super(2, true);
  }

  override frameEnd(n: number, e: EngineState): void {
    super.frameEnd(n, e);
    if (n >= this.from) this.lines.push(`SC ${n} ${hex(crc32(e.display.globalScreen))} ${hex(crc32(e.display.hardwarePalette))}`);
  }
}

export interface ReplayResult {
  engine: CroisiereEngine;
  /** Premier écart (contexte compris), `null` si la trace est identique. */
  mismatch: string | null;
  /** Nombre de lignes comparées. */
  compared: number;
}

/**
 * Remplacement du moteur en cours de rejeu (sauvegarde puis reprise dans un moteur neuf) : à la fin du tour `frame`, `swap` reçoit le
 * moteur et ce qu'il faut pour en construire un autre (fichiers, son neuf, trace en cours), et rend celui qui continue le rejeu.
 */
export interface EngineSwap {
  frame: number;
  swap(engine: CroisiereEngine, make: () => CroisiereEngine): CroisiereEngine;
}

/** Rejoue jusqu'au tour `last` et compare à `trace` (fixtures mises bout à bout) ; `inputs` / `keys` : fichiers de `fixtures/`. */
export function replayBench(trace: string | string[], inputs: string | null, keys: string | null, last: number, screensFrom = 0, swap: EngineSwap | null = null): ReplayResult {
  const expected = (Array.isArray(trace) ? trace : [trace]).flatMap((f) => benchLines(f, screensFrom > 0));
  const levels = inputs ? benchInputs(inputs).map(([n, x, y, b]) => ({ n: Number(n), x: Number(x), y: Number(y), b: Number(b) })) : [];
  const keyRows = keys ? benchInputs(keys).map(([n, k]) => ({ n: Number(n), k: k! })) : [];
  const recorder = screensFrom > 0 ? new ScreenTraceRecorder(screensFrom) : new TraceRecorder(2, true);
  const files = gameFilesWithLooseFiles();
  const make = () => {
    const sound = new SoundService({ write() {} }, (name) => (files.has(name) ? files.readFile(name) : undefined));
    const made = new CroisiereEngine(new TestHost(), { files, seed: 1, trace: recorder, sound });
    return made;
  };
  let engine = make();
  let li = 0;
  let ki = 0;
  const onTickStart = (tick: number) => {
    let level: (typeof levels)[number] | null = null;
    while (li < levels.length && levels[li]!.n <= tick) level = levels[li++]!;
    if (level) engine.applyInputLevel(level.x, level.y, level.b);
    engine.releaseBenchEscape();
    while (ki < keyRows.length && keyRows[ki]!.n <= tick) engine.applyKey(keyRows[ki++]!.k);
  };
  engine.onTickStart = onTickStart;
  let checked = 0;
  while (engine.frameNumber < last && !engine.stopped) {
    let error: unknown = null;
    try {
      engine.runFrame();
    } catch (err) {
      error = err;
    }
    const lines = recorder.lines;
    for (; checked < lines.length; checked++) {
      if (lines[checked] !== expected[checked]) break;
    }
    if (error || checked < lines.length) {
      const from = Math.max(0, checked - 3);
      const ctx = expected.slice(from, checked).map((l) => `  ${l.slice(0, 200)}`);
      const why = error ? ` (${String(error)})` : "";
      return {
        engine,
        compared: checked,
        mismatch: `Tour ${engine.frameNumber}, ligne ${checked}${why} :\n${ctx.join("\n")}\n- ${(expected[checked] ?? "<fin>").slice(0, 400)}\n+ ${(lines[checked] ?? "<fin>").slice(0, 400)}`,
      };
    }
    if (swap && engine.frameNumber === swap.frame) {
      engine = swap.swap(engine, make);
      engine.onTickStart = onTickStart;
      swap = null;
    }
  }
  return { engine, compared: checked, mismatch: null };
}
