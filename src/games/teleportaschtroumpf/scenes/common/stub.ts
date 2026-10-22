import type { Action } from "../../engine/input";
import { TICKS_PER_SECOND } from "../../engine/clock";
import type { Scene, SceneContext } from "../../engine/scene";
import type { Mcg } from "../../data/mcg";

export interface StubOptions {
  /** Fond MCG de l'écran (sa palette est chargée) ; sans lui, l'écran reste tel quel. */
  mcg?: string;
  /** Fondu d'entrée (seulement avec un fond). */
  fadeIn?: boolean;
  /** Rend la main seule après ce délai (secondes). */
  seconds?: number;
  /** Actions qui rendent la main : la première enfoncée est transmise à `onDone`. */
  keys?: readonly Action[];
  onDone(ctx: SceneContext, action: Action | "timeout"): void;
}

/**
 * Souche d'écran de la phase E2 : affiche (éventuellement) le fond du vrai écran et rend la main sur une touche ou après
 * un délai. Sert aux écrans pas encore reproduits (carte S02, événements S13 à S21, mini-jeux) pour que la partie reste
 * jouable de bout en bout ; chaque écran réel la remplace dans sa fabrique, sans changer le contrat.
 */
export class StubScene implements Scene {
  readonly step = 1;
  private mcg: Mcg | null = null;
  private start = 0;
  private done = false;

  constructor(private readonly options: StubOptions) {}

  async load(ctx: SceneContext): Promise<void> {
    if (this.options.mcg) this.mcg = await ctx.resources.mcg(this.options.mcg);
  }

  enter(ctx: SceneContext): void {
    if (this.mcg) {
      ctx.palette.load(this.mcg.palette);
      ctx.surface.drawMcg(this.mcg, { asBackground: true });
      if (this.options.fadeIn) {
        ctx.fade.blackout();
        ctx.fade.in();
      }
    }
    this.start = ctx.clock.ticks;
    this.done = false;
  }

  update(ctx: SceneContext): void {
    if (this.done || ctx.fade.active) return;
    const pressed = this.options.keys?.find((key) => ctx.input.justPressed(key));
    if (pressed) return this.finish(ctx, pressed);
    const { seconds } = this.options;
    if (seconds !== undefined && ctx.clock.ticks - this.start >= seconds * TICKS_PER_SECOND) this.finish(ctx, "timeout");
  }

  render(ctx: SceneContext): void {
    if (this.mcg) ctx.surface.restoreBackground();
  }

  private finish(ctx: SceneContext, action: Action | "timeout"): void {
    this.done = true;
    this.options.onDone(ctx, action);
  }
}
