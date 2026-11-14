/**
 * Outil (pas un test ordinaire) : joue la partie complète (`full-game.test.ts` (a), graine 1, sans voix) et écrit dans `BASS_BENCH_OUT` de
 * quoi la rejouer dans le banc ScummVM et comparer les deux parties tour par tour (`docs/bass/engine.md` § 20) :
 * - `inputs.txt` : entrées appliquées, une par ligne, `n m x y` (déplacement), `n c x y b` (clic, bouton 2 gauche, 1 droit), `n a action` ;
 *   `n` est le tour (`CY n`) au début duquel l'entrée est appliquée (variable `SKY_INPUT` du banc) ;
 * - `port.trace` : trace de niveau 1 du portage (`CY`, `MC`), au format du banc ;
 * - `steps.txt` : `rang phase étape tour` (dernier tour terminé à la fin de chaque étape) ;
 * - avec `BASS_BENCH_FRAMES=1`, `frames.txt` : `tour empreinte` de l'image à la fin de chaque étape (`frameHash` de `render/harness.ts`).
 *
 * Les points de contrôle de `fixtures/scummvm-checkpoints.txt` se refont avec `bench/sky-replay.sh` et `bench/sky-checkpoints.py` (banc).
 *
 * Lancer : `BASS_BENCH_OUT=/chemin/absolu npx vitest run test/bass/solution/bench-record.test.ts`. Mise au point : `BASS_BENCH_LEVEL=3`
 * (niveau de la trace), `BASS_BENCH_WINDOW=700-720` (tours écrits dans `port.trace`), `BASS_BENCH_VARHASH=1` (ligne `VH n h` après chaque `CY` :
 * empreinte FNV-1a des 838 variables, comme `SKY_VARHASH`), `BASS_BENCH_DUMP=a-b:id,id` (lignes `DV` et `DC` comme `SKY_DUMP`).
 */

import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { describe, it } from "vitest";
import { BassScreenRenderer } from "../../../src/games/bass/render/screen";
import { type EngineTrace, TraceRecorder } from "../../../src/games/bass/engine/trace";
import { hasOriginalFiles, makeEngine } from "../engine/helpers";
import { frameHash } from "../render/harness";
import { inputLine, varHash } from "./bench";
import { Driver } from "./driver";
import { PHASES } from "./walkthrough";

const out = process.env.BASS_BENCH_OUT;

/** Fichier écrit par blocs (des millions de lignes au niveau 3). */
class Out {
  private readonly fd: number;
  private buffer: string[] = [];
  private size = 0;

  constructor(path: string) {
    this.fd = openSync(path, "w");
  }

  line(text: string): void {
    this.buffer.push(text);
    this.size += text.length;
    if (this.size > 1 << 20) this.flush();
  }

  flush(): void {
    if (this.buffer.length) writeSync(this.fd, `${this.buffer.join("\n")}\n`);
    this.buffer = [];
    this.size = 0;
  }

  close(): void {
    this.flush();
    closeSync(this.fd);
  }
}

describe.skipIf(!hasOriginalFiles || !out)("enregistrement de la partie complète pour le banc ScummVM", () => {
  it("écrit inputs.txt, port.trace, steps.txt (et frames.txt)", () => {
    mkdirSync(out!, { recursive: true });
    const files = { inputs: new Out(`${out}/inputs.txt`), trace: new Out(`${out}/port.trace`), steps: new Out(`${out}/steps.txt`) };
    const [from, to] = (process.env.BASS_BENCH_WINDOW ?? "0-1e9").split("-").map(Number) as [number, number];
    const level = Number(process.env.BASS_BENCH_LEVEL ?? 1) as 1 | 2 | 3;
    const inWindow = (n: number): boolean => n >= from && n <= to;
    let current = 0;
    const recorder = new TraceRecorder(level, (line) => {
      if (inWindow(current)) files.trace.line(line);
    });
    const dump = /^(\d+)-(\d+)((?:[:,]\d+)*)$/.exec(process.env.BASS_BENCH_DUMP ?? "");
    const trace: EngineTrace = {
      cycle: (n, vars, compacts) => {
        current = n;
        recorder.cycle(n, vars, compacts);
        if (!inWindow(n)) return;
        if (process.env.BASS_BENCH_VARHASH) files.trace.line(`VH ${n} ${varHash(vars)}`);
        if (dump && n >= Number(dump[1]) && n <= Number(dump[2])) {
          files.trace.line(`DV ${n} ${Array.from(vars).join(" ")}`);
          for (const id of dump[3]!.split(/[:,]/).filter(Boolean).map(Number)) {
            files.trace.line(`DC ${n} ${id} ${Array.from(compacts.require(id).subarray(0, 64)).join(" ")}`);
          }
        }
      },
      logic: (id, logic) => recorder.logic(id, logic),
      opcode: (id, command, module, pos) => recorder.opcode(id, command, module, pos),
      mcode: (id, num, a, b, c) => recorder.mcode(id, num, a, b, c),
      input: (n, event) => files.inputs.line(inputLine(n, event)),
    };
    // `BASS_BENCH_FRAMES=1` : écran branché (`BassScreenRenderer`), empreinte de l'image à la fin de chaque étape (`frames.txt`).
    const renderer = process.env.BASS_BENCH_FRAMES ? new BassScreenRenderer() : null;
    const { engine, host } = makeEngine(renderer ? { trace, screen: (e) => renderer.attach(e) } : { trace });
    const frames = renderer ? new Out(`${out}/frames.txt`) : null;
    engine.startAfterIntro();
    const driver = new Driver(engine, host);
    driver.cycle(3);
    let rank = 0;
    for (const [p, phase] of PHASES.entries()) {
      for (const [index, step] of phase.steps.entries()) {
        driver.run(step);
        files.steps.line(`${rank++} ${p} ${index} ${engine.cycleCount}`);
        if (renderer) frames!.line(`${engine.completedCycles} ${frameHash(renderer.frame.pixels, renderer.frame.palette)}`);
      }
    }
    for (const file of [...Object.values(files), ...(frames ? [frames] : [])]) file.close();
  }, 600_000);
});
