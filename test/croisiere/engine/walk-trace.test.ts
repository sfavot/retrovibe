/**
 * Marche dans la première pièce (S33), comparée tour par tour au banc ScummVM :
 * `cruise-replay.sh fixtures/walk-s33.in DIR 5300 2` (graine 1, temps virtuel, contournement de la protection). Treize clics au sol :
 * trajets directs et par le graphe, clic sur un mur (point ramené dans la zone élargie), clic en pleine rotation, clic sans trajet.
 * Fixtures : `bench-first-room-l2.trace.gz` (tours 1 à 3500, sans entrée) puis `bench-walk-s33-l2.trace.gz` (tours 3501 à 5300),
 * lignes `SC` retirées.
 *
 * Les niveaux de la souris sont rejoués tels quels (`Bench::applyInputs`) : le clic passe par `processInput` → `findObject` → marche,
 * et les lignes `FR` sont comparées en entier.
 */
import { describe, expect, it } from "vitest";
import { replayBench } from "./replay";
import { hasOriginalFiles } from "./support";

const LAST_FRAME = 5300;

describe.skipIf(!hasOriginalFiles)("trace du banc (marche dans la première pièce)", () => {
  it(`est identique au banc jusqu'au tour ${LAST_FRAME}`, () => {
    const { engine, mismatch } = replayBench(["bench-first-room-l2.trace.gz", "bench-walk-s33-l2.trace.gz"], "walk-s33.in", null, LAST_FRAME);
    if (mismatch) throw new Error(mismatch);
    expect(engine.frameNumber).toBe(LAST_FRAME);
  });
});
