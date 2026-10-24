/**
 * Entrées de bas niveau, alimentées par l'hôte (événements DOM dans le navigateur, appels directs dans les tests) et lues
 * par le moteur à chaque tick. Aucune logique de gadget ici (zones cliquables, cliquer-poser / glisser, pièce portée :
 * tâche G1, construite par-dessus).
 *
 * Modèle (engine.md §5) : l'original reçoit des messages Windows (`WM_LBUTTONDOWN`…, `WM_KEYDOWN`, `WM_CHAR`) et **interroge**
 * la position de la souris. Ici :
 *  - la position est vivante (`mouseX`, `mouseY`, coordonnées de la zone de jeu 576×432, éventuellement en dehors) ;
 *  - les boutons et les touches sont des **files d'événements** : tout ce qui arrive entre deux ticks est mémorisé dans l'ordre
 *    et remis à la scène au tick suivant (`beginTick`), donc un clic plus court qu'une image n'est jamais perdu ;
 *  - les états « tenu » (bouton, Ctrl, Espace…) sont lisibles à tout moment.
 */

export type MouseButton = "left" | "right" | "middle";

export const MOUSE_BUTTONS: readonly MouseButton[] = ["left", "right", "middle"];

/** Convertit `MouseEvent.button` (0 gauche, 1 milieu, 2 droit) ; `undefined` pour les boutons supplémentaires. */
export function mouseButtonFromDom(button: number): MouseButton | undefined {
  return button === 0 ? "left" : button === 1 ? "middle" : button === 2 ? "right" : undefined;
}

export interface Modifiers {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

/** Événement bouton, avec la position du pointeur au moment où il s'est produit. */
export interface ButtonEvent extends Modifiers {
  button: MouseButton;
  /** Vrai à l'appui, faux au relâchement. */
  down: boolean;
  x: number;
  y: number;
}

/** Touche enfoncée (`KeyboardEvent.key` / `.code`). `repeat` : répétition automatique du clavier. */
export interface KeyEvent extends Modifiers {
  key: string;
  code: string;
  repeat: boolean;
}

/** Touches qui ne produisent rien seules (modificateurs et verrous) : appuyées seules, elles ne comptent pas comme « une touche ». */
const MODIFIER_ONLY_KEYS: ReadonlySet<string> = new Set([
  "Shift",
  "Control",
  "Alt",
  "AltGraph",
  "Meta",
  "OS",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "Fn",
  "FnLock",
  "Hyper",
  "Super",
  "Symbol",
  "SymbolLock",
]);

export function isModifierOnlyKey(key: string): boolean {
  return MODIFIER_ONLY_KEYS.has(key);
}

/** Au plus autant d'événements en attente par file : un clavier ou une souris qui s'emballent n'accumulent pas de retard. */
const MAX_QUEUED_EVENTS = 64;

export class Input {
  /** Position du pointeur dans la zone de jeu (576×432), arrondie ; peut sortir de la zone (négatif ou au-delà). */
  mouseX = 0;
  mouseY = 0;
  /** Le pointeur survole la zone de jeu (l'hôte le tient à jour). */
  pointerInside = false;

  private readonly down = new Set<MouseButton>();
  private readonly held = new Set<string>();
  private mods: Modifiers = { ctrl: false, shift: false, alt: false };

  private buttonQueue: ButtonEvent[] = [];
  private keyQueue: KeyEvent[] = [];
  private currentButtons: readonly ButtonEvent[] = [];
  private currentKeys: readonly KeyEvent[] = [];

  // --- Alimentation par l'hôte ---

  moveMouse(x: number, y: number): void {
    this.mouseX = Math.round(x);
    this.mouseY = Math.round(y);
  }

  setPointerInside(inside: boolean): void {
    this.pointerInside = inside;
  }

  mouseDown(button: MouseButton, mods?: Partial<Modifiers>): void {
    this.setModifiers(mods);
    this.down.add(button);
    this.push(this.buttonQueue, { button, down: true, x: this.mouseX, y: this.mouseY, ...this.mods });
  }

  mouseUp(button: MouseButton, mods?: Partial<Modifiers>): void {
    this.setModifiers(mods);
    this.down.delete(button);
    this.push(this.buttonQueue, { button, down: false, x: this.mouseX, y: this.mouseY, ...this.mods });
  }

  keyDown(event: Partial<KeyEvent> & Pick<KeyEvent, "code">): void {
    const full: KeyEvent = { key: event.key ?? event.code, code: event.code, repeat: event.repeat ?? false, ctrl: false, shift: false, alt: false };
    this.setModifiers(event);
    Object.assign(full, this.mods);
    this.held.add(event.code);
    this.push(this.keyQueue, full);
  }

  keyUp(code: string, mods?: Partial<Modifiers>): void {
    this.setModifiers(mods);
    this.held.delete(code);
  }

  /** Perte du focus : relâche tout (sans événement) et oublie les événements en attente. */
  reset(): void {
    this.down.clear();
    this.held.clear();
    this.mods = { ctrl: false, shift: false, alt: false };
    this.buttonQueue = [];
    this.keyQueue = [];
    this.currentButtons = [];
    this.currentKeys = [];
  }

  // --- Lecture par le moteur et les scènes ---

  /** Bouton tenu maintenant (état vivant, y compris relâché pendant ce tick). */
  isButtonDown(button: MouseButton): boolean {
    return this.down.has(button);
  }

  /** Touche physique (`KeyboardEvent.code`) tenue maintenant. */
  isHeld(code: string): boolean {
    return this.held.has(code);
  }

  get ctrl(): boolean {
    return this.mods.ctrl;
  }

  get shift(): boolean {
    return this.mods.shift;
  }

  get alt(): boolean {
    return this.mods.alt;
  }

  /** Espace tenue (cliquer-poser au clavier, rotation). */
  get space(): boolean {
    return this.held.has("Space");
  }

  /**
   * Moteur : à appeler une fois au début de chaque tick. Fait passer les événements reçus depuis le tick précédent dans
   * `buttonEvents` / `keyEvents` (les remplace : ceux du tick précédent sont oubliés).
   */
  beginTick(): void {
    this.currentButtons = this.buttonQueue;
    this.currentKeys = this.keyQueue;
    this.buttonQueue = [];
    this.keyQueue = [];
  }

  /** Événements bouton remis à ce tick, dans l'ordre d'arrivée. */
  get buttonEvents(): readonly ButtonEvent[] {
    return this.currentButtons;
  }

  /** Touches remises à ce tick, dans l'ordre d'arrivée. */
  get keyEvents(): readonly KeyEvent[] {
    return this.currentKeys;
  }

  /** Au moins un appui de ce bouton a eu lieu depuis le tick précédent (même s'il est déjà relâché). */
  justPressed(button: MouseButton): boolean {
    return this.currentButtons.some((e) => e.button === button && e.down);
  }

  /** Au moins un relâchement de ce bouton depuis le tick précédent. */
  justReleased(button: MouseButton): boolean {
    return this.currentButtons.some((e) => e.button === button && !e.down);
  }

  /** Oublie les événements en attente et ceux du tick courant (changement de scène qui ne doit pas hériter des clics). */
  flush(): void {
    this.buttonQueue = [];
    this.keyQueue = [];
    this.currentButtons = [];
    this.currentKeys = [];
  }

  private setModifiers(mods: Partial<Modifiers> | undefined): void {
    if (!mods) return;
    this.mods = { ctrl: mods.ctrl ?? this.mods.ctrl, shift: mods.shift ?? this.mods.shift, alt: mods.alt ?? this.mods.alt };
  }

  private push<T>(queue: T[], event: T): void {
    if (queue.length < MAX_QUEUED_EVENTS) queue.push(event);
  }
}
