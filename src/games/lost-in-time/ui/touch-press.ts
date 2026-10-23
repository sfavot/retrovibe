/** Durée d'un appui long (ms) : il vaut un clic droit. */
export const LONG_PRESS_MS = 500;
/** Déplacement (pixels CSS) au-delà duquel le doigt glisse au lieu d'appuyer longuement. */
export const LONG_PRESS_SLOP = 10;

export interface TouchPressActions {
  /** Le doigt est à (x, y), coordonnées de la page. */
  move(x: number, y: number): void;
  /** Clic court : 0 au relâchement d'un toucher ou d'un glissement, 2 après un appui long. */
  click(button: 0 | 2): void;
}

export interface Timers {
  set(callback: () => void, ms: number): number;
  clear(id: number): void;
}

const browserTimers: Timers = {
  set: (callback, ms) => window.setTimeout(callback, ms),
  clear: (id) => window.clearTimeout(id),
};

/**
 * Gestes au doigt sur l'écran du jeu : toucher = clic gauche au relâchement, appui long = clic droit
 * (le relâchement ne fait alors plus rien), glissement = le curseur suit puis clic gauche au relâchement.
 * Aucun bouton n'est tenu pendant l'appui : le jeu voit d'abord la position (survol), puis le clic.
 * Un seul doigt est suivi, les autres sont ignorés.
 */
export class TouchPress {
  private pointer: number | null = null;
  private startX = 0;
  private startY = 0;
  private timer: number | null = null;
  private longPressed = false;

  constructor(
    private readonly actions: TouchPressActions,
    private readonly timers: Timers = browserTimers,
  ) {}

  down(id: number, x: number, y: number): void {
    if (this.pointer !== null) return;
    this.pointer = id;
    this.startX = x;
    this.startY = y;
    this.longPressed = false;
    this.actions.move(x, y);
    this.timer = this.timers.set(() => {
      this.timer = null;
      this.longPressed = true;
      this.actions.click(2);
    }, LONG_PRESS_MS);
  }

  move(id: number, x: number, y: number): void {
    if (id !== this.pointer) return;
    if (this.timer !== null && Math.hypot(x - this.startX, y - this.startY) > LONG_PRESS_SLOP) this.stopTimer();
    // une fois l'appui long joué, le curseur reste où il a été donné
    if (!this.longPressed) this.actions.move(x, y);
  }

  up(id: number, x: number, y: number): void {
    if (id !== this.pointer) return;
    this.move(id, x, y);
    const longPressed = this.longPressed;
    this.end();
    if (!longPressed) this.actions.click(0);
  }

  /** Geste interrompu par le navigateur (pointercancel) : aucun clic. */
  cancel(id: number): void {
    if (id === this.pointer) this.end();
  }

  private end(): void {
    this.stopTimer();
    this.pointer = null;
    this.longPressed = false;
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    this.timers.clear(this.timer);
    this.timer = null;
  }
}
