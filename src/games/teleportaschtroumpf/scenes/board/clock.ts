import { TICKS_PER_SECOND } from "../../engine/clock";
import type { SceneContext } from "../../engine/scene";

/**
 * Chrono de la partie (`1f33:0181(0)` / `1f33:019a(0)`) en secondes entières de jeu : convertit les ticks écoulés en
 * secondes à appliquer à `Game.tick`. Le reste (moins d'une seconde) reste en réserve, rien n'est perdu ni arrondi à
 * chaque appel ; le temps continue de s'écouler pendant les mini-jeux, les vidéos et les écrans empilés (chrono 0 non gelé).
 */
export class GameClock {
  private last: number;

  constructor(ctx: SceneContext) {
    this.last = ctx.clock.ticks;
  }

  /** Secondes entières écoulées depuis le dernier appel. */
  take(ctx: SceneContext): number {
    const seconds = Math.floor((ctx.clock.ticks - this.last) / TICKS_PER_SECOND);
    this.last += seconds * TICKS_PER_SECOND;
    return seconds;
  }
}
