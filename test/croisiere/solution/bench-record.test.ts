/**
 * Outil (pas un test ordinaire) : joue la partie complète (`full-game.test.ts` (a), graine 1) et écrit dans `CROISIERE_BENCH_OUT` de quoi
 * la rejouer dans le banc ScummVM et comparer les deux parties tour par tour :
 * - `inputs.txt` : niveaux de souris par tour, `n x y b` (variable `CRUISE_INPUT` du banc, `bench/cruise-replay.sh`) ;
 * - `port.trace` : trace du portage au format du banc, lignes `FR` (niveau 1), `VH` (empreinte des 2 000 `globalVars`) et `SC` (CRC32 de
 *   l'image et de la palette) à chaque tour, comme `CRUISE_TRACE=1 CRUISE_VARHASH=1` ;
 * - `steps.txt` : `rang phase étape tour` (dernier tour terminé à la fin de chaque étape).
 *
 * Les points de contrôle de `fixtures/scummvm-checkpoints.txt` se refont avec `bench/cruise-replay.sh inputs.txt DOSSIER STOP 1` et
 * `scripts/checkpoints.py` (voir `scummvm-replay.test.ts`).
 *
 * Lancer : `CROISIERE_BENCH_OUT=/chemin/absolu npx vitest run test/croisiere/solution/bench-record.test.ts`. `CROISIERE_BENCH_LEVEL=2`
 * (trace de niveau 2 : scripts, fonctions natives, listes) et `CROISIERE_BENCH_WINDOW=a-b` (tours écrits dans `port.trace`) servent à
 * localiser un écart.
 */

import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { crc32 } from "node:zlib";
import { describe, it } from "vitest";
import type { EngineState } from "../../../src/games/croisiere/engine/state";
import { TraceRecorder } from "../../../src/games/croisiere/engine/trace";
import { hasOriginalFiles } from "../engine/support";
import { Driver } from "./driver";
import { makeEngine } from "./engine";
import { PHASES } from "./walkthrough";

const out = process.env.CROISIERE_BENCH_OUT;

/** Fichier écrit par blocs. */
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

const hex = (value: number) => (value >>> 0).toString(16).padStart(8, "0");

/** Trace du banc avec `SC n crc pal` après `VH` (`CRUISE_VARHASH`). */
export class BenchTraceRecorder extends TraceRecorder {
  constructor(
    level: 1 | 2 | 3,
    private readonly out: (line: string) => void,
  ) {
    super(level, true, out);
  }

  override frameEnd(n: number, e: EngineState): void {
    super.frameEnd(n, e);
    this.out(`SC ${n} ${hex(crc32(e.display.globalScreen))} ${hex(crc32(e.display.hardwarePalette))}`);
  }
}

describe.skipIf(!hasOriginalFiles || !out)("enregistrement de la partie complète pour le banc ScummVM", () => {
  it("écrit inputs.txt, port.trace et steps.txt", () => {
    mkdirSync(out!, { recursive: true });
    const files = { inputs: new Out(`${out}/inputs.txt`), trace: new Out(`${out}/port.trace`), steps: new Out(`${out}/steps.txt`) };
    const [from, to] = (process.env.CROISIERE_BENCH_WINDOW ?? "0-1e9").split("-").map(Number) as [number, number];
    const level = Number(process.env.CROISIERE_BENCH_LEVEL ?? 1) as 1 | 2 | 3;
    // Les lignes `SS`/`NF`/`RN` ne portent pas de numéro : elles appartiennent au tour de la dernière ligne `FR`/`MF`.
    let current = 0;
    const recorder = new BenchTraceRecorder(level, (line) => {
      if (line.startsWith("FR ") || line.startsWith("MF ")) current = Number(line.split(" ", 2)[1]);
      if (current >= from && current <= to) files.trace.line(line);
    });
    const driver = new Driver(makeEngine(recorder));
    driver.boot();
    let rank = 0;
    for (const [p, phase] of PHASES.entries()) {
      for (const [index, step] of phase.steps.entries()) {
        driver.run(step);
        files.steps.line(`${rank++} ${p} ${index} ${driver.frameNumber}`);
      }
    }
    for (const line of driver.inputs) files.inputs.line(line);
    for (const file of Object.values(files)) file.close();
  }, 600_000);
});
