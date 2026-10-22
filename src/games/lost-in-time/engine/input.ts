import { MOUSE_NONE, type InputState } from "./host";

/**
 * Entrées du jeu : codes de touches du moteur (Util::translateKey) et état de la souris
 * alimentés par les événements du navigateur.
 */

export const KEY_BACKSPACE = 0x0e08;
export const KEY_SPACE = 0x3920;
export const KEY_RETURN = 0x1c0d;
export const KEY_ESCAPE = 0x011b;
export const KEY_DELETE = 0x5300;
export const KEY_UP = 0x4800;
export const KEY_DOWN = 0x5000;
export const KEY_RIGHT = 0x4d00;
export const KEY_LEFT = 0x4b00;
export const KEY_F1 = 0x3b00;
export const KEY_F10 = 0x4400;

/** Touches de fonction F1..F10 (F5 vaut Échap comme dans ScummVM). */
const FUNCTION_KEYS = [0x3b00, 0x3c00, 0x3d00, 0x3e00, KEY_ESCAPE, 0x4000, 0x4100, 0x4200, 0x4300, 0x4400];

const SPECIAL_KEYS: Record<string, number> = {
  Backspace: KEY_BACKSPACE,
  Space: KEY_SPACE,
  Enter: KEY_RETURN,
  NumpadEnter: KEY_RETURN,
  Escape: KEY_ESCAPE,
  Delete: KEY_DELETE,
  ArrowUp: KEY_UP,
  ArrowDown: KEY_DOWN,
  ArrowRight: KEY_RIGHT,
  ArrowLeft: KEY_LEFT,
};

/** Latin-1 160..255 vers CP850 (kLatin1ToCP850). */
const LATIN1_TO_CP850 = [
  0xff, 0xad, 0xbd, 0x9c, 0xcf, 0xbe, 0xdd, 0xf5, 0xf9, 0xb8, 0xa6, 0xae, 0xaa, 0xf0, 0xa9, 0xee,
  0xf8, 0xf1, 0xfd, 0xfc, 0xef, 0xe6, 0xf4, 0xfa, 0xf7, 0xfb, 0xa7, 0xaf, 0xac, 0xab, 0xf3, 0xa8,
  0xb7, 0xb5, 0xb6, 0xc7, 0x8e, 0x8f, 0x92, 0x80, 0xd4, 0x90, 0xd2, 0xd3, 0xde, 0xd6, 0xd7, 0xd8,
  0xd1, 0xa5, 0xe3, 0xe0, 0xe2, 0xe5, 0x99, 0x9e, 0x9d, 0xeb, 0xe9, 0xea, 0x9a, 0xed, 0xe8, 0xe1,
  0x85, 0xa0, 0x83, 0xc6, 0x84, 0x86, 0x91, 0x87, 0x8a, 0x82, 0x88, 0x89, 0x8d, 0xa1, 0x8c, 0x8b,
  0xd0, 0xa4, 0x95, 0xa2, 0x93, 0xe4, 0x94, 0xf6, 0x9b, 0x97, 0xa3, 0x96, 0x81, 0xec, 0xe7, 0x98,
];

export function toCP850(latin1: number): number {
  if (latin1 < 0xa0 || latin1 - 0xa0 >= LATIN1_TO_CP850.length) return 0;
  return LATIN1_TO_CP850[latin1 - 0xa0];
}

/** Ce qu'on lit d'un KeyboardEvent. */
export interface KeyEventLike {
  code: string;
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/** Util::translateKey : code du jeu pour une touche, 0 si elle n'en a pas. */
export function translateKey(e: KeyEventLike): number {
  if (e.ctrlKey || e.metaKey || e.altKey) return 0;
  const special = SPECIAL_KEYS[e.code];
  if (special !== undefined) return special;
  const fn = /^F(\d+)$/.exec(e.code);
  if (fn) {
    const n = Number(fn[1]);
    return n >= 1 && n <= 10 ? FUNCTION_KEYS[n - 1] : 0;
  }
  if (e.key.length !== 1) return 0;
  const c = e.key.charCodeAt(0);
  if (c >= 32 && c <= 127) return c;
  if (c >= 160 && c <= 255) return toCP850(c);
  return 0;
}

const KEY_BUFFER_SIZE = 16;

/**
 * Entrées pour le navigateur : un appui trop bref pour être vu par le moteur reste enregistré
 * jusqu'à ce qu'il l'ait lu une fois (le relâchement est alors appliqué).
 */
export class GameInput implements InputState {
  mouseX = 152;
  mouseY = 92;
  private buttons = MOUSE_NONE;
  private pendingRelease = 0;
  private seen = false;
  private readonly keys: number[] = [];

  /** Lire les boutons compte comme les avoir « vus » : un relâchement en attente est appliqué ensuite. */
  get mouseButtons(): number {
    const value = this.buttons;
    if (this.pendingRelease !== 0) {
      this.buttons &= ~this.pendingRelease;
      this.pendingRelease = 0;
    }
    this.seen = true;
    return value;
  }

  set mouseButtons(value: number) {
    this.buttons = value;
    this.pendingRelease = 0;
  }

  /** `button` : 0 gauche, 2 droit (MouseEvent.button). */
  pointerDown(button: number): void {
    const bit = button === 2 ? 2 : button === 0 ? 1 : 0;
    this.buttons |= bit;
    this.seen = false;
  }

  pointerUp(button: number): void {
    const bit = button === 2 ? 2 : button === 0 ? 1 : 0;
    if (this.seen) this.buttons &= ~bit;
    else this.pendingRelease |= bit;
  }

  /** `width` / `height` : taille de l'écran du jeu (640x400 pour l'écran-titre). */
  pointerMove(x: number, y: number, width = 320, height = 200): void {
    this.mouseX = Math.max(0, Math.min(width - 1, Math.trunc(x)));
    this.mouseY = Math.max(0, Math.min(height - 1, Math.trunc(y)));
  }

  keyDown(e: KeyEventLike): boolean {
    const key = translateKey(e);
    if (key === 0 || this.keys.length >= KEY_BUFFER_SIZE) return false;
    this.keys.push(key);
    return true;
  }

  popKey(): number {
    return this.keys.shift() ?? 0;
  }

  clearKeys(): void {
    this.keys.length = 0;
  }

  setMousePos(x: number, y: number): void {
    this.mouseX = x;
    this.mouseY = y;
  }
}
