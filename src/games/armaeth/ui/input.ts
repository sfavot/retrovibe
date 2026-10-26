import type { HostInput, HostKey } from "../engine/host";
import type { HeroKey, NavKey } from "../engine/interface";

/** Écran logique du jeu (VGA mode 13h). */
export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;

/** Ce que `mapKey` lit d'un `KeyboardEvent` (permet de tester sans navigateur). */
export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Touches de déplacement du navigateur -> touches de type 4 du jeu (`docs/armaeth/interface.md` § 7). */
const NAV_KEYS: Readonly<Record<string, NavKey>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Home: "home",
  End: "end",
  PageUp: "pgup",
  PageDown: "pgdn",
  Insert: "insert",
};

/** Touches de commande : caractères du DOS (`\r` Entrée, `\x1b` Échap, `\b` Retour arrière). */
const CONTROL_KEYS: Readonly<Record<string, string>> = {
  Enter: "\r",
  Escape: "\x1b",
  Backspace: "\b",
};

/**
 * Touche du navigateur -> événement clavier du jeu, ou `null` si le jeu ne la prend pas (le navigateur en fait alors ce qu'il veut :
 * Tab pour quitter l'écran, Cmd/Ctrl + lettre, F5/F11/F12...).
 *
 * - caractères : `event.key`, donc les accents et la disposition du clavier de l'utilisatrice ; AltGr (Ctrl + Alt sous Windows) en fait partie ;
 * - Alt + lettre, chiffre, `-` ou `=` : type 3 (cadence), lu par `code` car, sur Mac, Alt change le caractère produit ;
 * - F1 à F10 : type 2, avec Maj / Alt en variante (ignorée par le jeu, comme l'original).
 */
export function mapKey(event: KeyLike): HostKey | null {
  const altGraph = event.ctrlKey && event.altKey;
  if ((event.ctrlKey && !altGraph) || event.metaKey) return null;

  const fn = /^F(\d{1,2})$/.exec(event.code);
  if (fn) {
    const n = Number(fn[1]);
    if (n < 1 || n > 10) return null;
    return { type: "function", n, ...(event.altKey ? { modifier: "alt" as const } : event.shiftKey ? { modifier: "shift" as const } : {}) };
  }

  if (event.altKey && !altGraph) {
    const letter = /^Key([A-Z])$/.exec(event.code);
    if (letter) return { type: "alt", key: letter[1].toLowerCase() };
    const digit = /^Digit(\d)$/.exec(event.code);
    if (digit) return { type: "alt", key: digit[1] };
    if (event.code === "Minus" || event.code === "NumpadSubtract") return { type: "alt", key: "-" };
    if (event.code === "Equal") return { type: "alt", key: "=" };
    return null;
  }

  const nav = NAV_KEYS[event.key];
  if (nav) return { type: "nav", key: nav };
  if (event.key === "Delete") return { type: "delete" };
  const control = CONTROL_KEYS[event.key];
  if (control) return { type: "char", char: control };
  // Un seul point de code (les touches nommées - « Shift », « Dead », « Tab »... - ont un nom plus long) ; Tab reste au navigateur.
  if ([...event.key].length === 1) return { type: "char", char: event.key };
  return null;
}

/**
 * Flèches tenues (option du portage « marcher tant qu'on tient la flèche ») : appui et relâchement des touches de déplacement ->
 * événements `held` du jeu. Plusieurs flèches tenues : la dernière enfoncée mène ; la relâcher rend la main à la précédente.
 */
export class HeldArrows {
  private readonly held: HeroKey[] = [];

  /** Flèche enfoncée (hors répétition automatique). */
  press(key: HeroKey): HostKey {
    this.drop(key);
    this.held.push(key);
    return { type: "nav", key, held: "press" };
  }

  /** Flèche relâchée : reprise de la précédente encore tenue, sinon arrêt ; `null` si la touche n'était pas tenue. */
  release(key: HeroKey): HostKey | null {
    if (!this.drop(key)) return null;
    const previous = this.held[this.held.length - 1];
    return previous ? { type: "nav", key: previous, held: "press" } : { type: "nav", key, held: "release" };
  }

  /** Perte du focus ou option coupée : plus rien n'est tenu ; arrêt de la dernière flèche menante. */
  releaseAll(): HostKey | null {
    const last = this.held[this.held.length - 1];
    this.held.length = 0;
    return last ? { type: "nav", key: last, held: "release" } : null;
  }

  private drop(key: HeroKey): boolean {
    const i = this.held.indexOf(key);
    if (i < 0) return false;
    this.held.splice(i, 1);
    return true;
  }
}

/** Touche de déplacement du héros (flèches et diagonales, sans Inser) lue d'un `KeyboardEvent`, ou `null`. */
export function heroKeyOf(event: { key: string }): HeroKey | null {
  const nav = NAV_KEYS[event.key];
  return nav && nav !== "insert" ? nav : null;
}

/** Bouton du DOM (0 gauche, 2 droit) -> masque de boutons du jeu (1 gauche, 2 droit) ; le bouton du milieu n'existe pas. */
export function buttonMask(domButton: number): number {
  return domButton === 0 ? 1 : domButton === 2 ? 2 : 0;
}

/**
 * File d'entrées de l'hôte : touches en événements, souris en échantillons d'état (position + boutons) que le moteur rejoue un à un.
 * Les déplacements consécutifs sans changement de boutons sont fusionnés : le moteur ne lit qu'une position par tic, inutile d'en empiler
 * des dizaines ; un appui ou un relâchement n'est jamais fusionné (un clic rapide reste visible).
 */
export class InputQueue {
  private queue: HostInput[] = [];
  private x = 0;
  private y = 0;
  private buttons = 0;
  private ctrl = false;
  /** Le dernier échantillon est un simple déplacement : le suivant peut le remplacer. Jamais un appui ni un relâchement. */
  private mergeable = false;

  key(key: HostKey): void {
    this.queue.push({ type: "key", key });
  }

  /** Le pointeur est en (x, y), coordonnées logiques (flottantes ou hors de l'écran : arrondies et ramenées dans l'écran). */
  move(x: number, y: number, ctrl = this.ctrl): void {
    this.x = clamp(Math.floor(x), SCREEN_WIDTH - 1);
    this.y = clamp(Math.floor(y), SCREEN_HEIGHT - 1);
    this.ctrl = ctrl;
    const last = this.queue[this.queue.length - 1];
    if (this.mergeable && last?.type === "pointer" && last.buttons === this.buttons && last.ctrl === ctrl) {
      last.x = this.x;
      last.y = this.y;
    } else {
      this.sample();
      this.mergeable = true;
    }
  }

  /** Bouton du jeu enfoncé (1 ou 2). */
  down(mask: number, x: number, y: number, ctrl = false): void {
    if (mask === 0) return;
    this.moveIfChanged(x, y, ctrl);
    this.buttons |= mask;
    this.sample();
    this.mergeable = false;
  }

  up(mask: number, x: number, y: number, ctrl = false): void {
    if (mask === 0) return;
    this.moveIfChanged(x, y, ctrl);
    this.buttons &= ~mask;
    this.sample();
    this.mergeable = false;
  }

  /** Le pointeur a bougé (ou Ctrl a changé) depuis le dernier échantillon : le jeu voit d'abord la position, puis le bouton. */
  private moveIfChanged(x: number, y: number, ctrl: boolean): void {
    if (Math.floor(x) !== this.x || Math.floor(y) !== this.y || ctrl !== this.ctrl || this.queue.length === 0) this.move(x, y, ctrl);
  }

  /** Clic complet d'un doigt (appui puis relâchement au même endroit). */
  tap(mask: number, ctrl = false): void {
    this.down(mask, this.x, this.y, ctrl);
    this.up(mask, this.x, this.y, ctrl);
  }

  /** Perte du focus : plus aucun bouton n'est tenu. */
  releaseAll(): void {
    if (this.buttons === 0) return;
    this.buttons = 0;
    this.sample();
    this.mergeable = false;
  }

  /** Les événements reçus depuis le dernier appel ; la file est vidée. */
  drain(): HostInput[] {
    const out = this.queue;
    this.queue = [];
    this.mergeable = false;
    return out;
  }

  private sample(): void {
    this.queue.push({ type: "pointer", x: this.x, y: this.y, buttons: this.buttons, ctrl: this.ctrl });
  }
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}
