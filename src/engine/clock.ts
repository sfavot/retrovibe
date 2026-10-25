export interface FixedStepOptions {
  /** Durée d'un tick (ms). */
  tickMs: number;
  /** Ticks maximum gagnés en attente : au-delà (onglet en arrière-plan), le temps perdu est abandonné. */
  maxCatchUpTicks: number;
}

/**
 * Horloge à pas fixe alimentée par un temps monotone (ms), ex. `host.now()`.
 *
 * Usage : `clock.update(now)` une fois par image affichée, puis `while (clock.consume()) { …un tick… }`.
 * `ticks` n'avance que dans `consume()`, donc le code d'un tick voit la valeur de ce tick.
 */
export class FixedStepClock {
  /** Ticks de jeu consommés depuis le démarrage. */
  ticks = 0;
  readonly tickMs: number;
  private readonly maxCatchUpTicks: number;
  private last: number | null = null;
  /** Temps accumulé et pas encore converti en ticks (ms). */
  private accumulator = 0;
  /** Ticks gagnés par `update` et pas encore consommés. */
  private pending = 0;

  constructor({ tickMs, maxCatchUpTicks }: FixedStepOptions) {
    this.tickMs = tickMs;
    this.maxCatchUpTicks = maxCatchUpTicks;
  }

  /** Accumule le temps écoulé depuis l'appel précédent ; le premier appel ne fait que fixer l'origine. */
  update(nowMs: number): void {
    if (this.last === null) {
      this.last = nowMs;
      return;
    }
    const dt = Math.max(nowMs - this.last, 0);
    this.last = nowMs;
    this.accumulator += dt;
    // Petite tolérance : 1000/60 ms répétés ne doivent pas perdre un tick à cause des flottants.
    const whole = Math.floor(this.accumulator / this.tickMs + 1e-6);
    this.accumulator = Math.max(this.accumulator - whole * this.tickMs, 0);
    this.pending = Math.min(this.pending + whole, this.maxCatchUpTicks);
  }

  /**
   * Oublie le temps écoulé depuis le dernier `update` (reprise après une pause) : le prochain appel ne fait que fixer
   * une nouvelle origine, sans rattraper l'absence. Les ticks déjà gagnés mais pas consommés restent dus.
   */
  resync(): void {
    this.last = null;
    this.accumulator = 0;
  }

  /** Consomme un tick en attente : vrai si un tick vient d'être compté. */
  consume(): boolean {
    if (this.pending <= 0) return false;
    this.pending--;
    this.ticks++;
    return true;
  }
}
