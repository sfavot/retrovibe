import type { PointClickEngine } from "../../../ui/point-click-app";
import { TICK_MS } from "../engine/cadence";
import type { LureEngine } from "../engine/game";
import { canSave } from "../engine/save";
import type { LureRenderer } from "../render/renderer";

/** Temps maximal compté entre deux images d'écran (ms) : un onglet resté en arrière-plan ne fait pas sauter un fondu. */
export const MAX_FRAME_MS = 100;

export interface LureLoopOptions {
  engine: LureEngine;
  renderer: LureRenderer;
  /** Reçoit chaque image (`IndexedPresenter.present`). */
  present(pixels: Uint8Array, palette: Uint8Array): void;
  /** Horloge monotone (millisecondes) ; `performance.now()` par défaut. */
  now?(): number;
}

/**
 * Ce que la page des jeux de pointer-et-cliquer (`ui/point-click-app.ts`) fait avancer : le moteur et son rendu réunis.
 *
 * - **Pas de tick pendant un fondu** (`renderer.fading`) : ScummVM est bloqué dans `paletteFadeIn` / `paletteFadeOut` ; le temps de
 *   jeu s'arrête donc le temps du fondu, que le rendu fait avancer au temps réel (`render` reçoit le temps écoulé depuis l'image
 *   précédente).
 * - **« Passer »** : tant qu'une séquence plein écran est à l'écran (introduction, chute, tonneau, capture, fin), Échap l'abandonne ;
 *   en dehors, Échap demande à quitter : le bouton est grisé.
 */
export class LureLoop implements PointClickEngine {
  private lastRender: number | undefined;

  constructor(private readonly options: LureLoopOptions) {}

  tick(): void {
    if (!this.options.renderer.fading) this.options.engine.tick();
  }

  render(): void {
    this.paint(this.elapsed());
  }

  get canSave(): boolean {
    return canSave(this.options.engine);
  }

  get canSkip(): boolean {
    return this.options.engine.sequenceScreen !== null;
  }

  /** Avance de `ticks` ticks à la main (un tick = une image de 80 ms) et repeint : page de dev, vérifications. */
  step(ticks = 1): void {
    for (let i = 0; i < ticks; i++) {
      this.tick();
      this.paint(TICK_MS);
    }
  }

  private elapsed(): number {
    const now = (this.options.now ?? performance.now.bind(performance))();
    const elapsed = this.lastRender === undefined ? 0 : Math.min(Math.max(now - this.lastRender, 0), MAX_FRAME_MS);
    this.lastRender = now;
    return elapsed;
  }

  private paint(elapsedMs: number): void {
    const { engine, renderer, present } = this.options;
    renderer.render(engine, elapsedMs);
    present(renderer.output, renderer.palette);
  }
}
