/**
 * Séquence de démarrage (docs/swiv3d/screens.md §2) : vidéo `IPLAY`, attente de 3,5 s sur sa dernière image, écrans 1004 et 1005
 * de 3,5 s chacun, puis `INTRO1` et `INTRO2` (seulement si `INTRO1` s'est terminée sans être interrompue).
 *
 * Le port permet de passer les temporisations (l'original, non) ; une vidéo interrompue passe aussi son attente.
 */

/** Durée des logos (`gm_delay_ms(0xdac)`). */
export const HOLD_MS = 3500;

export type BootStep =
  | { kind: "video"; name: string }
  /** Attente : sur la dernière image de la vidéo précédente (`screen` absent) ou devant un écran de `GLOBAL.BD`. */
  | { kind: "hold"; ms: number; screen?: number };

/** Étapes dans l'ordre ; `INTRO2` est ajoutée à la fin de `INTRO1` si elle n'a pas été interrompue. */
const LOGOS: readonly BootStep[] = [
  { kind: "video", name: "IPLAY" },
  { kind: "hold", ms: HOLD_MS },
  { kind: "hold", ms: HOLD_MS, screen: 1004 },
  { kind: "hold", ms: HOLD_MS, screen: 1005 },
];

export class BootSequence {
  private queue: BootStep[];
  private elapsed = 0;
  private current: BootStep | null;

  /** `logos` : IPLAY et écrans de logos (démarrage) ; sans : seulement l'introduction (« Revoir l'intro »). */
  constructor(logos = true) {
    this.queue = [...(logos ? LOGOS : []), { kind: "video", name: "INTRO1" }];
    this.current = this.queue.shift() ?? null;
  }

  /** Étape en cours ; `null` quand tout est joué. */
  get step(): BootStep | null {
    return this.current;
  }

  get done(): boolean {
    return this.current === null;
  }

  /** Temps écoulé dans l'étape en cours (ms). */
  get elapsedMs(): number {
    return this.elapsed;
  }

  /** Avance l'horloge de `dtMs` ; une attente terminée passe à l'étape suivante. */
  update(dtMs: number): void {
    if (this.current?.kind !== "hold") return;
    this.elapsed += dtMs;
    if (this.elapsed >= this.current.ms) this.advance();
  }

  /** Touche ou clic pendant une attente : passe à la suite. Sans effet pendant une vidéo (c'est `videoEnded`). */
  skip(): void {
    if (this.current?.kind === "hold") this.advance();
  }

  /** La vidéo en cours est finie (`skipped` faux) ou interrompue par l'utilisateur (`skipped` vrai). */
  videoEnded(skipped: boolean): void {
    const step = this.current;
    if (step?.kind !== "video") return;
    if (step.name === "INTRO1" && !skipped) this.queue.unshift({ kind: "video", name: "INTRO2" });
    // Interrompre IPLAY passe aussi les 3,5 s qui suivent sur sa dernière image.
    if (step.name === "IPLAY" && skipped) this.queue.shift();
    if (skipped && step.name === "INTRO1") this.queue.length = 0;
    this.advance();
  }

  private advance(): void {
    this.elapsed = 0;
    this.current = this.queue.shift() ?? null;
  }
}
