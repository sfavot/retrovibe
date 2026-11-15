/**
 * Partie complète comparée au banc ScummVM (vague K) : les entrées de la partie de `full-game.test.ts` (a), relevées tour par tour
 * (`fixtures/scummvm-inputs.txt`, niveaux de souris `n x y b` de `CRUISE_INPUT`), sont rejouées dans ScummVM (`scripts/croisiere/bench/cruise-replay.sh` :
 * `cruise-fr`, graine 1, temps virtuel, contournement de la protection) et dans le portage ; `fixtures/scummvm-checkpoints.txt` garde, pour
 * chaque fin d'étape de la solution, l'empreinte de la trace du banc depuis le point précédent (lignes `FR` : souris, utilisateur, attente,
 * menus, dialogue, vitesse ; `MF` : tours modaux ; `VH` : empreinte des 2 000 `globalVars`, à chaque tour) et la ligne `SC` du tour (CRC32
 * de l'image présentée et de la palette). Fixtures refaites par `bench-record.test.ts` puis `scripts/croisiere/bench/cruise-checkpoints.py`.
 *
 * Résultat (banc du 15 novembre 2026) : les 672 444 lignes `FR`/`VH`/`SC` des 224 148 tours sont identiques, image comprise à chaque tour.
 *
 * Les entrées sont rejouées sans le joueur (`Driver`) : le test ne dépend pas de la solution, seulement du moteur. Seule partie complète de
 * la suite par défaut (environ 50 s) ; `CROISIERE_FULL_GAME=0` la passe, `CROISIERE_FULL_GAME=1` ajoute celles de `full-game.test.ts`.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { EngineState } from "../../../src/games/croisiere/engine/state";
import { TraceRecorder } from "../../../src/games/croisiere/engine/trace";
import { hasOriginalFiles } from "../engine/support";
import { makeEngine } from "./engine";

const enabled = hasOriginalFiles && process.env.CROISIERE_FULL_GAME !== "0";

const fixture = (name: string): string[] =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"));

const hex = (value: number) => (value >>> 0).toString(16).padStart(8, "0");

interface Checkpoint {
  frame: number;
  trace: string;
  sc: string;
}

/** Trace de niveau 1 avec `VH` et `SC` (comme `CRUISE_TRACE=1 CRUISE_VARHASH=1`), vers `sink`. */
class Recorder extends TraceRecorder {
  constructor(private readonly out: (line: string) => void) {
    super(1, true, out);
  }

  override frameEnd(n: number, e: EngineState): void {
    super.frameEnd(n, e);
    this.out(`SC ${n} ${hex(crc32(e.display.globalScreen))} ${hex(crc32(e.display.hardwarePalette))}`);
  }
}

describe.skipIf(!enabled)("partie complète comparée au banc ScummVM (mêmes entrées tour par tour)", () => {
  it("points de contrôle du démarrage au générique : trace (souris, état de l'interface, variables) et image identiques", () => {
    const inputs = fixture("scummvm-inputs.txt").map((line) => line.split(" ").map(Number) as [number, number, number, number]);
    const checkpoints: Checkpoint[] = fixture("scummvm-checkpoints.txt").map((line) => {
      const [frame, trace, ...sc] = line.split(" ");
      return { frame: Number(frame), trace: trace!, sc: sc.join(" ") };
    });
    const last = checkpoints.at(-1)!.frame;

    // Segments (point précédent, point de contrôle], comme `cruise-checkpoints.py`.
    const traces: string[] = [];
    const screens = new Map<number, string>();
    let k = 0;
    let segment = createHash("sha1");
    const add = (line: string): void => {
      if (!/^(FR|MF|VH|SC) /.test(line)) return; // `PROT` (contournement de la protection) : hors de l'empreinte, comme le script
      const n = Number(line.split(" ", 2)[1]);
      while (k < checkpoints.length && n > checkpoints[k]!.frame) {
        traces.push(segment.digest("hex").slice(0, 12));
        segment = createHash("sha1");
        k++;
      }
      if (k === checkpoints.length) return;
      if (line.startsWith("SC ")) {
        if (n === checkpoints[k]!.frame) screens.set(n, line.slice(line.indexOf(" ", 3) + 1));
        return;
      }
      segment.update(`${line}\n`);
    };
    const engine = makeEngine(new Recorder(add));
    let next = 0;
    engine.onTickStart = (tick) => {
      while (next < inputs.length && inputs[next]![0] <= tick) {
        const [, x, y, b] = inputs[next++]!;
        engine.applyInputLevel(x, y, b);
      }
      engine.releaseBenchEscape();
    };
    while (engine.frameNumber < last && !engine.stopped) engine.runFrame();
    add(`FR ${last + 1}`); // clôt le dernier segment

    expect(next).toBe(inputs.length);
    const wrong = checkpoints
      .map((c, i) => ({ c, trace: traces[i], sc: screens.get(c.frame) }))
      .filter(({ c, trace, sc }) => trace !== c.trace || sc !== c.sc)
      .map(({ c, trace, sc }) => `tour ${c.frame} : trace ${trace}/${c.trace}, image ${sc}/${c.sc}`);
    expect(wrong.slice(0, 5)).toEqual([]);
    expect(checkpoints).toHaveLength(219);
    expect(last).toBe(224_148); // overlay GEN chargé après le générique de fin
  }, 600_000);
});
