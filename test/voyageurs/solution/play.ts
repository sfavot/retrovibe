/**
 * Partie complète jouée par `Driver` d'après `PHASES` (vague K), commune à `full-game.test.ts` et à `bench-record.test.ts`.
 */

import { Driver } from "./driver";
import { PHASES } from "./walkthrough";

export interface Played {
  driver: Driver;
  steps: number;
  resumes: number;
  /** Dernier tick achevé à la fin de chaque étape (dans l'ordre). */
  stepTicks: number[];
  /** Décors traversés. */
  backgrounds: Set<string>;
}

/** Joue la solution entière ; `afterStep` peut remplacer le joueur (reprise d'une sauvegarde). */
export function playSolution(afterStep?: (driver: Driver) => Driver | null): Played {
  let driver = new Driver();
  const out: Played = { driver, steps: 0, resumes: 0, stepTicks: [], backgrounds: new Set() };
  for (const phase of PHASES) {
    for (const [index, step] of phase.steps.entries()) {
      try {
        driver.run(step);
      } catch (e) {
        throw new Error(`« ${phase.name} », étape ${index} (${JSON.stringify(step).slice(0, 100)}) : ${(e as Error).message}`);
      }
      out.steps++;
      out.stepTicks.push(driver.engine.ticks);
      out.backgrounds.add(driver.bg);
      const next = afterStep?.(driver);
      if (next) {
        driver = next;
        out.resumes++;
      }
    }
  }
  out.driver = driver;
  return out;
}

/** Nombre d'étapes de la solution. */
export const STEP_COUNT = PHASES.reduce((n, p) => n + p.steps.length, 0);

/**
 * Joue la solution jusqu'à l'étape `step` (exclue) de la partie dont le nom commence par `phase` ; rend le joueur (pour s'écarter de la
 * solution : morts du héros).
 */
export function playTo(phase: string, step: number): Driver {
  const driver = new Driver();
  for (const p of PHASES) {
    const last = p.name.startsWith(phase);
    for (const [index, s] of p.steps.entries()) {
      if (last && index >= step) return driver;
      driver.run(s);
    }
    if (last) return driver;
  }
  throw new Error(`partie « ${phase} » absente de la solution`);
}

/** Étape de la partie `phase` dont la note ou le texte (JSON) contient `fragment` : son rang. */
export function stepIndex(phase: string, fragment: string): number {
  const p = PHASES.find((x) => x.name.startsWith(phase));
  const index = p?.steps.findIndex((s) => JSON.stringify(s).includes(fragment)) ?? -1;
  if (index < 0) throw new Error(`étape « ${fragment} » absente de la partie « ${phase} »`);
  return index;
}
