import { FixedStepClock } from "../engine/clock";

/**
 * Cadence d'un moteur à ticks fixes sur les images de l'écran : `due(now)` rend le nombre de ticks à passer (rattrapage limité à
 * `maxCatchUpTicks`), `resync()` repart de l'instant présent (après une pause ou un chargement).
 */
export class TickScheduler {
  private readonly clock: FixedStepClock;

  constructor(tickMs: number, maxCatchUpTicks: number) {
    this.clock = new FixedStepClock({ tickMs, maxCatchUpTicks });
  }

  due(now: number): number {
    this.clock.update(now);
    let count = 0;
    while (this.clock.consume()) count++;
    return count;
  }

  resync(): void {
    this.clock.resync();
  }
}
