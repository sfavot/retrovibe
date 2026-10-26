/** Liaison d'une action : touches clavier (`KeyboardEvent.code`) et boutons de manette standard (indices). */
export interface HeldBinding {
  keys?: string[];
  buttons?: number[];
}

/** Liaison d'un demi-axe de manette (stick) à une action. */
export interface AxisBinding<A extends string> {
  axis: number;
  /** Sens de l'axe qui déclenche l'action. */
  dir: -1 | 1;
  action: A;
  /** Déflexion minimale (0..1) pour compter comme appuyé ; 0,5 par défaut. */
  threshold?: number;
}

/** Sous-ensemble de `Gamepad` utilisé ici, pour pouvoir injecter de fausses manettes dans les tests. */
export interface PadLike {
  connected: boolean;
  mapping?: string;
  buttons: ReadonlyArray<{ pressed: boolean }>;
  axes: ReadonlyArray<number>;
}

export type PadGetter = () => ArrayLike<PadLike | null | undefined>;

const DEFAULT_THRESHOLD = 0.5;

const defaultGetPads: PadGetter = () => (typeof navigator !== "undefined" ? navigator.getGamepads?.() : undefined) ?? [];

/**
 * État d'entrées maintenues, indépendant du jeu : clavier, manette et commandes tactiles alimentent les mêmes actions.
 * Chaque source est suivie à part (relâcher la touche ne relâche pas le bouton de manette), et un appui bref
 * entre deux ticks reste visible via `wasTapped` jusqu'à `endTick()`.
 */
export class HeldInput<A extends string> {
  private readonly keyHeld = new Set<A>();
  private readonly padHeld = new Set<A>();
  private readonly programmatic = new Set<A>();
  private readonly tapped = new Set<A>();
  private readonly byKey = new Map<string, A[]>();

  constructor(
    private readonly bindings: Record<A, HeldBinding>,
    private readonly axes: AxisBinding<A>[] = [],
  ) {
    for (const action of Object.keys(bindings) as A[]) {
      for (const code of bindings[action].keys ?? []) {
        const list = this.byKey.get(code) ?? [];
        list.push(action);
        this.byKey.set(code, list);
      }
    }
  }

  /** `true` si la touche est liée : l'appelant peut alors faire `preventDefault`. */
  keyDown(code: string): boolean {
    const actions = this.byKey.get(code);
    if (!actions) return false;
    for (const a of actions) {
      this.keyHeld.add(a);
      this.tapped.add(a);
    }
    return true;
  }

  keyUp(code: string): boolean {
    const actions = this.byKey.get(code);
    if (!actions) return false;
    for (const a of actions) this.keyHeld.delete(a);
    return true;
  }

  /** Appui programmatique (commandes tactiles). */
  press(action: A): void {
    this.programmatic.add(action);
    this.tapped.add(action);
  }

  release(action: A): void {
    this.programmatic.delete(action);
  }

  isHeld(action: A): boolean {
    return this.keyHeld.has(action) || this.padHeld.has(action) || this.programmatic.has(action);
  }

  /** Appuyé depuis le dernier `endTick()` (même si déjà relâché). */
  wasTapped(action: A): boolean {
    return this.tapped.has(action);
  }

  /** À appeler à la fin de chaque tick : oublie les appuis brefs. */
  endTick(): void {
    this.tapped.clear();
  }

  /** Perte de focus / pause : plus rien n'est tenu. */
  clear(): void {
    this.keyHeld.clear();
    this.padHeld.clear();
    this.programmatic.clear();
    this.tapped.clear();
  }

  /** Lit la première manette standard connectée ; à appeler une fois par image. Sans manette, l'état manette est relâché. */
  pollGamepads(getGamepads: PadGetter = defaultGetPads): void {
    const pads = getGamepads();
    let pad: PadLike | null = null;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p?.connected && (p.mapping === undefined || p.mapping === "" || p.mapping === "standard")) {
        pad = p;
        break;
      }
    }
    const now = new Set<A>();
    if (pad) {
      for (const action of Object.keys(this.bindings) as A[]) {
        if (this.bindings[action].buttons?.some((b) => pad.buttons[b]?.pressed)) now.add(action);
      }
      for (const { axis, dir, action, threshold = DEFAULT_THRESHOLD } of this.axes) {
        if ((pad.axes[axis] ?? 0) * dir >= threshold) now.add(action);
      }
    }
    for (const a of now) if (!this.padHeld.has(a)) this.tapped.add(a);
    this.padHeld.clear();
    for (const a of now) this.padHeld.add(a);
  }
}
