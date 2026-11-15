import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { benchInputFile, play } from "./driver";
import { textOf } from "./texts";
import { STEPS } from "./walkthrough";

/**
 * Production de la référence du banc (ignoré sans `WEEN_MAKE_REF`, dossier de sortie) : joue la solution et écrit les
 * entrées au format `GOB_INPUT` (`inputs.txt`), le `VH` de chaque image (`port-vh.txt`), les TOT chargés
 * (`port-tt.txt`) et les points de contrôle (`checkpoints.json`). La comparaison au banc et l'écriture de
 * `fixtures/full-game.json` sont faites hors dépôt (`docs/ween/walkthrough.md`, « Comparaison au banc »).
 */
const dir = process.env.WEEN_MAKE_REF;

describe.skipIf(!dir)("Ween : référence de la partie pour le banc", () => {
  it("joue la solution et écrit entrées, VH et points de contrôle", async () => {
    mkdirSync(dir!, { recursive: true });
    const vh: number[] = [];
    const r = await play(STEPS, { textOf, vh, tail: 12 });
    expect(r.stuck).toBeNull();
    writeFileSync(`${dir}/inputs.txt`, benchInputFile(r.inputs));
    writeFileSync(`${dir}/port-vh.txt`, vh.map((h, i) => `${i + 1} ${h.toString(16).padStart(8, "0")}\n`).join(""));
    writeFileSync(`${dir}/port-tt.txt`, r.tots.map(([n, t]) => `${n} ${t}\n`).join(""));
    writeFileSync(
      `${dir}/checkpoints.json`,
      JSON.stringify(r.checkpoints.map((c) => [c.image, c.vh.toString(16).padStart(8, "0"), c.label])),
    );
  }, 600_000);
});
