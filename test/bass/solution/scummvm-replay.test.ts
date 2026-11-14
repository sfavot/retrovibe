/**
 * Partie complète comparée au banc ScummVM (`docs/bass/engine.md` § 20) : les entrées de la partie de `full-game.test.ts` (a), relevées tour
 * par tour (`fixtures/scummvm-inputs.txt`, 2 572 entrées), sont rejouées dans ScummVM (`bench/sky-replay.sh` : `SKY_INPUT`, graine 1, voix
 * coupées, temps virtuel) et dans le portage ; `fixtures/scummvm-checkpoints.txt` garde, pour chaque fin d'étape de la solution (465 tours
 * distincts, du tour 113 au tour 89 417, générique de fin), l'empreinte de la trace du banc depuis le point précédent (lignes `CY`, `VH`
 * et `MC` : écran, Foster, Joey, empreinte des 838 variables à chaque tour, chaque appel de mcode avec ses arguments) et celle de l'image
 * capturée (`SKY_SHOT_CYCLES`).
 *
 * Les entrées sont rejouées sans le joueur (`Driver`) : le test ne dépend pas de la solution, seulement du moteur. Durée : environ 10 s
 * (écran branché). `BASS_FULL_GAME=0` le passe.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BassEngine } from "../../../src/games/bass/engine/game";
import { type BassInput, TestHost } from "../../../src/games/bass/engine/host";
import { TraceRecorder } from "../../../src/games/bass/engine/trace";
import { BassScreenRenderer } from "../../../src/games/bass/render/screen";
import { hasOriginalFiles, makeEngine } from "../engine/helpers";
import { frameHash } from "../render/harness";
import { inputLine, parseInputLine, type TimedInput, varHash } from "./bench";

const enabled = hasOriginalFiles && process.env.BASS_FULL_GAME !== "0";

const fixture = (name: string): string[] =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"));

interface Checkpoint {
  cycle: number;
  trace: string;
  frame: string;
  cy: string;
}

/** Hôte qui remet les entrées du tour `n` quand le tour `n - 1` a commencé (elles sont lues au début du tour `n`, comme `SKY_INPUT`). */
class ReplayHost extends TestHost {
  private next = 0;
  engine?: BassEngine;

  constructor(private readonly inputs: readonly TimedInput[]) {
    super();
  }

  override pollInput(): readonly BassInput[] {
    const out: BassInput[] = [];
    const started = this.engine?.cycleCount ?? 0;
    while (this.next < this.inputs.length && this.inputs[this.next]!.n <= started + 1) out.push(this.inputs[this.next++]!.event);
    return out;
  }
}

describe.skipIf(!enabled)("partie complète comparée au banc ScummVM (mêmes entrées tour par tour)", () => {
  it("465 points de contrôle, du départ au générique : trace (écran, Foster, Joey, variables, mcodes) et image identiques", () => {
    const inputs = fixture("scummvm-inputs.txt").map(parseInputLine);
    const checkpoints: Checkpoint[] = fixture("scummvm-checkpoints.txt").map((line) => {
      const [cycle, trace, frame, ...cy] = line.split(" ");
      return { cycle: Number(cycle), trace: trace!, frame: frame!, cy: cy.join(" ") };
    });
    const last = checkpoints.at(-1)!.cycle;

    // Trace de niveau 1 + `VH`, découpée en segments (tour précédent, point de contrôle] comme `sky-checkpoints.py`.
    const traces: string[] = [];
    const cys = new Map<number, string>();
    let k = 0;
    let segment = createHash("sha1");
    const add = (line: string): void => {
      const n = Number(line.split(" ", 2)[1]);
      while (k < checkpoints.length && n > checkpoints[k]!.cycle) {
        traces.push(segment.digest("hex").slice(0, 12));
        segment = createHash("sha1");
        k++;
      }
      if (k === checkpoints.length) return;
      segment.update(`${line}\n`);
      if (line.startsWith("CY ") && n === checkpoints[k]!.cycle) cys.set(n, line.slice(line.indexOf(" ", 3) + 1));
    };
    const recorder = new TraceRecorder(1, add);
    const applied: string[] = [];
    const host = new ReplayHost(inputs);
    const renderer = new BassScreenRenderer();
    const { engine } = makeEngine({
      host,
      screen: (e) => renderer.attach(e),
      trace: {
        cycle: (n, vars, compacts) => {
          recorder.cycle(n, vars, compacts);
          add(`VH ${n} ${varHash(vars)}`);
        },
        mcode: (id, num, a, b, c) => recorder.mcode(id, num, a, b, c),
        input: (n, event) => applied.push(inputLine(n, event)),
      },
    });
    host.engine = engine;
    engine.startAfterIntro();

    const frames = new Map<number, string>();
    let j = 0;
    // Un tour de plus que le dernier point : les mcodes de `mouseEngine` du tour suivant portent le numéro du tour (comme dans le banc).
    for (let t = 0; engine.cycleCount <= last; t++) {
      if (t > last * 200) throw new Error(`le moteur ne termine plus de tour (tour ${engine.cycleCount})`);
      engine.tick();
      while (j < checkpoints.length && engine.completedCycles === checkpoints[j]!.cycle) {
        frames.set(checkpoints[j]!.cycle, frameHash(renderer.frame.pixels, renderer.frame.palette).slice(0, 12));
        j++;
      }
    }
    add(`CY ${last + 1}`); // clôt le dernier segment

    // Les entrées ont été appliquées aux tours relevés.
    expect(applied).toEqual(inputs.map(({ n, event }) => inputLine(n, event)));
    const wrong = checkpoints
      .map((c, i) => ({ c, trace: traces[i], frame: frames.get(c.cycle), cy: cys.get(c.cycle) }))
      .filter(({ c, trace, frame, cy }) => trace !== c.trace || frame !== c.frame || cy !== c.cy)
      .map(({ c, trace, frame, cy }) => `tour ${c.cycle} : trace ${trace}/${c.trace}, image ${frame}/${c.frame}, CY « ${cy} » / « ${c.cy} »`);
    expect(wrong.slice(0, 5)).toEqual([]);
    expect(checkpoints).toHaveLength(465);
    expect(checkpoints.at(-1)!.cy.startsWith("scr=85 ")).toBe(true); // générique de fin
    expect(engine.journal).toEqual([]);
  }, 120_000);
});
