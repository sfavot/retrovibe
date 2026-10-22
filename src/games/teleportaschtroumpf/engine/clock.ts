/** Cadence de l'horloge de jeu : INT 8 à 1 193 182 / 19 886 = 60,01 Hz (`3559:0031`), arrondie à 60. */
export const TICKS_PER_SECOND = 60;

/** Écart maximal absorbé en un appel (ms) : au-delà (onglet en arrière-plan), le temps perdu est abandonné. */
const MAX_CATCH_UP_MS = 250;

/**
 * Horloge à pas fixe de 60 ticks/s, alimentée par `host.now()` (millisecondes monotones).
 *
 * Usage : `clock.update(now)` une fois par image affichée, puis `while (clock.consume()) { …un tick… }`.
 * `ticks` n'avance que dans `consume()`, donc le code d'un tick voit la valeur de ce tick.
 */
export class Clock {
  /** Ticks de jeu écoulés (tick de 1/60 s). */
  ticks = 0;
  private last: number | null = null;
  /** Ticks gagnés par `update` et pas encore consommés. */
  private pending = 0;
  /** Reste fractionnaire d'un tick. */
  private fraction = 0;

  /** Centièmes de seconde : l'unité de temps du jeu (`1764:0300` = `ticks × 100 / 60`). */
  get centiseconds(): number {
    return Math.floor((this.ticks * 100) / TICKS_PER_SECOND);
  }

  get seconds(): number {
    return Math.floor(this.ticks / TICKS_PER_SECOND);
  }

  /** Accumule le temps écoulé depuis l'appel précédent ; le premier appel ne fait que fixer l'origine. */
  update(nowMs: number): void {
    if (this.last === null) {
      this.last = nowMs;
      return;
    }
    const dt = Math.min(Math.max(nowMs - this.last, 0), MAX_CATCH_UP_MS);
    this.last = nowMs;
    this.fraction += (dt * TICKS_PER_SECOND) / 1000;
    // Petite tolérance : 1000/60 ms répétés ne doivent pas perdre un tick à cause des flottants.
    const whole = Math.floor(this.fraction + 1e-6);
    this.fraction -= whole;
    this.pending += whole;
  }

  /** Consomme un tick en attente : vrai si un tick vient d'être compté. */
  consume(): boolean {
    if (this.pending <= 0) return false;
    this.pending--;
    this.ticks++;
    return true;
  }

  createTimer(): Timer {
    return new Timer(this);
  }
}

/**
 * Chrono de la bibliothèque du jeu (`1f33:0181` démarre, `1f33:019a` lit en secondes) avec gel
 * (`1f33:01e6` sauve / `1f33:01bf` restaure) : pendant une pause, le temps écoulé ne bouge plus.
 */
export class Timer {
  private startTicks: number;
  private frozenElapsed: number | null = null;

  constructor(private readonly clock: Clock) {
    this.startTicks = clock.ticks;
  }

  /** Ticks écoulés depuis `start()` (ou la création), hors périodes gelées. */
  get ticks(): number {
    return this.frozenElapsed ?? this.clock.ticks - this.startTicks;
  }

  get centiseconds(): number {
    return Math.floor((this.ticks * 100) / TICKS_PER_SECOND);
  }

  get seconds(): number {
    return Math.floor(this.ticks / TICKS_PER_SECOND);
  }

  get frozen(): boolean {
    return this.frozenElapsed !== null;
  }

  start(): void {
    this.startTicks = this.clock.ticks;
    this.frozenElapsed = null;
  }

  freeze(): void {
    if (this.frozenElapsed === null) this.frozenElapsed = this.clock.ticks - this.startTicks;
  }

  resume(): void {
    if (this.frozenElapsed !== null) {
      this.startTicks = this.clock.ticks - this.frozenElapsed;
      this.frozenElapsed = null;
    }
  }
}
