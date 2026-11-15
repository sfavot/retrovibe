/**
 * Partie complète comparée au banc ScummVM (vague K) : les entrées de la partie de `full-game.test.ts` (a) (`fixtures/scummvm-inputs.txt`,
 * format `CINE_INPUT`, menus et clics de messages adressés aux attentes modales `n@k`) sont rejouées dans ScummVM (`bench/fw-replay.sh`,
 * graine 1, temps virtuel) et dans le portage. `fixtures/scummvm-checkpoints.txt` garde, pour chaque fin d'étape de la solution (300 ticks
 * distincts, du tick 446 au tick 16 059, générique de fin), l'empreinte des lignes `TK` du banc depuis le point précédent (donc de **chaque
 * tick** : empreinte des 255 globales, scripts actifs et positions, calques, décor, attente de clic, entrées) et celle de l'image capturée
 * (`CINE_SHOT_TICKS`). Seul le champ `mus` (pilote CD) est hors comparaison.
 *
 * Les entrées sont rejouées sans le joueur (`Driver`) : le test ne dépend que du moteur et du rendu. `VOYAGEURS_FULL_GAME=0` le passe.
 * Refaire les fixtures : `bench-record.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { readFont } from "../../../src/games/voyageurs/data/font";
import { FwRenderer } from "../../../src/games/voyageurs/render/renderer";
import { readOriginal } from "../data/helpers";
import { hasOriginalFiles } from "../engine/helpers";
import { parseCheckpoints, readSolutionFixture, sha12, traceHash } from "./bench";
import { parseInputs, replayRecorded } from "./inputs";

const enabled = hasOriginalFiles && process.env.VOYAGEURS_FULL_GAME !== "0";

describe.skipIf(!enabled)("partie complète rejouée comme au banc ScummVM", () => {
  it("traces de chaque tick et images de chaque fin d'étape identiques au banc, jusqu'au générique", () => {
    const inputs = parseInputs(readSolutionFixture("scummvm-inputs.txt"));
    const checkpoints = parseCheckpoints(readSolutionFixture("scummvm-checkpoints.txt"));
    const wanted = new Set(checkpoints.map((c) => c.tick));
    const renderer = new FwRenderer(readFont(readOriginal("TEXTE.DAT")));
    const lines: string[] = [];
    const images = new Map<number, string>();
    const last = checkpoints[checkpoints.length - 1]!.tick;
    replayRecorded(
      inputs,
      last,
      (line) => {
        lines.push(line);
        const tick = Number(line.split(" ")[1]);
        if (wanted.has(tick)) images.set(tick, sha12(renderer.backBuffer, renderer.screenRgb()));
      },
      { renderer },
    );
    expect(lines).toHaveLength(last);
    let previous = 0;
    const port = checkpoints.map((c) => {
      const got = { tick: c.tick, trace: traceHash(lines, previous + 1, c.tick), image: images.get(c.tick) ?? "-", bg: c.bg };
      previous = c.tick;
      return got;
    });
    // Premier point qui diffère (plus lisible qu'un tableau de 300 lignes).
    const diverging = port.find((p, i) => p.trace !== checkpoints[i]!.trace || p.image !== checkpoints[i]!.image);
    expect(diverging ?? null).toBeNull();
    expect(lines[last - 1]).toContain("bg=L44.PI1");
  }, 120_000);
});
