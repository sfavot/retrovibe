/**
 * Partie complète de Lure of the Temptress jouée par de vrais clics (`test/lure/solution/runner.ts`), du début dans la cellule à la fin du
 * jeu (`host.exit()` après la séquence finale) : cellule, village, grottes et monastère, château, enchaînés sans rien écrire dans l'état du
 * jeu. (a) d'une traite ; (b) avec une sauvegarde, un aller-retour en vrai JSON et une reprise dans un moteur neuf après chaque étape
 * (quand le jeu accepte de sauvegarder : pas pendant un dialogue, une séquence ou un combat).
 *
 * Seule la course contre Goewin vers la Weregate (zone des grottes) peut se rejouer : elle n'y attend que ~250 images (voir `zone-caves.ts`).
 *
 * (a) est jouée pour plusieurs graines du hasard : la graine par défaut et les autres graines de 1 à 400 pour lesquelles la solution va au
 * bout (balayage de `docs/lure/group-3.md` : la poursuite du Skorl arrête presque toutes les autres dans la cellule).
 */

import { describe, expect, it } from "vitest";
import { GameState } from "../../src/games/lure/engine/ids";
import type { LureEngine } from "../../src/games/lure/engine/game";
import { captureSave, parseSave, restoreSave } from "../../src/games/lure/engine/save";
import { hasOriginalFiles, makeEngine, type TestHost } from "./engine/test-host";
import { Play, type Step } from "./solution/runner";
import { ZONE_CASTLE_PHASES } from "./solution/zone-castle";
import { ZONE_CAVES_PHASES } from "./solution/zone-caves";
import { ZONE_CELL_STEPS } from "./solution/zone-cell";
import { VILLAGE_FROM_SQUARE } from "./solution/zone-village";

interface Phase {
  name: string;
  steps: readonly Step[];
  retry?: { until: (engine: LureEngine) => boolean; max: number };
}

/** La partie : la cellule finit sur la place du village (10), d'où part le village ; les grottes partent de la place (14). */
const GAME: Phase[] = [
  { name: "la cellule", steps: ZONE_CELL_STEPS },
  { name: "le village", steps: VILLAGE_FROM_SQUARE },
  ...ZONE_CAVES_PHASES.map((p) => ({ ...p, name: `grottes : ${p.name}` })),
  ...ZONE_CASTLE_PHASES.map((p) => ({ ...p, name: `château : ${p.name}` })),
];

interface Ctx {
  engine: LureEngine;
  host: TestHost;
  play: Play;
}

/** Moteur neuf qui reprend la sauvegarde de `ctx` après un aller-retour en vrai JSON ; `null` si le jeu refuse de sauvegarder. */
function resume(ctx: Ctx): Ctx | null {
  const save = captureSave(ctx.engine);
  if (!save) return null;
  const parsed = parseSave(JSON.parse(JSON.stringify(save)));
  expect(parsed).not.toBeNull();
  const { engine, host } = makeEngine();
  expect(restoreSave(engine, parsed!)).toBe(true);
  Object.assign(engine.mouse, ctx.engine.mouse);
  engine.room.mouseX = ctx.engine.mouse.x;
  engine.room.mouseY = ctx.engine.mouse.y;
  host.exits = ctx.host.exits;
  return { engine, host, play: new Play(engine, host) };
}

/** Joue la partie ; `afterStep` peut remplacer le contexte (reprise). Rend le nombre de tentatives par phase. */
function playGame(start: Ctx, afterStep?: (ctx: Ctx) => Ctx): { ctx: Ctx; attempts: Map<string, number> } {
  let ctx = start;
  const attempts = new Map<string, number>();
  for (const phase of GAME) {
    const max = phase.retry?.max ?? 1;
    let attempt = 1;
    for (; attempt <= max; attempt++) {
      try {
        for (const [i, step] of phase.steps.entries()) {
          try {
            ctx.play.run([step]);
          } catch (e) {
            throw new Error(`« ${phase.name} », étape ${i} (${JSON.stringify(step).slice(0, 90)}) : ${(e as Error).message}`);
          }
          expect(ctx.engine.gameState & GameState.CAUGHT, `capturé : « ${phase.name} », étape ${i}`).toBe(0);
          if (afterStep) ctx = afterStep(ctx);
        }
      } catch (e) {
        if (!phase.retry || attempt === max) throw e;
      }
      if (!phase.retry || phase.retry.until(ctx.engine)) break;
    }
    attempts.set(phase.name, attempt);
  }
  return { ctx, attempts };
}

/**
 * Graines jouées : celles de 1 à 400 qui vont au bout de la solution automatique (mesure du 13/11/2026, `docs/lure/group-3.md`). Les
 * autres échouent surtout dans la cellule, où le Skorl poursuit le joueur comme dans ScummVM : limite de la solution, pas du jeu.
 */
const SEEDS = [28, 213, 256];
/** Graine de la variante avec reprises. */
const RESUME_SEED = 213;

describe.skipIf(!hasOriginalFiles)("partie complète : de la cellule à la fin du jeu", () => {
  it.each(SEEDS)("(a) d'une traite, par de vrais clics (graine %i)", (seed) => {
    const { engine, host } = makeEngine({ seed });
    const { ctx, attempts } = playGame({ engine, host, play: new Play(engine, host) });
    expect(ctx.host.exits).toBe(1);
    for (const [name, n] of attempts) expect(n, name).toBeLessThanOrEqual(name.startsWith("grottes") ? 3 : 1);
    const text = ctx.play.log.dialogs.join("\n");
    expect(text).toContain("La torche glisse");
    expect(text).toContain("Faites attention! Voilà le sort.");
    expect(text).toContain("C'est l'oeil de Gethryn");
    expect(text).toContain("Le bondon tombe; le vin commence à couler du fût.");
    expect(ctx.engine.journal.lines.filter((l) => /non port/.test(l))).toEqual([]);
  }, 300_000);

  it(`(b) avec une sauvegarde et une reprise dans un moteur neuf après chaque étape (graine ${RESUME_SEED})`, () => {
    const { engine, host } = makeEngine({ seed: RESUME_SEED });
    let resumes = 0;
    let steps = 0;
    const { ctx } = playGame({ engine, host, play: new Play(engine, host) }, (current) => {
      steps++;
      const next = resume(current);
      if (!next) return current;
      resumes++;
      return next;
    });
    expect(ctx.host.exits).toBe(1);
    expect(resumes).toBeGreaterThan(steps / 2);
  }, 900_000);
});
