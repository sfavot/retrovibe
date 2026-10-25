import { FixedStepClock } from "../../../engine/clock";

/** Cadence du jeu : IRQ0 à 50 Hz (`docs/armaeth/plan.md`). */
export const TICK_MS = 20;
/** Tics rattrapés au plus en une image : au-delà (machine lente, onglet gelé), le temps perdu est abandonné plutôt que rejoué d'un coup. */
export const MAX_CATCH_UP_TICKS = 5;

/**
 * Cadence à 50 Hz sur les images d'écran : `due(now)` dit combien de tics du moteur jouer à cette image (horloge à pas fixe
 * partagée). Après une pause (onglet masqué), `resync()` fait oublier l'absence : le jeu reprend sans rattrapage.
 */
export class TickScheduler {
  private readonly clock = new FixedStepClock({ tickMs: TICK_MS, maxCatchUpTicks: MAX_CATCH_UP_TICKS });

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
