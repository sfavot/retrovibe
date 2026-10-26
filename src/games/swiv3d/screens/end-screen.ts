/**
 * Compteurs des écrans de fin de mission (`gm_screen_level_complete` `004194b0`, `gm_screen_game_over` `00419ed8`,
 * docs/swiv3d/screens.md §9) : état pur, sans entrées-sorties.
 *
 * L'original affiche le menu avec les drapeaux 7 : `gm_poll_events` rejoue à chaque tick de 25 ms la logique du monde
 * (`DAT_005b03e8++`, compteur de fin), l'animation des scores (`gm_menu_anim_tick` `004157d0`) et les effets. Aucune touche
 * n'abrège le décompte : une touche termine l'écran (si le compteur de fin a atteint 110) ou est jetée.
 */
import type { LevelOutcome } from "./flow";

/** Durée d'un tick (`0x19` ms, `gm_poll_events`) : 40 ticks par seconde. */
export const TICK_MS = 25;
/** Au-delà de 800 ms entre deux images, l'accumulateur est remis à zéro (pause, fenêtre inactive) : pas de rattrapage. */
export const MAX_CATCHUP_MS = 800;
/** Les touches ne sont prises en compte qu'à partir de ce compteur de fin (`DAT_005b03e8 >= 0x6e`, `00419be7`). */
export const END_GUARD_TICKS = 110;
/**
 * Valeur du compteur de fin quand l'écran apparaît : la boucle de jeu sort à `0x37` après une victoire (`0043c234`) et à `0x23`
 * après la mort du joueur. Les touches sont donc ignorées 55 ticks (1,375 s) après une victoire, 75 ticks (1,875 s) après un game over.
 */
export const END_START_TICKS: Record<LevelOutcome, number> = { complete: 0x37, gameOver: 0x23 };

/** Rangées du tableau de compteurs (`DAT_00480c1c[8]` courants, `DAT_00480bfc[8]` cibles). */
export const COUNTER = { levelScore: 0, totalScore: 1, objectives: 2, bonus: 3, secrets: 4 } as const;
const COUNTER_ROWS = 8;

/**
 * Pas d'un compteur selon l'écart restant à la cible (`004157d0`, vérifié à l'assembleur) : 1 sous 50, 3 sous 100,
 * 71 sous 1000, **12** sous 10 000 (plus lent que la tranche du dessous : particularité de l'original, conservée), 673 au-delà.
 * Un écart nul n'avance pas ; un écart négatif (cible inférieure à la valeur affichée) ne se résorbe jamais : cas inatteignable
 * (les valeurs de départ sont 0 et `total − score du niveau`, cibles positives), traité comme dans l'original.
 */
export function countStep(gap: number): number {
  if (gap === 0) return 0;
  if (gap < 50) return 1;
  if (gap < 100) return 3;
  if (gap < 1000) return 0x47;
  if (gap < 10000) return 0xc;
  return 0x2a1;
}

export interface EndValues {
  levelScore: number;
  totalScore: number;
  objectivesPercent: number;
  bonusPercent: number;
  secretsPercent: number;
}

export class EndCounters {
  /** Valeurs affichées. */
  readonly current: number[] = new Array<number>(COUNTER_ROWS).fill(0);
  /** Valeurs finales. */
  readonly target: number[] = new Array<number>(COUNTER_ROWS).fill(0);
  /** Compteur de fin du niveau (`DAT_005b03e8`) : continue de courir derrière l'écran. */
  ticks: number;
  private acc = 0;

  constructor(outcome: LevelOutcome, values: EndValues) {
    this.ticks = END_START_TICKS[outcome];
    this.target[COUNTER.levelScore] = values.levelScore;
    this.target[COUNTER.totalScore] = values.totalScore;
    this.target[COUNTER.objectives] = values.objectivesPercent;
    this.target[COUNTER.bonus] = values.bonusPercent;
    this.target[COUNTER.secrets] = values.secretsPercent;
    // Le score total part de ce qu'il valait avant le niveau (`c20 = c00 − c1c`) ; les autres compteurs partent de 0.
    this.current[COUNTER.totalScore] = values.totalScore - values.levelScore;
  }

  /** Les touches sont acceptées (compteur de fin ≥ 110). */
  get acceptsKeys(): boolean {
    return this.ticks >= END_GUARD_TICKS;
  }

  /** Tous les compteurs ont atteint leur cible. */
  get done(): boolean {
    return this.current.every((v, i) => v === this.target[i]);
  }

  /** Fait avancer l'horloge de `ms` (même accumulateur que `gm_poll_events`) ; renvoie le nombre de ticks joués. */
  advance(ms: number): number {
    this.acc += ms;
    if (this.acc > MAX_CATCHUP_MS) this.acc = 0;
    let played = 0;
    while (this.acc > TICK_MS) {
      this.acc -= TICK_MS;
      this.tick();
      played++;
    }
    return played;
  }

  private tick(): void {
    this.ticks++;
    for (let i = 0; i < COUNTER_ROWS; i++) this.current[i]! += countStep(this.target[i]! - this.current[i]!);
  }
}
