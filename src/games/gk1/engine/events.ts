/**
 * Entrées du jeu : file des évènements SCI (souris, clavier), position du pointeur dans le repère des scripts et traduction
 * des touches du navigateur en codes SCI (`docs/gk1/plan.md`, vague E et D7).
 *
 * Références : `engines/sci/event.cpp` (`EventManager::getSciEvent`, `getScummVMEvent`, `altify`) et `event.h`
 * (`SciEventType`, `SciKeyCode`, `SciKeyModifiers`) de ScummVM, GPL v3 ou ultérieure, lus puis réécrits.
 *
 * - **File** : l'hôte y pousse appuis et relâchements ; `next(masque)` rend le premier évènement dont le type est dans le
 *   masque et le retire (il reste en file si le masque porte `Peek`). Sans évènement, il rend l'évènement nul, qui porte
 *   quand même la position courante du pointeur et les modificateurs du clavier. Un évènement en file garde la position
 *   qu'avait le pointeur à sa création.
 * - **Souris** : le déplacement ne crée pas d'évènement, il ne fait que déplacer le pointeur. Le bouton droit est un appui
 *   avec les deux « Maj » (`Shift`), le bouton du milieu un appui avec `Ctrl` : c'est ainsi que les scripts les
 *   reconnaissent (bouton droit : curseur suivant, D7). L'appui long du doigt est traduit en bouton droit par l'hôte.
 * - **Position** : en pixels de l'écran des scripts (320×200), bornée à l'écran puis à la zone où `SetCursor` enferme le
 *   curseur ; `GlobalToLocal` la ramène à un plan.
 * - **Clavier** : caractère ASCII, ou code étendu « code de touche × 256 » du PC (flèches, F1 à F10). `Ctrl` + lettre donne
 *   1 à 26, `Alt` + lettre le code étendu de la touche. Les lettres accentuées sont rendues en CP850, le jeu de caractères
 *   des polices du CD.
 *
 * Écarts volontaires : l'interface de l'hôte est celle de `PointClickHost.input` (`move`, `down`, `up`, `releaseAll`), boutons
 * numérotés comme dans le DOM ; pas de pavé numérique distinct ni de verrouillage (`NumLock`) ; pas de rectangles sensibles
 * (`HotRectangle`, propres à Phantasmagoria) ni d'évènement « quitter » ; la file est bornée (un onglet laissé en pause ne
 * l'allonge pas sans fin).
 */
import { frameoutOf } from "../render/frameout";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../render/ids";
import { seqPlayerOf } from "../render/seq-player";
import type { Vm } from "./vm";

/** Types d'évènements (`type` de l'objet `Event`) ; `Peek` est un bit du masque de `GetEvent`. */
export const EventType = {
  None: 0,
  MousePress: 1,
  MouseRelease: 2,
  KeyDown: 4,
  KeyUp: 8,
  /** Direction (SCI32) : écrit par `MapKeyToDir`. */
  Direction: 0x10,
  Peek: 0x8000,
} as const;

/** Modificateurs (`modifiers`). */
export const KeyModifier = { None: 0, RightShift: 1, LeftShift: 2, Shift: 3, Ctrl: 4, Alt: 8 } as const;
/** Les seuls modificateurs que SCI32 transmet aux scripts. */
export const MODIFIER_MASK = KeyModifier.Shift | KeyModifier.Ctrl | KeyModifier.Alt;

/** Boutons de la souris, numérotés comme dans le DOM. */
export const MouseButton = { Left: 0, Middle: 1, Right: 2 } as const;

/** Codes des touches (`message` d'un évènement clavier). */
export const SciKey = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Escape: 27,
  ShiftTab: 15 << 8,
  F1: 59 << 8,
  Home: 71 << 8,
  Up: 72 << 8,
  PageUp: 73 << 8,
  Left: 75 << 8,
  Center: 76 << 8,
  Right: 77 << 8,
  End: 79 << 8,
  Down: 80 << 8,
  PageDown: 81 << 8,
  Insert: 82 << 8,
  Delete: 83 << 8,
  ShiftF1: 84 << 8,
} as const;

/** Directions de `MapKeyToDir` : 0 au centre, puis 1 (haut) à 8 (haut gauche) dans le sens des aiguilles d'une montre. */
export const KEY_DIRECTIONS: ReadonlyMap<number, number> = new Map([
  [SciKey.Home, 8],
  [SciKey.Up, 1],
  [SciKey.PageUp, 2],
  [SciKey.Left, 7],
  [SciKey.Center, 0],
  [SciKey.Right, 3],
  [SciKey.End, 6],
  [SciKey.Down, 5],
  [SciKey.PageDown, 4],
]);

export interface SciEvent {
  type: number;
  message: number;
  modifiers: number;
  x: number;
  y: number;
}

/** Évènements gardés en file ; au-delà, les plus anciens sont perdus. */
const MAX_QUEUED = 64;
const FUNCTION_KEYS = 10;
const SCANCODE_SHIFT = 8;
/** Rangées du clavier PC et code de leur première touche : `Alt` + lettre donne ce code, décalé de 8 bits. */
const SCANCODE_ROWS: readonly (readonly [number, string])[] = [
  [0x10, "QWERTYUIOP[]"],
  [0x1e, "ASDFGHJKL;'\\"],
  [0x2c, "ZXCVBNM,./"],
];
const NAMED_KEYS: Readonly<Record<string, number>> = {
  Enter: SciKey.Enter,
  Escape: SciKey.Escape,
  Backspace: SciKey.Backspace,
  ArrowUp: SciKey.Up,
  ArrowDown: SciKey.Down,
  ArrowLeft: SciKey.Left,
  ArrowRight: SciKey.Right,
  Home: SciKey.Home,
  End: SciKey.End,
  PageUp: SciKey.PageUp,
  PageDown: SciKey.PageDown,
  Insert: SciKey.Insert,
  Delete: SciKey.Delete,
  Clear: SciKey.Center,
};
/** Lettres accentuées et signes du français dans la page de code 850. */
const CP850: Readonly<Record<string, number>> = {
  Ç: 0x80,
  ü: 0x81,
  é: 0x82,
  â: 0x83,
  ä: 0x84,
  à: 0x85,
  ç: 0x87,
  ê: 0x88,
  ë: 0x89,
  è: 0x8a,
  ï: 0x8b,
  î: 0x8c,
  É: 0x90,
  ô: 0x93,
  ö: 0x94,
  û: 0x96,
  ù: 0x97,
  "«": 0xae,
  "»": 0xaf,
};
const ASCII_LAST = 0x7e;
const CTRL_LETTER_OFFSET = 0x60;

/** Ce que le traducteur lit d'un `KeyboardEvent`. */
export interface KeyInput {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}

/** Modificateurs SCI d'un évènement du navigateur (clavier ou pointeur). */
export function modifiersOf(input: { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean }): number {
  return (input.shiftKey ? KeyModifier.Shift : 0) | (input.ctrlKey ? KeyModifier.Ctrl : 0) | (input.altKey ? KeyModifier.Alt : 0);
}

function altCode(character: number): number {
  const letter = String.fromCharCode(character).toUpperCase();
  for (const [first, row] of SCANCODE_ROWS) {
    const index = row.indexOf(letter);
    if (index >= 0) return (first + index) << SCANCODE_SHIFT;
  }
  return character;
}

/** Code SCI de la touche d'un `KeyboardEvent`, ou 0 si elle n'en a pas (touche morte, modificateur seul, F11…). */
export function sciKeyOf(input: KeyInput): number {
  const { key } = input;
  if (key === "Tab") return input.shiftKey ? SciKey.ShiftTab : SciKey.Tab;
  const named = NAMED_KEYS[key];
  if (named !== undefined) return named;
  const functionKey = /^F(\d+)$/.exec(key);
  if (functionKey) {
    const index = Number(functionKey[1]) - 1;
    if (index >= FUNCTION_KEYS) return 0;
    return (input.shiftKey ? SciKey.ShiftF1 : SciKey.F1) + (index << SCANCODE_SHIFT);
  }
  if (key.length !== 1) return 0;
  let character = CP850[key] ?? key.charCodeAt(0);
  if (CP850[key] === undefined && (character < 0x20 || character > ASCII_LAST)) return 0;
  if (input.altKey) return altCode(character);
  const lower = character | 0x20;
  if (input.ctrlKey && lower >= 0x61 && lower <= 0x7a) character = lower - CTRL_LETTER_OFFSET;
  return character;
}

/** Le pointeur du jeu : sa position, et de quoi la changer en respectant la zone où `SetCursor` l'enferme. */
export interface Pointer {
  readonly x: number;
  readonly y: number;
  deviceMoved(x: number, y: number): unknown;
}

/** Pointeur libre dans tout l'écran, quand il n'y a pas de curseur du jeu. */
class FreePointer implements Pointer {
  x = 0;
  y = 0;

  deviceMoved(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }
}

/** File des évènements d'une machine virtuelle, et état du pointeur. */
export class EventQueue {
  /** Modificateurs du clavier tenus en ce moment. */
  modifiers = 0;
  /**
   * Interception : appelée pour un appui de souris ou la touche Échap avant leur mise en file ; si elle rend vrai,
   * l'évènement est consommé (une cinématique en cours s'interrompt ainsi, sans que le jeu voie le clic).
   */
  intercept: (() => boolean) | undefined;
  private readonly queue: SciEvent[] = [];
  private readonly held = new Set<number>();
  /** Boutons dont l'appui a été intercepté : leur relâchement l'est aussi. */
  private readonly swallowed = new Set<number>();
  /** Lectures par `GetEvent` depuis le dernier `FrameOut` (`kernel/events.ts` : au-delà de deux, le jeu rend la main). */
  private polls = 0;

  constructor(private readonly pointer: Pointer = new FreePointer()) {}

  /** Position du pointeur dans l'écran des scripts. */
  get x(): number {
    return this.pointer.x;
  }

  get y(): number {
    return this.pointer.y;
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Le pointeur est en (x, y) : coordonnées de l'écran du jeu, éventuellement fractionnaires ou hors de l'écran. */
  move(x: number, y: number): void {
    this.pointer.deviceMoved(Math.min(Math.max(Math.floor(x), 0), SCREEN_WIDTH - 1), Math.min(Math.max(Math.floor(y), 0), SCREEN_HEIGHT - 1));
  }

  /** Bouton enfoncé en (x, y). */
  down(button: number, x: number, y: number): void {
    this.move(x, y);
    if (this.intercept?.()) {
      this.swallowed.add(button);
      return;
    }
    this.held.add(button);
    this.push(EventType.MousePress, 0, this.modifiers | buttonModifiers(button));
  }

  /** Bouton relâché en (x, y). */
  up(button: number, x: number, y: number): void {
    this.move(x, y);
    if (this.swallowed.delete(button)) return;
    this.held.delete(button);
    this.push(EventType.MouseRelease, 0, this.modifiers | buttonModifiers(button));
  }

  /** Relâche tout ce qui est tenu (perte du focus, pause) : un script qui suit un glisser ne reste pas bloqué. */
  releaseAll(): void {
    for (const button of [...this.held]) this.up(button, this.x, this.y);
    this.modifiers = 0;
  }

  /** Touche enfoncée : `key` est un code SCI (`sciKeyOf`). */
  keyDown(key: number, modifiers = this.modifiers): void {
    this.modifiers = modifiers & MODIFIER_MASK;
    if (key === SciKey.Escape && this.intercept?.()) return;
    if (key !== 0) this.push(EventType.KeyDown, key, this.modifiers);
  }

  /** Touche relâchée. */
  keyUp(key: number, modifiers = this.modifiers): void {
    this.modifiers = modifiers & MODIFIER_MASK;
    if (key !== 0) this.push(EventType.KeyUp, key, this.modifiers);
  }

  /** Premier évènement de la file dont le type est dans `mask`, sinon l'évènement nul à la position du pointeur. */
  next(mask: number): SciEvent {
    const index = this.queue.findIndex((event) => (event.type & mask) !== 0);
    if (index < 0) return { type: EventType.None, message: 0, modifiers: this.modifiers, x: this.x, y: this.y };
    const event = this.queue[index];
    if ((mask & EventType.Peek) === 0) this.queue.splice(index, 1);
    return event;
  }

  /** Compte une lecture de la file par les scripts ; rend le nombre de lectures depuis le dernier `FrameOut`. */
  countPoll(): number {
    return ++this.polls;
  }

  /** Une image vient d'être composée : le compte des lectures repart de zéro. */
  frameShown(): void {
    this.polls = 0;
  }

  clear(): void {
    this.polls = 0;
    this.queue.length = 0;
    this.held.clear();
    this.swallowed.clear();
  }

  private push(type: number, message: number, modifiers: number): void {
    if (this.queue.length >= MAX_QUEUED) this.queue.shift();
    this.queue.push({ type, message, modifiers: modifiers & MODIFIER_MASK, x: this.x, y: this.y });
  }
}

function buttonModifiers(button: number): number {
  if (button === MouseButton.Right) return KeyModifier.Shift;
  if (button === MouseButton.Middle) return KeyModifier.Ctrl;
  return KeyModifier.None;
}

const instances = new WeakMap<Vm, EventQueue>();

/**
 * File des évènements de cette machine virtuelle, créée au premier appel. Son pointeur est le curseur du compositeur
 * (`render/cursor.ts`) ; un appui ou Échap pendant une cinématique l'interrompt (`render/seq-player.ts`).
 */
export function eventsOf(vm: Vm): EventQueue {
  let events = instances.get(vm);
  if (!events) {
    instances.set(vm, (events = new EventQueue(frameoutOf(vm).cursor)));
    events.intercept = () => seqPlayerOf(vm).skip();
  }
  return events;
}
