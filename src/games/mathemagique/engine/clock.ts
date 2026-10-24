/**
 * Durée d'un tick (ms). L'original arme `timeSetEvent((60 + 999) / 60 = 17 ms)` (engine.md §1.1 étape 6, §4.6) : le tick global
 * `1108:8722` avance donc de 17 ms, soit 58,8 ticks/s, et non de 1000/60 = 16,67 ms. On garde **17 ms** : toutes les durées du jeu
 * (compte à rebours en ticks, scripts `SCR`, 10800 ticks de Bowling) sont exprimées en ticks de 17 ms et s'écoulent ainsi
 * à la vitesse d'origine. Conséquence : sur un écran à 60 Hz certaines images ne jouent aucun tick (une sur 50 environ) ; la
 * logique ne dépend que du nombre de ticks, jamais du nombre d'images.
 */
export const TICK_MS = 17;

/** Ticks par seconde (arrondi : 58,82). Ne sert qu'aux conversions approximatives ; les durées exactes sont en ticks. */
export const TICKS_PER_SECOND = 1000 / TICK_MS;

/**
 * Ticks maximum rattrapés en un appel de `update` : au-delà (onglet en arrière-plan, machine en veille), le temps perdu est
 * abandonné plutôt que rejoué d'un coup.
 */
export const MAX_CATCH_UP_TICKS = 15;

/** Nombre de ticks couvrant au moins `ms` millisecondes (arrondi au tick supérieur). */
export function msToTicks(ms: number): number {
  return Math.ceil(ms / TICK_MS - 1e-9);
}

/**
 * Horloge à pas fixe de 17 ms alimentée par `host.now()`.
 *
 * Usage : `clock.update(now)` une fois par image affichée, puis `while (clock.consume()) { …un tick… }`.
 * `ticks` n'avance que dans `consume()`, donc le code d'un tick voit la valeur de ce tick.
 */
export class Clock {
  /** Ticks de jeu écoulés depuis le démarrage. */
  ticks = 0;
  private last: number | null = null;
  /** Temps accumulé et pas encore converti en ticks (ms). */
  private accumulator = 0;
  /** Ticks gagnés par `update` et pas encore consommés. */
  private pending = 0;

  /** Temps de jeu écoulé (ms), au tick près. */
  get ms(): number {
    return this.ticks * TICK_MS;
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
    const whole = Math.floor(this.accumulator / TICK_MS + 1e-6);
    this.accumulator = Math.max(this.accumulator - whole * TICK_MS, 0);
    this.pending = Math.min(this.pending + whole, MAX_CATCH_UP_TICKS);
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

  /** Échéance dans `ticks` ticks (compte à rebours de l'original, `1108:871a`…`8721`). */
  deadline(ticks: number): Deadline {
    return new Deadline(this, ticks);
  }

  /** Chronomètre gelable. */
  createTimer(): Timer {
    return new Timer(this);
  }
}

/**
 * Compte à rebours en ticks : « échéance dans N ticks », relisible et relançable. Remplace les attentes bloquantes
 * de l'original (`1088:1074` / `1091` / `10d2`) : la scène mémorise l'échéance dans son état et teste `expired` à chaque tick.
 */
export class Deadline {
  private end: number;

  constructor(
    private readonly clock: Clock,
    ticks: number,
  ) {
    this.end = clock.ticks + Math.max(0, Math.round(ticks));
  }

  /** Ticks restants (0 une fois l'échéance atteinte). */
  get remaining(): number {
    return Math.max(0, this.end - this.clock.ticks);
  }

  /** Vrai quand l'échéance est atteinte (un compte à rebours de 0 tick est expiré tout de suite). */
  get expired(): boolean {
    return this.clock.ticks >= this.end;
  }

  /** Repart pour `ticks` ticks à partir de maintenant. */
  restart(ticks: number): void {
    this.end = this.clock.ticks + Math.max(0, Math.round(ticks));
  }

  /** Repousse l'échéance sans changer la durée écoulée (ajoute `ticks`). */
  extend(ticks: number): void {
    this.end += Math.round(ticks);
  }
}

/**
 * Chronomètre avec gel : pendant une pause (`freeze`), le temps écoulé ne bouge plus ; `resume` repart de là.
 * Sert au timer du Bowling (10800 ticks, réglable de 1 à 999 s dans le moniteur).
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
