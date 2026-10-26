import { HeldInput, type PadGetter } from "../../../ui/held-input";
import { PAD_SCAN, PAD_SCAN_BUTTONS, scanOfCode, scanOfMouseButton } from "../screens/controllers";
import { NO_INPUT, type UiInput, type UiKey } from "../screens/flow";
import { firstStandardPad } from "./controls";

/** Touches du clavier -> touches de l'interface (par position physique, donc identiques en QWERTY et en AZERTY). */
const KEY_CODES: Readonly<Record<string, UiKey>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "enter",
  NumpadEnter: "enter",
  Escape: "escape",
  F1: "escape",
  Backspace: "backspace",
};

const MODIFIERS = new Set(["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight", "CapsLock"]);

type PadAction = "up" | "down" | "left" | "right" | "enter" | "escape";

/** Manette standard : croix et stick gauche pour naviguer, A / Start valident, B annule. */
const PAD = new HeldInput<PadAction>(
  {
    up: { buttons: [12] },
    down: { buttons: [13] },
    left: { buttons: [14] },
    right: { buttons: [15] },
    enter: { buttons: [0, 9] },
    escape: { buttons: [1] },
  },
  [
    { axis: 1, dir: -1, action: "up" },
    { axis: 1, dir: 1, action: "down" },
    { axis: 0, dir: -1, action: "left" },
    { axis: 0, dir: 1, action: "right" },
  ],
);
const PAD_ACTIONS: readonly PadAction[] = ["up", "down", "left", "right", "enter", "escape"];

const empty = (): UiInput => ({ ...NO_INPUT, keys: [], typed: [], taps: [], scans: [] });

/** Rassemble les entrées des menus (clavier, manette, appuis) entre deux images. */
export class UiInputCollector {
  private input: UiInput = empty();
  /** Boutons 1 à 8 de la manette tenus à l'image précédente (fronts montants pour la capture d'une touche). */
  private padButtons: boolean[] = [];

  /** Touche enfoncée (répétition automatique comprise) ; vrai si l'interface la prend (le navigateur n'en fait alors rien). */
  keyDown(event: { code: string; key: string; repeat?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
    if (event.metaKey) return false;
    // Code de balayage de l'original (capture d'une touche), modificateurs compris : Ctrl et Maj se lient aussi.
    const scan = scanOfCode(event.code);
    if (scan !== undefined && !event.repeat) this.input.scans.push(scan);
    if (MODIFIERS.has(event.code)) return scan !== undefined && this.capturing;
    const key = KEY_CODES[event.code];
    this.input.pressed = true;
    if (key) {
      this.input.keys.push(key);
      this.input.typed.push(key);
      return true;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.altKey) {
      this.input.typed.push({ char: event.key });
      return true;
    }
    return false;
  }

  /** Le menu attend une touche à lier (`gm_menu_capture_key`) : les modificateurs sont alors pris par l'interface. */
  capturing = false;

  /** Appui de souris (`button` : `MouseEvent.button`) ou de doigt, repère 320×400. */
  tap(x: number, y: number, button = 0): void {
    this.input.taps.push({ x, y });
    const scan = scanOfMouseButton(button);
    if (scan !== undefined) this.input.scans.push(scan);
    this.input.pressed = true;
  }

  /** Une fois par image : fronts montants de la manette. */
  pollGamepad(getPads?: PadGetter): void {
    const pad = firstStandardPad(getPads);
    const buttons = Array.from({ length: PAD_SCAN_BUTTONS }, (_, i) => pad?.buttons[i]?.pressed === true);
    buttons.forEach((held, i) => {
      if (held && !this.padButtons[i]) this.input.scans.push(PAD_SCAN + i);
    });
    this.padButtons = buttons;
    PAD.pollGamepads(getPads);
    for (const action of PAD_ACTIONS) {
      if (PAD.wasTapped(action)) {
        this.input.keys.push(action);
        this.input.typed.push(action);
        this.input.pressed = true;
      }
    }
    PAD.endTick();
  }

  /** Entrées accumulées depuis le dernier appel. */
  take(): UiInput {
    const input = this.input;
    this.input = empty();
    return input;
  }

  /** Oublie ce qui est en attente (changement d'écran). */
  clear(): void {
    this.input = empty();
  }

  /** Une manette standard est-elle connue du navigateur ? (Elle n'apparaît qu'après un premier appui sur un de ses boutons.) */
  static gamepadConnected(getPads?: PadGetter): boolean {
    return firstStandardPad(getPads) !== null;
  }
}

