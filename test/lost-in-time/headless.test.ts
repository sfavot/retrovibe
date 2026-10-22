import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Game } from "../../src/games/lost-in-time/engine/game";
import { HeadlessHost, NullSubsystems, WaitingForInput } from "../../src/games/lost-in-time/engine/host";
import { StepBudgetExceeded } from "../../src/games/lost-in-time/engine/interpreter";
import { hasOriginalFiles, loadArchive } from "./helpers";

const ORIGINAL = resolve(import.meta.dirname, "../../original/lost-in-time");

function makeGame(maxSteps = 200_000) {
  const host = new HeadlessHost({
    readFile: (name) => {
      const path = resolve(ORIGINAL, name);
      return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
    },
  });
  const sys = new NullSubsystems({
    overrides: {
      hotspots: {
        evaluate: () => {
          throw new WaitingForInput("zones de la souris");
        },
        check: () => {
          throw new WaitingForInput("hotspots.check");
        },
      },
    },
  });
  const game = new Game(host, sys, { maxSteps });
  game.inter.keyFuncLimit = 3000;
  return { host, sys, game };
}

/** Lance `run` ; retourne pourquoi le moteur s'est arrêté (attente d'entrée, budget, fin). */
async function runUntilWait(run: () => Promise<void>): Promise<string> {
  try {
    await run();
    return "terminé";
  } catch (e) {
    if (e instanceof WaitingForInput) return `attente : ${e.reason}`;
    if (e instanceof StepBudgetExceeded) return "budget";
    throw e;
  }
}

describe.skipIf(!hasOriginalFiles)("exécution à blanc", () => {
  it("démarre sur INTRO.TOT jusqu'à la première attente d'entrée", async () => {
    const { game, sys } = makeGame();
    const outcome = await runUntilWait(() => game.start());
    expect(outcome).toMatch(/^attente/);
    expect(game.inter.steps).toBeGreaterThan(20);
    // L'introduction dessine, charge de la palette et lit le CD avant d'attendre.
    expect(sys.calls.length).toBeGreaterThan(20);
  });

  const toNames = loadArchive("INTRO.STK")
    .entries.filter((e) => /^EMAM\d+\.TOT$/.test(e.name))
    .map((e) => e.name);

  it("trouve les TOT EMAM*", () => {
    expect(toNames.length).toBeGreaterThan(40);
  });

  for (const name of toNames) {
    it(`${name} : fonction d'entrée jusqu'à la première attente`, async () => {
      const { game } = makeGame(100_000);
      await game.files.openArchive("INTRO.STK", true);
      const tot = game.files.get(name)!;
      game.inter.allocateVars(new DataView(tot.buffer, tot.byteOffset, tot.byteLength).getUint32(0x2c, true) & 0xffff);
      const outcome = await runUntilWait(() => game.runTot(name));
      expect(outcome === "terminé" || outcome.startsWith("attente"), outcome).toBe(true);
    });
  }
});
