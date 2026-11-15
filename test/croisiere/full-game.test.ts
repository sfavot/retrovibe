/**
 * Partie complète de *Croisière pour un cadavre* (vague K) jouée par de vraies entrées de souris (`solution/driver.ts`), du démarrage
 * (intro, contournement de la protection, première pièce sans aucune entrée) jusqu'au générique de fin, sur les vrais fichiers, sans
 * jamais écrire l'état du jeu : (a) d'une traite ; (b) avec, après chaque étape où le jeu l'accepte (`canSave`), une sauvegarde, un
 * aller-retour en vrai JSON et une reprise dans un moteur neuf.
 *
 * La solution (`solution/walkthrough.ts`) est en données : objets et verbes nommés comme le jeu les affiche, pièces du plan du bateau. La
 * fin : accusation de Désiré, explication (fond `DGF1.PI1`, overlay `DESIRE`), épilogues (`FIN`), générique (`FIN01`, jusqu'au fond
 * `F14.PI1` du « The End »), puis l'overlay `GEN`.
 *
 * Durée (vitest) : environ 1 min chacun (≈ 225 000 tours). Hors de la suite par défaut, qui garde la comparaison au banc ScummVM
 * (`solution/scummvm-replay.test.ts`, mêmes entrées) : `CROISIERE_FULL_GAME=1` les lance, à faire quand la solution, le joueur
 * (`solution/driver.ts`) ou les sauvegardes changent.
 */

import { describe, expect, it } from "vitest";
import { canSave } from "../../src/games/croisiere/engine/save";
import { hasOriginalFiles } from "./engine/support";
import { Driver } from "./solution/driver";
import { makeEngine, resumeInFreshEngine } from "./solution/engine";
import { PHASES } from "./solution/walkthrough";

const enabled = hasOriginalFiles && process.env.CROISIERE_FULL_GAME === "1";

interface Played {
  driver: Driver;
  steps: number;
  resumes: number;
}

/** Joue la solution entière ; `afterStep` peut reprendre la partie dans un moteur neuf. */
function play(afterStep?: (driver: Driver) => boolean): Played {
  const driver = new Driver(makeEngine());
  driver.boot();
  const out: Played = { driver, steps: 0, resumes: 0 };
  for (const phase of PHASES) {
    for (const [index, step] of phase.steps.entries()) {
      try {
        driver.run(step);
      } catch (e) {
        throw new Error(`« ${phase.name} », étape ${index} (${JSON.stringify(step).slice(0, 100)}) : ${(e as Error).message}`);
      }
      out.steps++;
      if (afterStep?.(driver)) out.resumes++;
    }
  }
  return out;
}

function expectEnding({ driver }: Played): void {
  const text = driver.texts.map((t) => t.text).join("\n");
  // Quelques jalons de l'enquête.
  expect(text).toContain("Dans sa précipitation le père a oublié son missel sur la table.");
  expect(text).toContain("En bloquant la ballerine un déclic se produit...");
  expect(text).toContain("Bon sang ! On a assassiné la pauvre Suzanne !!!");
  expect(text).toContain("Tiens, tiens... Un contrat de la mafia au nom de Karaboudjan");
  expect(text).toContain("C'est vous, l'assassin Monsieur Désiré Grosjean!");
  const backgrounds = driver.backgrounds.map((b) => b.split(" ")[1]);
  for (const name of ["DGF1.PI1", "END1.PI1", "F14.PI1"]) expect(backgrounds).toContain(name);
  const loads = driver.overlayLoads.map((o) => o.split(" ")[1]);
  for (const name of ["DESIRE", "FIN", "FIN01", "GEN"]) expect(loads).toContain(name);
  expect(driver.engine.stopped).toBe(false);
}

describe.skipIf(!enabled)("partie complète : du démarrage au générique de fin", () => {
  it("(a) d'une traite, par de vraies entrées de souris", () => {
    const played = play();
    expect(played.steps).toBe(PHASES.reduce((n, p) => n + p.steps.length, 0));
    expectEnding(played);
    expect(played.driver.frameNumber).toBeGreaterThan(200_000);
  }, 600_000);

  it("(b) avec une sauvegarde et une reprise dans un moteur neuf après chaque étape où le jeu l'accepte", () => {
    const sizes: number[] = [];
    const played = play((driver) => {
      if (!canSave(driver.engine.state)) return false;
      const { engine, size } = resumeInFreshEngine(driver.engine);
      sizes.push(size);
      driver.adopt(engine);
      return true;
    });
    expectEnding(played);
    expect(played.resumes).toBeGreaterThan(played.steps * 0.4);
    expect(Math.max(...sizes)).toBeLessThan(500_000);
  }, 1_200_000);
});
