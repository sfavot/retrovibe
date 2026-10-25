import { FixedStepClock } from "../../../engine/clock";
import { FRAME_RATE } from "../engine/engine";

/** Cadence des images du jeu : retour vertical du VGA à 70,0866 Hz (mesuré, `docs/armaeth/dosbox.md` § 3). */
export const TICK_MS = 1000 / FRAME_RATE;
/** Tics rattrapés au plus en une image : au-delà (machine lente, onglet gelé), le temps perdu est abandonné plutôt que rejoué d'un coup. */
export const MAX_CATCH_UP_TICKS = 5;

/**
 * Cadence à 70,0866 Hz sur les images d'écran : `due(now)` dit combien de tics du moteur jouer à cette image (horloge à pas fixe
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
