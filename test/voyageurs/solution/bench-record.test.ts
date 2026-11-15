/**
 * Outil (pas un test ordinaire) : relevé de la partie complète pour la comparaison au banc ScummVM (vague K).
 *
 * 1. `VOYAGEURS_BENCH_OUT=/chemin/absolu npx vitest run test/voyageurs/solution/bench-record.test.ts` joue la solution (graine 1) et écrit
 *    dans ce dossier `inputs.txt` (entrées au format `CINE_INPUT`, attentes modales adressées `n@k`), `steps.txt` (dernier tick de chaque
 *    étape), `shot-ticks.txt` (liste pour `CINE_SHOT_TICKS`) et `port.tk` (lignes `TK` du portage).
 * 2. Banc : `CINE_SHOT_TICKS=$(cat shot-ticks.txt) CINE_SHOT_DIR=DOSSIER/shots bench/fw-replay.sh DOSSIER/inputs.txt DOSSIER/bench DERNIER_TICK 1`
 *    (`bench/README-fw.md`).
 * 3. `VOYAGEURS_BENCH_IN=/chemin/absolu` (le même dossier) : lit `bench/fw.trace` et `shots/tk-NNNN.idx|pal` du banc et écrit
 *    `scummvm-checkpoints.txt` ; à recopier, avec `inputs.txt` (sous le nom `scummvm-inputs.txt`), dans `fixtures/`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { hasOriginalFiles } from "../engine/helpers";
import { type Checkpoint, formatCheckpoint, sha12, traceHash } from "./bench";
import { playSolution } from "./play";

const out = process.env.VOYAGEURS_BENCH_OUT;
const input = process.env.VOYAGEURS_BENCH_IN;

describe.skipIf(!hasOriginalFiles || (!out && !input))("relevé de la partie complète pour le banc ScummVM", () => {
  it.skipIf(!out)("joue la solution et écrit les entrées et les ticks de fin d'étape", () => {
    const played = playSolution();
    const dir = out!;
    mkdirSync(dir, { recursive: true });
    const ticks = [...new Set(played.stepTicks)];
    writeFileSync(`${dir}/inputs.txt`, `${played.driver.inputsText()}\n`);
    writeFileSync(`${dir}/steps.txt`, `${ticks.join("\n")}\n`);
    writeFileSync(`${dir}/shot-ticks.txt`, ticks.join(","));
    writeFileSync(`${dir}/port.tk`, `${played.driver.tkLines.join("\n")}\n`);
  }, 120_000);

  it.skipIf(!input)("calcule les points de contrôle depuis la trace et les captures du banc", () => {
    const dir = input!;
    const ticks = readFileSync(`${dir}/steps.txt`, "utf8").trim().split("\n").map(Number);
    const lines = readFileSync(`${dir}/bench/fw.trace`, "utf8").split("\n").filter((l) => l.startsWith("TK "));
    const checkpoints: Checkpoint[] = [];
    let previous = 0;
    for (const tick of ticks) {
      const idx = `${dir}/shots/tk-${String(tick).padStart(4, "0")}.idx`;
      const image = existsSync(idx) ? sha12(readFileSync(idx), readFileSync(idx.replace(/\.idx$/, ".pal"))) : "-";
      const bg = /bg=(\S+)/.exec(lines[tick - 1] ?? "")?.[1] ?? "-";
      checkpoints.push({ tick, trace: traceHash(lines, previous + 1, tick), image, bg });
      previous = tick;
    }
    const header = [
      "# Banc ScummVM (fw-cd-fr, graine 1, temps virtuel) rejouant scummvm-inputs.txt : un point de contrôle par fin d'étape de la solution.",
      "# tick, trace (sha1, 12 chiffres, des lignes TK sans mus depuis le point précédent), image (sha1 de tk-NNNN.idx + .pal), décor",
    ];
    writeFileSync(`${dir}/scummvm-checkpoints.txt`, `${[...header, ...checkpoints.map(formatCheckpoint)].join("\n")}\n`);
  });
});
