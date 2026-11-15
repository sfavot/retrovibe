import type { MouseButton, VoyageursAction, VoyageursInput } from "../engine/host";

/** Écran logique du jeu. */
export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;

/**
 * Pas du moteur (10 ms) entre l'arrivée du pointeur sur une cible et le clic qui la vise. Le jeu met à jour la ligne de commande et le
 * surlignage des menus d'après la position du pointeur à chaque pas d'attente ; un clic reçu dans le même pas que le déplacement (doigt qui
 * se pose, clic simulé) tomberait avant le survol. Une souris qui survole d'abord, comme un joueur le fait, n'attend rien. 12 pas = un tick
 * de jeu (≈ 110 ms).
 */
export const SETTLE_STEPS = 12;
/** Pas pendant lesquels le bouton reste enfoncé lors d'un toucher (un clic plus bref qu'un tick de jeu serait vu en un seul tour). */
export const TAP_HOLD_STEPS = 6;

/** Bouton du DOM (0 gauche, 1 milieu, 2 droit) -> masque 1 gauche, 2 droit, 3 les deux (le bouton du milieu vaut les deux : menu système). */
function buttonMask(domButton: number): number {
  return domButton === 0 ? 1 : domButton === 2 ? 2 : domButton === 1 ? 3 : 0;
}

interface Queued {
  input: VoyageursInput;
  /** Pas (numéro de `drain`) à partir duquel l'entrée est rendue. */
  due: number;
}

/**
 * File des entrées du moteur (`VoyageursHost.pollInput`), en coordonnées de l'écran de 320 x 200. `drain` est appelée une fois par pas de
 * 10 ms. Tout passe par cette file pour garder l'ordre : déplacement, puis clic (retardé de `SETTLE_STEPS` après un saut de position),
 * puis relâchement. Deux boutons enfoncés ensemble (ou le bouton du milieu) donnent un seul « les deux boutons » (menu système), relâché
 * quand le dernier bouton l'est. En pause plus rien n'entre, sauf les relâchements : un bouton n'est jamais gardé enfoncé.
 */
export class InputQueue {
  private queue: Queued[] = [];
  private held = 0;
  /** « Les deux boutons » a été envoyé : les relâchements isolés sont ignorés jusqu'au dernier. */
  private both = false;
  private paused = false;
  private step = 0;
  private at = { x: 0, y: 0 };
  private movedAt = Number.NEGATIVE_INFINITY;
  /** Dernier geste au doigt : le curseur de la souris n'est plus dessiné jusqu'à un clic de souris. */
  touchMode = false;

  private static clamp(x: number, y: number): { x: number; y: number } {
    return { x: Math.max(0, Math.min(SCREEN_WIDTH - 1, Math.floor(x))), y: Math.max(0, Math.min(SCREEN_HEIGHT - 1, Math.floor(y))) };
  }

  /** Dernière position du pointeur (le curseur est dessiné là, sans attendre le moteur). */
  get position(): { x: number; y: number } {
    return this.at;
  }

  private due(): number {
    return Math.max(this.step, this.queue[this.queue.length - 1]?.due ?? 0);
  }

  private push(input: VoyageursInput, due = this.due()): void {
    const last = this.queue[this.queue.length - 1];
    if (input.type === "move" && last?.input.type === "move") last.input = input;
    else this.queue.push({ input, due });
  }

  private place(at: { x: number; y: number }): void {
    if (this.at.x === at.x && this.at.y === at.y) return;
    this.at = at;
    this.movedAt = this.step;
    this.push({ type: "move", ...at });
  }

  move(x: number, y: number): void {
    if (this.paused) return;
    this.place(InputQueue.clamp(x, y));
  }

  /** Clic en `at` : le pointeur y va d'abord, le bouton attend que le jeu l'ait vu. Rend le pas du clic. */
  private press(at: { x: number; y: number }, button: MouseButton): number {
    this.place(at);
    const due = Math.max(this.due(), this.movedAt + SETTLE_STEPS);
    this.push({ type: "down", button, ...at }, due);
    return due;
  }

  /** Bouton de la souris ou du stylet enfoncé (`button` du DOM). */
  down(domButton: number, x: number, y: number): void {
    const mask = buttonMask(domButton);
    if (mask === 0 || this.paused) return;
    this.touchMode = false;
    this.held |= mask;
    const at = InputQueue.clamp(x, y);
    if (this.held === 3 && !this.both) {
      this.both = true;
      this.press(at, "both");
    } else if (!this.both) {
      this.press(at, mask === 1 ? "left" : "right");
    }
  }

  /** Bouton relâché (aussi en pause : sinon le moteur garderait le bouton enfoncé). */
  up(domButton: number, x: number, y: number): void {
    const mask = buttonMask(domButton);
    if (mask === 0 || !(this.held & mask)) return;
    this.held &= ~mask;
    const at = InputQueue.clamp(x, y);
    if (this.both) {
      if (this.held === 0) {
        this.both = false;
        this.push({ type: "up", button: "both", ...at });
      }
    } else {
      this.push({ type: "up", button: mask === 1 ? "left" : "right", ...at });
    }
  }

  /** Plus aucun bouton enfoncé (perte du focus, pause). */
  releaseAll(): void {
    for (const dom of [0, 2]) this.up(dom, this.at.x, this.at.y);
    if (this.held !== 0) {
      this.held = 0;
      if (this.both) {
        this.both = false;
        this.push({ type: "up", button: "both", ...this.at });
      }
    }
  }

  /** Toucher (0) ou appui long (2) : le pointeur va en (x, y), puis clique ; aucun bouton n'est tenu. */
  tap(button: 0 | 2, x: number, y: number): void {
    if (this.paused) return;
    this.touchMode = true;
    const at = InputQueue.clamp(x, y);
    const game: MouseButton = button === 0 ? "left" : "right";
    const due = this.press(at, game);
    this.push({ type: "up", button: game, ...at }, due + TAP_HOLD_STEPS);
  }

  /** Bouton du jeu enfoncé ou relâché au clavier (Entrée, Échap), à la position du pointeur. */
  key(button: "left" | "right", down: boolean): void {
    if (down) {
      if (this.paused) return;
      this.press(this.at, button);
    } else {
      this.push({ type: "up", button, ...this.at });
    }
  }

  /** Action du clavier (verbe, menu). */
  action(action: VoyageursAction): void {
    if (this.paused) return;
    this.push({ type: "action", action });
  }

  /** En pause : les boutons tenus sont relâchés ; les autres entrées en attente sont jetées. À la reprise, seuls les relâchements restent. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    if (paused) {
      this.releaseAll();
      this.paused = true;
    } else {
      this.paused = false;
      this.queue = this.queue.filter(({ input }) => input.type === "up");
      for (const queued of this.queue) queued.due = this.step;
    }
  }

  /** Les entrées dues à ce pas (un appel par pas de 10 ms). */
  drain(): readonly VoyageursInput[] {
    const out: VoyageursInput[] = [];
    while (this.queue[0] && this.queue[0].due <= this.step) out.push(this.queue.shift()!.input);
    this.step++;
    return out;
  }
}
