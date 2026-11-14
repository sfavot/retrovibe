import { type BassAction, type BassInput, MouseButton } from "../engine/host";

/** Écran logique du jeu (`FULL_SCREEN_WIDTH` x `FULL_SCREEN_HEIGHT`). */
export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;

/**
 * Bande du haut de l'écran (en lignes) où un toucher ouvre l'inventaire au lieu de cliquer (`docs/bass/engine.md` § 17) : l'inventaire
 * s'ouvre quand le pointeur est sur les lignes 0 et 1, que le doigt ne peut pas viser seul ; 12 lignes font 6 % de la hauteur.
 */
export const INVENTORY_TAP_LINES = 12;
/** Hauteur de la barre d'inventaire ouverte (cases de y = 0 à 24) : un toucher dedans reste dans la barre. */
export const INVENTORY_BAR_HEIGHT = 25;

/** Bouton du DOM (0 gauche, 2 droit) -> bouton du jeu (`MouseButton`) ; le bouton du milieu et les autres ne servent pas. */
function gameButton(domButton: number): (typeof MouseButton)[keyof typeof MouseButton] | undefined {
  if (domButton === 0) return MouseButton.Left;
  if (domButton === 2) return MouseButton.Right;
  return undefined;
}

/**
 * Ticks (de 20 ms) entre l'arrivée du pointeur sur une zone et le clic qui la vise. Le jeu survole la zone au tour de logique qui lit le
 * déplacement (un tour dure 80 ms par défaut) et n'agit sur le clic que si la zone est déjà survolée : un clic reçu dans le même tour que le
 * déplacement (toucher, souris rapide, clic simulé) tomberait à côté (icône de l'inventaire, bouton de réplique…). Une souris qui survole
 * d'abord, comme un joueur le fait, n'attend rien.
 */
export const SETTLE_TICKS = 6;

interface Queued {
  event: BassInput;
  /** Tick (numéro de `drain`) à partir duquel l'entrée est rendue. */
  due: number;
}

/**
 * File des entrées du moteur (`BassHost.pollInput`) : déplacements, clics (gauche = 2, droit = 1), relâchements et actions du clavier,
 * en coordonnées de l'écran de 320 x 200. Tout passe par cette file (et non par `BassEngine.pointerDown`) parce que le panneau de
 * contrôle, la pause et l'introduction ne lisent que `pollInput`. `onButtons` reçoit les boutons tenus (`Mouse.held`), que `fnLookAt` attend.
 *
 * `drain` est appelé une fois par tick de 20 ms. Un clic qui vise un autre endroit que le dernier pointeur donné au jeu (ou qui le suit de
 * moins de `SETTLE_TICKS`) est retenu : le déplacement part d'abord, le clic ensuite, l'ordre des entrées est toujours gardé. Un déplacement
 * qui en suit un autre sans rien entre les deux le remplace (une souris rapide ne remplit pas la file). En pause, plus rien n'entre, sauf les
 * relâchements (un bouton ne reste jamais enfoncé) ; la reprise repart d'une file vide.
 */
export class InputQueue {
  private queue: Queued[] = [];
  private held = 0;
  private paused = false;
  private tick = 0;
  /** Dernière position donnée au jeu, et le tick de son dernier changement. */
  private at: { x: number; y: number } | null = null;
  private movedAt = Number.NEGATIVE_INFINITY;
  /** Dernier geste au doigt : le curseur de la souris n'est plus dessiné (sauf objet tenu) jusqu'à un clic de souris. */
  touchMode = false;

  constructor(private readonly onButtons: (mask: number) => void = () => {}) {}

  private static clamp(x: number, y: number): { x: number; y: number } {
    return { x: Math.max(0, Math.min(SCREEN_WIDTH - 1, Math.floor(x))), y: Math.max(0, Math.min(SCREEN_HEIGHT - 1, Math.floor(y))) };
  }

  /** Échéance d'une entrée : jamais avant la précédente (l'ordre est gardé). */
  private due(): number {
    return Math.max(this.tick, this.queue[this.queue.length - 1]?.due ?? 0);
  }

  private push(event: BassInput, due = this.due()): void {
    const last = this.queue[this.queue.length - 1];
    if (event.type === "move" && last?.event.type === "move") last.event = event;
    else this.queue.push({ event, due });
  }

  private place(at: { x: number; y: number }): void {
    if (this.at && this.at.x === at.x && this.at.y === at.y) return;
    this.at = at;
    this.movedAt = this.tick;
    this.push({ type: "move", ...at });
  }

  move(x: number, y: number): void {
    if (this.paused) return;
    this.place(InputQueue.clamp(x, y));
  }

  /** Un clic en `at` : le pointeur y va d'abord, le clic attend que le jeu l'ait vu. */
  private click(at: { x: number; y: number }, button: (typeof MouseButton)[keyof typeof MouseButton]): void {
    this.place(at);
    this.push({ type: "click", ...at, button }, Math.max(this.due(), this.movedAt + SETTLE_TICKS));
  }

  /** Bouton de la souris ou du stylet enfoncé (`button` du DOM). */
  down(domButton: number, x: number, y: number): void {
    const button = gameButton(domButton);
    if (button === undefined || this.paused) return;
    this.touchMode = false;
    this.held |= button;
    this.onButtons(this.held);
    this.click(InputQueue.clamp(x, y), button);
  }

  /** Bouton relâché (aussi en pause : sinon `Mouse.held` resterait vrai). */
  up(domButton: number, x: number, y: number): void {
    const button = gameButton(domButton);
    if (button === undefined || !(this.held & button)) return;
    this.held &= ~button;
    this.onButtons(this.held);
    this.push({ type: "release", ...InputQueue.clamp(x, y) });
  }

  /** Plus aucun bouton enfoncé (perte du focus, pause). */
  releaseAll(): void {
    for (const dom of [0, 2]) this.up(dom, 0, 0);
  }

  /** Toucher (0) ou appui long (2) : le pointeur va en (x, y), puis clique ; aucun bouton n'est tenu. */
  tap(button: 0 | 2, x: number, y: number): void {
    const game = gameButton(button);
    if (game === undefined || this.paused) return;
    this.touchMode = true;
    const at = InputQueue.clamp(x, y);
    this.click(at, game);
    this.push({ type: "release", ...at });
  }

  /** Ouvre l'inventaire : le pointeur seulement sur la ligne 0, sans clic (le jeu ouvre la barre au survol). */
  openInventory(x: number): void {
    if (this.paused) return;
    this.touchMode = true;
    this.place(InputQueue.clamp(x, 0));
  }

  /** Action du clavier (touche déjà traduite par `keys.ts`). */
  action(action: BassAction): void {
    if (this.paused) return;
    this.push({ type: "action", action });
  }

  /** En pause : les entrées en attente sont jetées et plus rien n'est accepté ; à la reprise, la file est vide. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    if (paused) this.releaseAll();
    else this.queue = [];
    this.paused = paused;
  }

  /** Les entrées dues à ce tick (un appel par tick de 20 ms). */
  drain(): readonly BassInput[] {
    const out: BassInput[] = [];
    while (this.queue[0] && this.queue[0].due <= this.tick) out.push(this.queue.shift()!.event);
    this.tick++;
    return out;
  }
}

/** Ce que le jeu dit de lui pour interpréter un toucher. */
export interface TapContext {
  /** La barre d'inventaire a été ouverte par un toucher et le pointeur est encore dessus. */
  barOpen: boolean;
  /** Choix de dialogue (`SF_CHOOSING`) : la première ligne est tout en haut, un toucher doit la choisir. */
  choosing: boolean;
  /** Panneau de contrôle ou pause : les boutons du panneau sont des clics ordinaires. */
  frozen: boolean;
  /** Pointeur verrouillé par le jeu (`SF_MOUSE_LOCKED`) : rien à ouvrir. */
  locked: boolean;
}

/**
 * Ce qu'un toucher fait à l'écran (`engine.md` § 17) : `bar` (déplacer le pointeur sur la ligne 0, sans clic) pour un toucher court dans
 * la bande du haut quand la barre est fermée, `click` sinon (toucher dans la barre ouverte, toucher ailleurs qui la referme et agit,
 * appui long = clic droit, choix de dialogue, panneau).
 */
export function tapKind(button: 0 | 2, y: number, context: TapContext): "bar" | "click" {
  if (button !== 0 || y >= INVENTORY_TAP_LINES) return "click";
  return context.barOpen || context.choosing || context.frozen || context.locked ? "click" : "bar";
}
