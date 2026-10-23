import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../data/mcg";

/**
 * Actions abstraites du jeu (engine.md §4 et §9.6). Clavier et boutons de souris sont deux sources de ces mêmes actions :
 * l'original émule les boutons de la souris au clavier (Espace = gauche, Entrée = droit). La position du pointeur ne
 * désigne rien ; les scènes à pointeur libre seules la lisent (`mouseX`, `mouseY`).
 */
export type Action =
  | "up"
  | "down"
  | "left"
  | "right"
  /** Clic gauche, Espace. */
  | "validate"
  /** Clic droit, Entrée (voix d'aide / annuler). */
  | "cancel"
  /** Échap : passe une vidéo, une attente. */
  | "skip"
  /** P : pause du plateau. */
  | "pause"
  | "volumeUp"
  | "volumeDown";

export const ACTIONS: readonly Action[] = ["up", "down", "left", "right", "validate", "cancel", "skip", "pause", "volumeUp", "volumeDown"];

/**
 * Touche physique (`KeyboardEvent.code`, positions QWERTY comme les scancodes de l'original) → actions.
 * Flèches et Q/A/Z/X = haut/bas/gauche/droite, Espace = clic gauche, Entrée = clic droit,
 * Échap = saut, P = pause, F1/F2 = volume −/+.
 */
const KEY_ACTIONS: Readonly<Record<string, Action>> = {
  ArrowUp: "up",
  KeyQ: "up",
  ArrowDown: "down",
  KeyA: "down",
  ArrowLeft: "left",
  KeyZ: "left",
  ArrowRight: "right",
  KeyX: "right",
  Space: "validate",
  Enter: "cancel",
  NumpadEnter: "cancel",
  Escape: "skip",
  KeyP: "pause",
  F1: "volumeDown",
  F2: "volumeUp",
};

export function actionForKey(code: string): Action | undefined {
  return KEY_ACTIONS[code];
}

/** Boutons de souris du navigateur (`MouseEvent.button`) : 0 = gauche, 2 = droit. */
const BUTTON_ACTIONS: Readonly<Record<number, Action>> = { 0: "validate", 2: "cancel" };

/** Position initiale du pointeur (centre de l'écran). */
const CENTER_X = 0xa0;
const CENTER_Y = 100;

/** Appuis rapides mémorisés au plus par action : au-delà, un clavier qui s'emballe n'accumule pas de retard. */
const MAX_PENDING_PRESSES = 4;

/**
 * État des entrées. L'hôte l'alimente (`keyDown`, `mouseDown`…), le moteur et les scènes le lisent.
 *
 * - `pressed(a)` : l'action est tenue maintenant ;
 * - `justPressed(a)` : l'action a été enfoncée et cet appui n'a pas encore été consommé par une mise à jour de scène.
 *   Les appuis sont comptés : plusieurs appuis rapides pendant un même pas de scène sont rendus un par un aux mises à
 *   jour suivantes (au plus `MAX_PENDING_PRESSES`), aucun n'est perdu ni fusionné. Le moteur appelle `endUpdate()` après
 *   chaque `update`.
 */
export class Input {
  /** Position de la souris en coordonnées 320×200 : sert seulement aux scènes qui dessinent leur curseur HY8 (aucune zone cliquable). */
  mouseX = CENTER_X;
  mouseY = CENTER_Y;
  /**
   * Décalage du pas du curseur au clavier (`DS:3FD0`, lu par `3134:03c8`) : une flèche déplace le curseur de `1 << keyPointerShift`
   * pixels par tick. Valeur initiale 2 (4 px) ; les six mini-jeux à pointeur libre (S24, S25, S26, S35, S41, S51) l'écrivent à 1
   * (2 px) à leur mise en place et rien ne le remet : le puits aux vœux (S13, qui active le même pilote mais ne l'écrit pas) va donc
   * à 4 px par tick tant qu'aucun de ces mini-jeux n'a été joué, puis à 2 px. L'état vit ici car il dure autant que l'hôte, comme
   * la variable dure autant que le processus.
   */
  keyPointerShift = 2;

  private readonly held = new Map<Action, Set<string>>();
  /** Appuis pas encore consommés, par action. */
  private readonly pending = new Map<Action, number>();

  pressed(action: Action): boolean {
    return (this.held.get(action)?.size ?? 0) > 0;
  }

  justPressed(action: Action): boolean {
    return (this.pending.get(action) ?? 0) > 0;
  }

  /** Vrai si l'une des actions vient d'être enfoncée. */
  anyJustPressed(...actions: Action[]): boolean {
    return actions.some((a) => this.justPressed(a));
  }

  /** À appeler après chaque `update` de scène : consomme un appui de chaque action (les suivants attendent leur tour). */
  endUpdate(): void {
    for (const [action, count] of this.pending) {
      if (count > 1) this.pending.set(action, count - 1);
      else this.pending.delete(action);
    }
  }

  /** Oublie tous les appuis pas encore consommés, sans relâcher les touches tenues (changement de scène). */
  discardPresses(): void {
    this.pending.clear();
  }

  /** Relâche tout et oublie les appuis récents (perte du focus). */
  reset(): void {
    this.held.clear();
    this.pending.clear();
  }

  /**
   * `source` identifie l'origine (touche, bouton) : l'action reste tenue tant qu'une source la tient. La répétition
   * automatique du clavier (même source déjà tenue) ne compte pas comme un nouvel appui.
   */
  press(action: Action, source: string): void {
    let sources = this.held.get(action);
    if (!sources) this.held.set(action, (sources = new Set()));
    if (sources.has(source)) return;
    if (sources.size === 0) this.pending.set(action, Math.min(MAX_PENDING_PRESSES, (this.pending.get(action) ?? 0) + 1));
    sources.add(source);
  }

  release(action: Action, source: string): void {
    this.held.get(action)?.delete(source);
  }

  /** Renvoie vrai si la touche est utilisée par le jeu (l'hôte peut alors empêcher son comportement par défaut). */
  keyDown(code: string): boolean {
    const action = actionForKey(code);
    if (!action) return false;
    this.press(action, `key:${code}`);
    return true;
  }

  keyUp(code: string): boolean {
    const action = actionForKey(code);
    if (!action) return false;
    this.release(action, `key:${code}`);
    return true;
  }

  mouseDown(button: number): void {
    const action = BUTTON_ACTIONS[button];
    if (!action) return;
    this.press(action, `mouse:${button}`);
  }

  mouseUp(button: number): void {
    const action = BUTTON_ACTIONS[button];
    if (action) this.release(action, `mouse:${button}`);
  }

  /** Pilote clavier du curseur (`3134:03bb`) : les flèches tenues déplacent la position de la souris de `1 << keyPointerShift` pixels. */
  moveMouseByKeys(): void {
    const step = 1 << this.keyPointerShift;
    const dx = (this.pressed("right") ? step : 0) - (this.pressed("left") ? step : 0);
    const dy = (this.pressed("down") ? step : 0) - (this.pressed("up") ? step : 0);
    if (dx !== 0 || dy !== 0) this.mouseMove(this.mouseX + dx, this.mouseY + dy);
  }

  /** Position absolue du pointeur, en pixels 320×200 (bornée à l'écran). */
  mouseMove(x: number, y: number): void {
    this.mouseX = Math.min(SCREEN_WIDTH - 1, Math.max(0, Math.round(x)));
    this.mouseY = Math.min(SCREEN_HEIGHT - 1, Math.max(0, Math.round(y)));
  }
}
