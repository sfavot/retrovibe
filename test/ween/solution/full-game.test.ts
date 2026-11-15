/**
 * Partie de *Ween: The Prophecy* jouée par de vrais clics (vague K, `docs/ween/walkthrough.md`), sur les vrais fichiers,
 * dans les conditions du banc ScummVM (horloge exacte, graine 1 : `driver.ts`) :
 * (a) d'une traite, en vérifiant à chaque étape le TOT atteint, puis les TOT chargés et, à la fin de chaque étape,
 * l'image et le hachage des variables contre la référence du banc (`fixtures/full-game.json`, mêmes entrées rejouées
 * par `GOB_INPUT` ; identité vérifiée aussi image par image lors de la production de la référence) ;
 * (b) avec sauvegarde par le menu de la disquette (SAUVER, emplacement, nom tapé au clavier) à quelques étapes, puis
 * reprise dans un moteur neuf sur le même stockage (CHARGER) : même écran, variables relues identiques aux variables
 * sauvegardées (les 15 540 octets), et fin de la partie depuis la dernière reprise.
 *
 * Partie couverte : celle de `walkthrough.ts` (jusqu.à `END_TOT`) ; état et suite dans `docs/ween/walkthrough.md`.
 * Durée (vitest) : (a) moins d'une seconde, (b) quelques secondes. `WEEN_FULL_GAME=0` les passe.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../../src/engine/storage";
import type { WeenGame } from "../../../src/games/ween/engine/ween";
import { hasOriginalFiles } from "../helpers";
import { benchInputFile, parseSteps, play, type Step } from "./driver";
import { textOf } from "./texts";
import { END_TOT, STEPS } from "./walkthrough";

const enabled = hasOriginalFiles && process.env.WEEN_FULL_GAME !== "0";

/**
 * Référence du banc (`fixtures/full-game.json`) : les entrées posées par le pilote, rejouées dans ScummVM par
 * `GOB_INPUT` ; les TOT chargés (`TT` ; protection sautée en `PS 27 intro.tot 348`) et, à la fin de chaque étape, l'image, le hachage
 * des variables (`VH`, date masquée, recalculé des vidages `GOB_DUMP`) et le libellé de l'étape.
 */
interface Reference {
  inputs: string;
  tots: [number, string][];
  checkpoints: [number, string, string][];
}
const REFERENCE: Reference = JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/full-game.json"), "utf8"));

/** Sauvegarde par la disquette dans l'emplacement `slot` (0 à 14), sous le nom `name`. */
const saveSteps = (slot: number, name: string): Step[] =>
  parseSteps(`
disquette, sauver : b disque ; l SAUVER
emplacement ${slot + 1} : 104,${19 + 10 * slot}
nom : x ${name}
je confirme : k RETURN
`);

/** Reprise : introduction passée, puis disquette, charger, la sauvegarde `name`, confirmation. */
const loadSteps = (name: string): Step[] =>
  parseSteps(`
Échap : w 20 ; !k ESC
EMAJ1000 : t EMAJ1000 ; !m 160,120
disquette, charger : b disque ; l CHARGER
sauvegarde ${name} : l ${name}
je confirme : k RETURN
`);

/**
 * Variables écrites par la sauvegarde d'un emplacement (`CAT.INF`, offset ≥ 600) et relues au chargement : copie prise
 * au moment de l'écriture, et juste après la lecture.
 */
function watchSlots(game: WeenGame, into: { saved?: Uint8Array; loaded?: Uint8Array }): void {
  const saves = game.sys.saves as unknown as Record<"save" | "load", (file: string, v: number, size: number, offset: number) => boolean>;
  for (const op of ["save", "load"] as const) {
    const original = saves[op].bind(saves);
    saves[op] = (file, v, size, offset) => {
      const ok = original(file, v, size, offset);
      if (ok && file.toUpperCase() === "CAT.INF" && offset >= 600) into[op === "save" ? "saved" : "loaded"] = game.inter.variables!.bytes.slice();
      return ok;
    };
  }
}

describe.skipIf(!enabled)("Ween : partie jouée par clics simulés", () => {
  it("(a) solution jouée d'une traite : chaque étape atteint son écran, points de contrôle identiques au banc", async () => {
    const r = await play(STEPS, { textOf });
    expect(r.stuck).toBeNull();
    expect(r.checkpoints).toHaveLength(STEPS.length);
    for (const [i, step] of STEPS.entries()) if (step.tot) expect(r.checkpoints[i].tot, step.label).toBe(step.tot);
    expect(r.game.curTotFile.toUpperCase()).toBe(END_TOT);
    // Banc : mêmes entrées, mêmes TOT, même hachage des variables à la fin de chaque étape
    expect(benchInputFile(r.inputs)).toBe(REFERENCE.inputs);
    expect(r.tots).toEqual(REFERENCE.tots);
    const got = r.checkpoints.map((c) => [c.image, c.vh.toString(16).padStart(8, "0"), c.label]);
    expect(got).toEqual(REFERENCE.checkpoints);
  }, 120_000);

  it("(b) sauvegarde par la disquette à plusieurs étapes, reprise dans un moteur neuf, fin de la partie", async () => {
    // Étapes après lesquelles on sauvegarde, puis reprend : cabane, laboratoire, salle du crâne, stèle.
    const at = ["couteau", "moule", "corde sur les planches", "flambeau sur le support"];
    let done = 0;
    let resumeFrom: Step[] = [];
    const store = new MemoryStorage();
    for (const [k, label] of at.entries()) {
      const index = STEPS.findIndex((s) => s.label === label);
      expect(index, label).toBeGreaterThan(0);
      // partie jusqu'à l'étape (depuis la reprise précédente), puis sauvegarde
      const slot: { saved?: Uint8Array; loaded?: Uint8Array } = {};
      const first = await play([...resumeFrom, ...STEPS.slice(done, index + 1), ...saveSteps(k, `ETAPE${k + 1}`)], {
        store,
        textOf,
        probe: (n, g) => n === 1 && watchSlots(g, slot),
      });
      expect(first.stuck, label).toBeNull();
      const tot = first.game.curTotFile.toUpperCase();
      // reprise dans un moteur neuf : même écran, variables relues identiques à celles sauvegardées ; la partie
      // continue depuis là
      resumeFrom = loadSteps(`ETAPE${k + 1}`);
      const second = await play(resumeFrom, { store, textOf, probe: (n, g) => n === 1 && watchSlots(g, slot) });
      expect(second.stuck, label).toBeNull();
      expect(second.game.curTotFile.toUpperCase(), label).toBe(tot);
      expect(slot.saved, label).toBeDefined();
      expect(slot.loaded, label).toEqual(slot.saved);
      done = index + 1;
    }
    const last = await play([...resumeFrom, ...STEPS.slice(done)], { store, textOf });
    expect(last.stuck).toBeNull();
    expect(last.game.curTotFile.toUpperCase()).toBe(END_TOT);
  }, 300_000);
});
