import type { SceneContext } from "../../engine/scene";

/** Couleur de survol des boutons à palette (RVB 8 bits `10 A4 CC`, la même que le menu S07). */
export const HOVER_COLOR = [0x10, 0xa4, 0xcc] as const;

/**
 * Sauvegarde / restauration d'écran des écrans empilés (engine.md §3 : `12ec:0314` à l'entrée de la pause, copie inverse à
 * la sortie). L'écran du dessous (tampons A et B, palette) est mémorisé à l'entrée et rétabli à la sortie, pour que la
 * scène reprise retrouve ce qu'elle avait affiché. Rien n'est fait si l'écran n'est pas empilé (`replace`) : il n'y a alors
 * aucune scène à reprendre.
 */
export class ScreenSnapshot {
  private work: Uint8Array | null = null;
  private background: Uint8Array | null = null;
  private palette: Uint8Array | null = null;

  /** À appeler au début de `enter`, avant tout dessin. */
  take(ctx: SceneContext): void {
    if (ctx.scenes.depth < 2) {
      this.work = this.background = this.palette = null;
      return;
    }
    this.work = ctx.surface.work.slice();
    this.background = ctx.surface.background.slice();
    this.palette = ctx.palette.colors.slice();
  }

  /** À appeler dans `exit`. */
  restore(ctx: SceneContext): void {
    if (!this.work || !this.background || !this.palette) return;
    ctx.surface.work.set(this.work);
    ctx.surface.background.set(this.background);
    ctx.palette.colors.set(this.palette);
  }
}
