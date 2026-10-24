/**
 * Stores vénitiens (`1018:09b8` → `1018:0722`, bandes de 10 lignes) entre deux états d'une scène qui se dessine directement sur l'écran
 * (Patterns, Sticklers ; Hidden compose sa cible à part, voir `hidden.ts`).
 *
 * Principe : `begin` mémorise la zone de l'écran, laisse la scène **appliquer** le nouvel état (qui se compose sur l'écran), copie l'écran
 * obtenu dans un port de travail, puis remet l'ancienne zone ; la zone est ensuite révélée bande par bande à chaque `tick`. Ce qui est hors de
 * la zone prend le nouvel état tout de suite. Comme l'original (`1018:0889`), un clic pendant la transition la termine d'un coup.
 */
import { Blinds, revealRects } from "../engine/graphics/transitions";
import { Surface, type Rect, type SavedRect } from "../engine/graphics/surface";

/** Hauteur des bandes (paramètre 10 de tous les appels de l'original). */
const STRIP_HEIGHT = 10;

export class ScreenTransition {
  private readonly work = new Surface();
  private blinds: Blinds | null = null;
  private done: (() => void) | null = null;
  private age = 0;

  constructor(private readonly screen: Surface) {}

  get active(): boolean {
    return this.blinds !== null;
  }

  /**
   * Lance la transition de `rect` sur `ticks` ticks. `apply` change l'état de la scène et le compose sur l'écran ; `done` est appelé quand
   * la zone est entièrement révélée (c'est là que la scène charge sa palette et redessine ses boutons).
   */
  begin(rect: Rect, ticks: number, apply: () => void, done: () => void): void {
    const old: SavedRect = this.screen.saveRect(rect);
    apply();
    this.work.copyFrom(this.screen);
    this.screen.restoreRect(old);
    this.blinds = new Blinds(rect, ticks, STRIP_HEIGHT);
    this.done = done;
    this.age = 0;
  }

  /** Un tick ; `skip` : un clic a été fait. Renvoie vrai si l'écran a changé. `done` peut lancer la transition suivante. */
  tick(clicked: boolean): boolean {
    const blinds = this.blinds;
    if (!blinds) return false;
    // Le clic qui a déclenché la transition (même tick) ne l'achève pas.
    const skip = this.age++ > 0 && clicked;
    const rects = skip ? blinds.finish() : blinds.step();
    revealRects(this.screen, this.work, rects);
    if (blinds.done) {
      const done = this.done;
      this.blinds = null;
      this.done = null;
      done?.();
    }
    return rects.length > 0 || blinds.done;
  }

  /** Abandonne la transition en cours (sortie de scène). */
  cancel(): void {
    this.blinds = null;
    this.done = null;
  }
}
