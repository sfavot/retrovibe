import type { Mcg } from "../data/mcg";
import { TICKS_PER_SECOND } from "./clock";
import type { Scene, SceneContext } from "./scene";

export interface PictureSceneOptions {
  /** Nom d'origine du MCG, par ex. `s05a.mcg`. Sa palette est chargée avec l'image. */
  mcg: string;
  /** Fondu d'entrée depuis le noir. Sans lui, l'image apparaît à pleine luminosité. */
  fadeIn?: boolean;
  /** Durée d'affichage en secondes une fois l'image visible ; sans valeur, la scène reste affichée indéfiniment. */
  seconds?: number;
  /** Échap ou clic gauche (ou Espace) abrègent l'attente (`1f33:02c0`). Défaut : vrai. */
  skippable?: boolean;
  /** Fondu au noir à la fin de l'attente avant `onEnd`. */
  fadeOutAtEnd?: boolean;
  /** Ressources supplémentaires à charger avec la scène. */
  load?(ctx: SceneContext): Promise<void>;
  /** Appelé à l'entrée, après le dessin du fond. */
  onEnter?(ctx: SceneContext): void;
  /** Appelé une fois à la fin de l'attente (inutile si `seconds` est absent et que l'on ne passe pas). */
  onEnd?(ctx: SceneContext): void;
}

/**
 * Scène générique « image fixe » : affiche un MCG (fond B et tampon A), avec fondu d'entrée facultatif, attente
 * facultative, fondu de sortie facultatif. C'est l'affichage standard d'un MCG de l'original (`13fc:0150`).
 */
export class PictureScene implements Scene {
  readonly step = 1;

  private mcg: Mcg | null = null;
  private phase: "fadeIn" | "hold" | "fadeOut" | "done" = "hold";
  private holdStart = 0;

  constructor(private readonly options: PictureSceneOptions) {}

  async load(ctx: SceneContext): Promise<void> {
    const [mcg] = await Promise.all([ctx.resources.mcg(this.options.mcg), this.options.load?.(ctx)]);
    this.mcg = mcg;
  }

  enter(ctx: SceneContext): void {
    const mcg = this.mcg!;
    ctx.palette.load(mcg.palette);
    ctx.surface.drawMcg(mcg, { asBackground: true });
    if (this.options.fadeIn) {
      ctx.fade.blackout();
      ctx.fade.in();
      this.phase = "fadeIn";
    } else {
      ctx.fade.reset();
      this.startHold(ctx);
    }
    this.options.onEnter?.(ctx);
  }

  private startHold(ctx: SceneContext): void {
    this.phase = "hold";
    this.holdStart = ctx.clock.ticks;
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "fadeIn":
        if (!ctx.fade.active) this.startHold(ctx);
        break;
      case "hold": {
        const { seconds } = this.options;
        if (seconds === undefined) break;
        const skip = this.options.skippable !== false && ctx.input.anyJustPressed("skip", "validate");
        if (skip || ctx.clock.ticks - this.holdStart >= seconds * TICKS_PER_SECOND) {
          if (this.options.fadeOutAtEnd) {
            ctx.fade.out();
            this.phase = "fadeOut";
          } else {
            this.finish(ctx);
          }
        }
        break;
      }
      case "fadeOut":
        if (!ctx.fade.active) this.finish(ctx);
        break;
      case "done":
        break;
    }
  }

  render(ctx: SceneContext): void {
    ctx.surface.restoreBackground();
  }

  private finish(ctx: SceneContext): void {
    this.phase = "done";
    this.options.onEnd?.(ctx);
  }
}

export interface WaitSceneOptions {
  seconds: number;
  skippable?: boolean;
  onEnd(ctx: SceneContext): void;
}

/** Attente d'au plus `seconds` secondes sur l'écran tel qu'il est (noir après un fondu), passable par Échap ou clic. */
export class WaitScene implements Scene {
  readonly step = 1;
  private start = 0;
  private done = false;

  constructor(private readonly options: WaitSceneOptions) {}

  enter(ctx: SceneContext): void {
    this.start = ctx.clock.ticks;
  }

  update(ctx: SceneContext): void {
    if (this.done) return;
    const skip = this.options.skippable !== false && ctx.input.anyJustPressed("skip", "validate");
    if (skip || ctx.clock.ticks - this.start >= this.options.seconds * TICKS_PER_SECOND) {
      this.done = true;
      this.options.onEnd(ctx);
    }
  }

  render(): void {
    // L'écran reste tel quel.
  }
}
