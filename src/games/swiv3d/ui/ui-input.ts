import { HeldInput, type PadGetter } from "../../../ui/held-input";
import type { UiInput, UiKey } from "../screens/flow";

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

/** Rassemble les entrées des menus (clavier, manette, appuis) entre deux images. */
export class UiInputCollector {
  private input: UiInput = { keys: [], chars: [], taps: [], pressed: false };

  /** Touche enfoncée (répétition automatique comprise) ; vrai si l'interface la prend (le navigateur n'en fait alors rien). */
  keyDown(event: { code: string; key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
    if (event.metaKey) return false;
    if (MODIFIERS.has(event.code)) return false;
    const key = KEY_CODES[event.code];
    this.input.pressed = true;
    if (key) {
      this.input.keys.push(key);
      return true;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.altKey) {
      this.input.chars.push(event.key);
      return true;
    }
    return false;
  }

  /** Appui de souris ou de doigt, repère 320×400. */
  tap(x: number, y: number): void {
    this.input.taps.push({ x, y });
    this.input.pressed = true;
  }

  /** Une fois par image : fronts montants de la manette. */
  pollGamepad(getPads?: PadGetter): void {
    PAD.pollGamepads(getPads);
    for (const action of PAD_ACTIONS) {
      if (PAD.wasTapped(action)) {
        this.input.keys.push(action);
        this.input.pressed = true;
      }
    }
    PAD.endTick();
  }

  /** Entrées accumulées depuis le dernier appel. */
  take(): UiInput {
    const input = this.input;
    this.input = { keys: [], chars: [], taps: [], pressed: false };
    return input;
  }

  /** Oublie ce qui est en attente (changement d'écran). */
  clear(): void {
    this.input = { keys: [], chars: [], taps: [], pressed: false };
  }
}

