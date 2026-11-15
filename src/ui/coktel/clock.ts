/** Horloge de jeu qui s'arrête pendant les pauses : le temps écoulé en pause n'est jamais compté. */
export class PausableClock {
  /** Durée cumulée des pauses terminées. */
  private skipped = 0;
  private pausedAt: number | null = null;

  /** `source` : horloge réelle monotone, en millisecondes. */
  constructor(private readonly source: () => number) {}

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  now(): number {
    return (this.pausedAt ?? this.source()) - this.skipped;
  }

  pause(): void {
    this.pausedAt ??= this.source();
  }

  resume(): void {
    if (this.pausedAt === null) return;
    this.skipped += this.source() - this.pausedAt;
    this.pausedAt = null;
  }
}
