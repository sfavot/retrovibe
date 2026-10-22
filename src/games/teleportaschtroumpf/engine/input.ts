import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../data/mcg";

/**
 * Actions abstraites du jeu (engine.md §4 et §9.6). Clavier et souris sont deux sources de ces mêmes actions :
 * l'original émule les boutons de la souris au clavier (Espace = gauche, Entrée = droit).
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

/** Position de repos du curseur virtuel de la navigation par les bords (`14b3:0039`). */
const CENTER_X = 0xa0;
const CENTER_Y = 100;

/**
 * État des entrées. L'hôte l'alimente (`keyDown`, `mouseDown`…), le moteur et les scènes le lisent.
 *
 * - `pressed(a)` : l'action est tenue maintenant ;
 * - `justPressed(a)` : l'action a été enfoncée depuis la dernière mise à jour de scène (mémorisée jusque-là, donc
 *   un appui plus court que le pas de la scène n'est pas perdu). Le moteur appelle `endUpdate()` après chaque `update`.
 */
export class Input {
  /** Position de la souris en coordonnées 320×200 (pour un survol facultatif). */
  mouseX = CENTER_X;
  mouseY = CENTER_Y;
  /** Navigation par les bords (§4.1) : si vrai, `pushMouse` lève up/down/left/right quand le curseur virtuel touche un bord. */
  edgeNavigation = false;

  private readonly held = new Map<Action, Set<string>>();
  private readonly latched = new Set<Action>();
  private virtualX = CENTER_X;
  private virtualY = CENTER_Y;

  pressed(action: Action): boolean {
    return (this.held.get(action)?.size ?? 0) > 0;
  }

  justPressed(action: Action): boolean {
    return this.latched.has(action);
  }

  /** Vrai si l'une des actions vient d'être enfoncée. */
  anyJustPressed(...actions: Action[]): boolean {
    return actions.some((a) => this.latched.has(a));
  }

  /** À appeler après chaque `update` de scène : oublie les appuis « récents ». */
  endUpdate(): void {
    this.latched.clear();
  }

  /** Relâche tout et oublie les appuis récents (changement de scène, perte du focus). */
  reset(): void {
    this.held.clear();
    this.latched.clear();
  }

  /** `source` identifie l'origine (touche, bouton) : l'action reste tenue tant qu'une source la tient. */
  press(action: Action, source: string): void {
    let sources = this.held.get(action);
    if (!sources) this.held.set(action, (sources = new Set()));
    if (sources.size === 0 || !sources.has(source)) {
      if (sources.size === 0) this.latched.add(action);
      sources.add(source);
    }
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
    if (action) this.press(action, `mouse:${button}`);
  }

  mouseUp(button: number): void {
    const action = BUTTON_ACTIONS[button];
    if (action) this.release(action, `mouse:${button}`);
  }

  /** Position absolue du pointeur, en pixels 320×200 (bornée à l'écran). */
  mouseMove(x: number, y: number): void {
    this.mouseX = Math.min(SCREEN_WIDTH - 1, Math.max(0, Math.round(x)));
    this.mouseY = Math.min(SCREEN_HEIGHT - 1, Math.max(0, Math.round(y)));
  }

  /**
   * Déplacement relatif (en pixels, comme les mickeys de l'original : 1 mickey = 1 pixel). Sans effet si
   * `edgeNavigation` est faux. Un curseur virtuel borné à l'écran accumule les déplacements ; au contact d'un bord
   * (x < 2 → gauche, x ≥ 319 → droite, sinon y < 2 → haut, y ≥ 199 → bas) l'action correspondante est levée
   * pour un appui bref et le curseur retourne au centre (`14b3:004c`).
   */
  pushMouse(dx: number, dy: number): void {
    if (!this.edgeNavigation) return;
    this.virtualX = Math.min(SCREEN_WIDTH - 1, Math.max(0, this.virtualX + dx));
    this.virtualY = Math.min(SCREEN_HEIGHT - 1, Math.max(0, this.virtualY + dy));
    let edge: Action | null = null;
    if (this.virtualX < 2) edge = "left";
    else if (this.virtualX >= 0x13f) edge = "right";
    else if (this.virtualY < 2) edge = "up";
    else if (this.virtualY >= 199) edge = "down";
    if (edge) {
      this.virtualX = CENTER_X;
      this.virtualY = CENTER_Y;
      this.latched.add(edge);
    }
  }
}
