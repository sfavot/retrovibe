/**
 * Entrées communes des jeux sur canvas : pointeur (souris, stylet, doigt) converti en coordonnées logiques du jeu, clic
 * droit réservé au jeu, appui long du doigt, et clavier. Chaque jeu garde sa propre traduction vers son moteur (`Input`).
 */

import { isRotated } from "./fullscreen";

/** Taille logique de l'écran du jeu (pixels du canvas, pas pixels CSS). */
export interface LogicalSize {
  width: number;
  height: number;
}

/** Taille logique fixe, ou lue à chaque événement (Lost in Time passe de 320×200 à 640×400 selon l'écran). */
export type LogicalSizeSource = LogicalSize | (() => LogicalSize);

/**
 * Position d'un point de la page (`clientX`, `clientY`) dans l'écran logique du jeu : tient compte de l'échelle et du décalage du canvas.
 *
 * `rotated` : la page est pivotée de 90° dans le sens horaire (plein écran en paysage sur un appareil tenu en portrait,
 * `fullscreen.ts`). `rect` est alors le rectangle englobant du canvas pivoté : sa largeur est la hauteur du canvas, sa hauteur
 * en est la largeur ; le haut du jeu est à droite de l'écran, sa gauche en haut.
 */
export function toLogical(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  size: LogicalSize,
  rotated = false,
): { x: number; y: number } {
  if (rotated) {
    return {
      x: ((clientY - rect.top) * size.width) / rect.height,
      y: ((rect.left + rect.width - clientX) * size.height) / rect.width,
    };
  }
  return {
    x: ((clientX - rect.left) * size.width) / rect.width,
    y: ((clientY - rect.top) * size.height) / rect.height,
  };
}

/** Durée d'un appui long (ms) : il vaut un clic droit. */
export const LONG_PRESS_MS = 500;
/** Déplacement (pixels CSS) au-delà duquel le doigt glisse au lieu d'appuyer longuement. */
export const LONG_PRESS_SLOP = 10;

export interface Timers {
  set(callback: () => void, ms: number): number;
  clear(id: number): void;
}

const browserTimers: Timers = {
  set: (callback, ms) => window.setTimeout(callback, ms),
  clear: (id) => window.clearTimeout(id),
};

/** Minuterie d'appui long : se déclenche si le point reste en place `LONG_PRESS_MS` (tolérance `LONG_PRESS_SLOP`). */
export class LongPress {
  private startX = 0;
  private startY = 0;
  private timer: number | null = null;

  /** `fire` reçoit la position de départ du doigt. */
  constructor(
    private readonly fire: (x: number, y: number) => void,
    private readonly timers: Timers = browserTimers,
  ) {}

  get pending(): boolean {
    return this.timer !== null;
  }

  start(x: number, y: number): void {
    this.stop();
    this.startX = x;
    this.startY = y;
    this.timer = this.timers.set(() => {
      this.timer = null;
      this.fire(this.startX, this.startY);
    }, LONG_PRESS_MS);
  }

  /** Le doigt a glissé trop loin : plus d'appui long. */
  move(x: number, y: number): void {
    if (this.timer !== null && Math.hypot(x - this.startX, y - this.startY) > LONG_PRESS_SLOP) this.stop();
  }

  stop(): void {
    if (this.timer === null) return;
    this.timers.clear(this.timer);
    this.timer = null;
  }
}

export interface TouchPressActions {
  /** Le doigt est à (x, y), coordonnées de la page. */
  move(x: number, y: number): void;
  /** Clic court : 0 au relâchement d'un toucher ou d'un glissement, 2 après un appui long. */
  click(button: 0 | 2): void;
}

/**
 * Gestes au doigt sur l'écran du jeu : toucher = clic gauche au relâchement, appui long = clic droit
 * (le relâchement ne fait alors plus rien), glissement = le curseur suit puis clic gauche au relâchement.
 * Aucun bouton n'est tenu pendant l'appui : le jeu voit d'abord la position (survol), puis le clic.
 * Un seul doigt est suivi, les autres sont ignorés.
 */
export class TouchPress {
  private pointer: number | null = null;
  private longPressed = false;
  private readonly press: LongPress;

  constructor(
    private readonly actions: TouchPressActions,
    timers: Timers = browserTimers,
  ) {
    this.press = new LongPress(() => {
      this.longPressed = true;
      this.actions.click(2);
    }, timers);
  }

  down(id: number, x: number, y: number): void {
    if (this.pointer !== null) return;
    this.pointer = id;
    this.longPressed = false;
    this.actions.move(x, y);
    this.press.start(x, y);
  }

  move(id: number, x: number, y: number): void {
    if (id !== this.pointer) return;
    this.press.move(x, y);
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
    this.press.stop();
    this.pointer = null;
    this.longPressed = false;
  }
}

export interface CanvasPointerHandlers {
  /** Le pointeur est en (x, y), coordonnées logiques ; `event` est nul pour un mouvement issu des gestes du doigt (`tap`). */
  move?(x: number, y: number, event: PointerEvent | null): void;
  /** Bouton enfoncé (souris, stylet, ou doigt sans mode `tap`) : `button` est celui du DOM (0 gauche, 1 milieu, 2 droit). */
  down?(button: number, x: number, y: number, event: PointerEvent): void;
  /** Bouton relâché, ou geste interrompu (`pointercancel`). */
  up?(button: number, x: number, y: number, event: PointerEvent): void;
  /** Le pointeur quitte le canvas. */
  leave?(): void;
  /**
   * Mode « gestes du doigt » (`TouchPress`) : si présent, un doigt ne passe plus par `down` / `up` mais par `move` puis `tap`
   * (0 : toucher, 2 : appui long).
   */
  tap?(button: 0 | 2): void;
  /** Un doigt reste en place `LONG_PRESS_MS` (hors mode `tap`) : position logique de départ. Le doigt garde par ailleurs son `down` / `up`. */
  longPress?(x: number, y: number): void;
}

export interface CanvasPointerOptions {
  /** Premier geste de l'utilisateur (appui, relâchement, toucher) : le moment de débloquer l'audio, qui ne démarre qu'après un geste. */
  onGesture?(): void;
  timers?: Timers;
}

/**
 * Branche le pointeur du canvas : prise de focus et capture du pointeur à l'appui, clic droit réservé au jeu (pas de menu
 * contextuel), pas de défilement au doigt. Renvoie la fonction qui détache tout.
 */
export function bindCanvasPointer(
  canvas: HTMLCanvasElement,
  sizeSource: LogicalSizeSource,
  handlers: CanvasPointerHandlers,
  options: CanvasPointerOptions = {},
): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  const on = <K extends keyof HTMLElementEventMap>(type: K, listener: (event: HTMLElementEventMap[K]) => void, extra: AddEventListenerOptions = {}): void =>
    canvas.addEventListener(type, listener as EventListener, { signal, ...extra });
  const size = (): LogicalSize => (typeof sizeSource === "function" ? sizeSource() : sizeSource);
  /** Position logique d'un point de la page ; nulle si le canvas n'est pas affiché. */
  const locate = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return toLogical(clientX, clientY, rect, size(), isRotated(canvas));
  };
  const gesturesOnly = handlers.tap !== undefined;
  const isTouch = (event: PointerEvent): boolean => event.pointerType === "touch";
  const emitMove = (clientX: number, clientY: number, event: PointerEvent | null): void => {
    const at = locate(clientX, clientY);
    if (at) handlers.move?.(at.x, at.y, event);
  };
  const touch = gesturesOnly
    ? new TouchPress(
        {
          move: (x, y) => emitMove(x, y, null),
          click: (button) => handlers.tap?.(button),
        },
        options.timers,
      )
    : null;
  let pressId: number | null = null;
  const press = new LongPress((x, y) => {
    const at = locate(x, y);
    if (at) handlers.longPress?.(at.x, at.y);
  }, options.timers);
  const stopPress = (event: PointerEvent): void => {
    if (event.pointerId !== pressId) return;
    press.stop();
    pressId = null;
  };

  on("pointermove", (event) => {
    if (touch && isTouch(event)) {
      touch.move(event.pointerId, event.clientX, event.clientY);
      return;
    }
    if (event.pointerId === pressId) press.move(event.clientX, event.clientY);
    emitMove(event.clientX, event.clientY, event);
  });
  on("pointerleave", () => handlers.leave?.());
  // Glisser une pièce au doigt ne fait pas défiler la page (en plus de `touch-action: none`, pour les navigateurs qui l'ignorent).
  on("touchmove", (event) => event.preventDefault(), { passive: false });
  // iOS ne débloque l'audio que sur certains gestes (`touchend`), pas au `pointerdown`.
  on("touchend", () => options.onGesture?.());
  on("pointerdown", (event) => {
    event.preventDefault();
    if (!touch && handlers.longPress && isTouch(event) && event.isPrimary) {
      pressId = event.pointerId;
      press.start(event.clientX, event.clientY);
    }
    canvas.focus();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // pointeur déjà relâché ou événement synthétique : pas de capture, le geste continue
    }
    options.onGesture?.();
    if (touch && isTouch(event)) {
      touch.down(event.pointerId, event.clientX, event.clientY);
      return;
    }
    const at = locate(event.clientX, event.clientY);
    if (at) handlers.down?.(event.button, at.x, at.y, event);
  });
  on("pointerup", (event) => {
    options.onGesture?.();
    stopPress(event);
    if (touch && isTouch(event)) {
      touch.up(event.pointerId, event.clientX, event.clientY);
      return;
    }
    const at = locate(event.clientX, event.clientY);
    if (at) handlers.up?.(event.button, at.x, at.y, event);
  });
  on("pointercancel", (event) => {
    stopPress(event);
    if (touch && isTouch(event)) {
      touch.cancel(event.pointerId);
      return;
    }
    const at = locate(event.clientX, event.clientY);
    if (at) handlers.up?.(event.button, at.x, at.y, event);
  });
  // Le clic droit est un bouton du jeu.
  on("contextmenu", (event) => event.preventDefault());
  return () => controller.abort();
}

export interface KeyboardHandlers {
  /** Touche enfoncée ; renvoyer vrai si le jeu la prend (le navigateur n'en fait alors pas son action). */
  keyDown?(event: KeyboardEvent): boolean | void;
  keyUp?(event: KeyboardEvent): boolean | void;
  /** `target` perd le focus : perdre le focus relâche tout, sinon une touche tenue au moment du clic ailleurs resterait enfoncée. */
  blur?(event: FocusEvent): void;
}

/** Branche le clavier de `target` (canvas, champ de saisie) ; `onGesture` débloque l'audio à la première touche. Renvoie la fonction qui détache tout. */
export function bindKeyboard(target: HTMLElement, handlers: KeyboardHandlers, onGesture?: () => void): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  target.addEventListener(
    "keydown",
    (event) => {
      onGesture?.();
      if (handlers.keyDown?.(event)) event.preventDefault();
    },
    { signal },
  );
  target.addEventListener(
    "keyup",
    (event) => {
      if (handlers.keyUp?.(event)) event.preventDefault();
    },
    { signal },
  );
  if (handlers.blur) target.addEventListener("blur", (event) => handlers.blur?.(event), { signal });
  return () => controller.abort();
}
