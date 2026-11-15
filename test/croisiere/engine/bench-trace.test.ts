/**
 * Comparaison tour par tour avec le banc ScummVM (`cruise-bench`, `cruise-replay.sh scenarios/first-room.in DIR 3500 2`) : graine 1,
 * temps virtuel, contournement de la protection, aucune entrée. Fixture : `fixtures/bench-first-room-l2.trace.gz` (lignes `SC`
 * retirées : le rendu n'est pas encore porté).
 */
import { describe, expect, it } from "vitest";
import { TestHost } from "../../../src/games/croisiere/engine/host";
import { CroisiereEngine } from "../../../src/games/croisiere/engine/main-loop";
import { SoundService } from "../../../src/games/croisiere/engine/sound-service";
import { TraceRecorder } from "../../../src/games/croisiere/engine/trace";
import { benchTrace, gameFiles, hasOriginalFiles } from "./support";

/** Dernier tour identique au banc : toute la fixture (3 500 tours, première pièce jouable au tour 3 484). */
const EXPECTED_MATCH = Number(process.env.CROISIERE_TRACE_FRAMES ?? 3500);

describe.skipIf(!hasOriginalFiles)("trace du banc (intro)", () => {
  it(`est identique au banc jusqu'au tour ${EXPECTED_MATCH}`, () => {
    const bench = benchTrace("bench-first-room-l2.trace.gz");
    const recorder = new TraceRecorder(2, true);
    const files = gameFiles();
    const sound = new SoundService({ write() {} }, (name) => (files.has(name) ? files.readFile(name) : undefined));
    const engine = new CroisiereEngine(new TestHost(), { files, seed: 1, trace: recorder, sound });
    let mismatch: { frame: number; expected: string[]; actual: string[] } | null = null;
    let error: unknown = null;
    for (let n = 1; n <= EXPECTED_MATCH; n++) {
      if (n === 1) engine.applyInputLevel(0, 0, 0);
      const start = recorder.lines.length;
      try {
        engine.runFrame();
      } catch (err) {
        error = err;
      }
      const actual = recorder.lines.slice(start);
      const expected = bench.get(n) ?? [];
      if (error || actual.join("\n") !== expected.join("\n")) {
        mismatch = { frame: n, expected, actual };
        break;
      }
    }
    if (mismatch) {
      const diff: string[] = [];
      for (let i = 0; i < Math.max(mismatch.expected.length, mismatch.actual.length); i++) {
        if (mismatch.expected[i] !== mismatch.actual[i]) diff.push(`- ${mismatch.expected[i] ?? ""}\n+ ${mismatch.actual[i] ?? ""}`);
      }
      throw new Error(`Tour ${mismatch.frame} différent${error ? ` (${String(error)})` : ""} :\n${diff.slice(0, 6).join("\n")}`);
    }
    expect(engine.frameNumber).toBe(EXPECTED_MATCH);
  });
});
