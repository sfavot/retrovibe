/**
 * Commandes de SWIV 3D : touches, manette et commandes tactiles, ramenées à un `PlayerInput` par tick de simulation.
 *
 * Touches d'origine (`docs/swiv3d/player.md` §5.2) reprises par position physique (`KeyboardEvent.code`, donc identiques en
 * QWERTY et en AZERTY), plus des alias de confort : `KeyW`/`KeyA`/`KeyS`/`KeyD` (ZQSD en AZERTY) pour avancer et tourner,
 * `KeyQ`/`KeyE` pour le déplacement latéral, `ShiftLeft` pour « Strafe On » (Ctrl + W ferme l'onglet du navigateur) et les
 * crochets pour changer d'arme sur un clavier sans Page préc. / Page suiv.
 *
 * Manette (`mapping: "standard"`, §5.6) : stick gauche = tourner (X) et avancer (Y), stick droit X = latéral, boutons A/RT = tir,
 * B/X = spécial, LT = « Strafe On », LB/RB = arme précédente / suivante, croix = secours numérique, Start = pause. Les axes sont
 * ramenés aux valeurs d'origine (±128) avec une zone morte de 0,2 (celle d'origine, 0,39, est jugée trop large).
 */
import { HeldInput, type HeldBinding, type PadGetter, type PadLike } from "../../../ui/held-input";
import type { TouchSink } from "../../../ui/touch-controls";
import type { PlayerInput } from "../engine/input";

export type WeaponSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export const WEAPON_SLOTS: readonly WeaponSlot[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

type BaseAction =
  | "turnLeft"
  | "turnRight"
  | "forward"
  | "back"
  | "strafeLeft"
  | "strafeRight"
  | "brake"
  | "firePrimary"
  | "fireSpecial"
  | "weaponNext"
  | "weaponPrev";
export type Action = BaseAction | `weapon${WeaponSlot}`;

const weaponAction = (slot: WeaponSlot): Action => `weapon${slot}`;

/** Touches par défaut de chaque action (`KeyboardEvent.code`). Les chiffres du pavé numérique ne sont pas liés (ils servent au système). */
export const DEFAULT_KEYS: Readonly<Record<Action, readonly string[]>> = {
  turnLeft: ["ArrowLeft", "KeyA"],
  turnRight: ["ArrowRight", "KeyD"],
  forward: ["ArrowUp", "KeyW"],
  back: ["ArrowDown", "KeyS"],
  strafeLeft: ["Comma", "KeyQ"],
  strafeRight: ["Period", "KeyE"],
  brake: ["ControlLeft", "ShiftLeft"],
  firePrimary: ["Space"],
  fireSpecial: ["KeyM", "KeyX"],
  weaponNext: ["PageUp", "BracketRight"],
  weaponPrev: ["PageDown", "BracketLeft"],
  weapon1: ["Digit1"],
  weapon2: ["Digit2"],
  weapon3: ["Digit3"],
  weapon4: ["Digit4"],
  weapon5: ["Digit5"],
  weapon6: ["Digit6"],
  weapon7: ["Digit7"],
  weapon8: ["Digit8"],
  weapon9: ["Digit9"],
  weapon10: ["Digit0"],
};

/** Boutons de manette standard par action (indices de la Gamepad API). */
export const PAD_BUTTONS: Readonly<Partial<Record<Action, readonly number[]>>> = {
  firePrimary: [0, 7],
  fireSpecial: [1, 2],
  brake: [6],
  weaponPrev: [4],
  weaponNext: [5],
  forward: [12],
  back: [13],
  turnLeft: [14],
  turnRight: [15],
};

/** Touches de pause (`Pause` d'origine, `P` en alias). */
export const PAUSE_KEYS: readonly string[] = ["Pause", "KeyP"];
/** Bouton Start de la manette. */
const PAD_PAUSE_BUTTON = 9;

/** Valeur d'origine d'un axe poussé à fond (`player.md` §5.6). */
export const AXIS_FULL = 128;
export const AXIS_DEAD_ZONE = 0.2;

/** Axe analogique [-1, 1] -> valeur d'origine entière (±128) : zone morte, puis le reste de la course remis à l'échelle. */
export function shapeAxis(value: number, deadZone = AXIS_DEAD_ZONE): number {
  const magnitude = Math.abs(value);
  if (!(magnitude > deadZone)) return 0;
  const scaled = Math.round(((Math.min(magnitude, 1) - deadZone) / (1 - deadZone)) * AXIS_FULL);
  return value < 0 ? -scaled : scaled;
}

/** De deux sources analogiques, celle qui est le plus poussée. */
const strongest = (a: number, b: number): number => (Math.abs(a) >= Math.abs(b) ? a : b);

/** Identifiants des boutons tactiles -> actions. */
export const TOUCH_ACTIONS: Readonly<Record<string, Action>> = {
  fire: "firePrimary",
  special: "fireSpecial",
  next: "weaponNext",
  brake: "brake",
};

interface KeyLike {
  code: string;
  repeat?: boolean;
  metaKey?: boolean;
}

export class Controls {
  private readonly held: HeldInput<Action>;
  /** Touches liées (pour `preventDefault` sur les répétitions automatiques). */
  private readonly bound: ReadonlySet<string>;
  /** Axes de la manette et du manche tactile, valeurs d'origine (±128). */
  private pad = { turn: 0, forward: 0, strafe: 0 };
  private touch = { turn: 0, forward: 0 };
  private pauseRequested = false;
  /** Une touche ou un bouton tactile a été pressé (n'importe laquelle : ferme la pause). */
  private anyKey = false;
  private padStart = false;

  constructor(keys: Readonly<Record<Action, readonly string[]>> = DEFAULT_KEYS) {
    const bindings = {} as Record<Action, HeldBinding>;
    for (const action of Object.keys(keys) as Action[]) {
      bindings[action] = { keys: [...keys[action]], buttons: [...(PAD_BUTTONS[action] ?? [])] };
    }
    this.held = new HeldInput<Action>(bindings);
    this.bound = new Set(Object.values(keys).flat());
  }

  /** Touche enfoncée ; `true` si elle est liée (l'appelant fait alors `preventDefault`). La répétition automatique est ignorée : l'exe efface la touche après usage. */
  keyDown(event: KeyLike): boolean {
    if (event.metaKey) return false;
    if (!event.repeat) this.anyKey = true;
    if (PAUSE_KEYS.includes(event.code)) {
      if (!event.repeat) this.pauseRequested = true;
      return true;
    }
    if (event.repeat) return this.bound.has(event.code);
    return this.held.keyDown(event.code);
  }

  keyUp(event: KeyLike): boolean {
    if (PAUSE_KEYS.includes(event.code)) return true;
    return this.held.keyUp(event.code);
  }

  /** Commandes tactiles : boutons (`TOUCH_ACTIONS`) et manche (tourner = X, avancer = haut). */
  readonly touchSink: TouchSink = {
    press: (id) => {
      this.anyKey = true;
      const action = TOUCH_ACTIONS[id];
      if (action) this.held.press(action);
    },
    release: (id) => {
      const action = TOUCH_ACTIONS[id];
      if (action) this.held.release(action);
    },
    setAxis: (x, y) => {
      this.touch = { turn: shapeAxis(x), forward: shapeAxis(-y) };
    },
  };

  /** Une fois par image avant les ticks : lit la première manette standard (boutons, axes, Start). */
  poll(getPads?: PadGetter): void {
    this.held.pollGamepads(getPads);
    const pad = firstPad(getPads ?? defaultPads);
    if (!pad) {
      this.pad = { turn: 0, forward: 0, strafe: 0 };
      this.padStart = false;
      return;
    }
    this.pad = {
      turn: shapeAxis(pad.axes[0] ?? 0),
      forward: shapeAxis(-(pad.axes[1] ?? 0)),
      strafe: shapeAxis(pad.axes[2] ?? 0),
    };
    const start = pad.buttons[PAD_PAUSE_BUTTON]?.pressed === true;
    if (start && !this.padStart) this.pauseRequested = true;
    this.padStart = start;
  }

  /** Une demande de pause (touche ou Start) a-t-elle eu lieu depuis le dernier appel ? */
  takePauseRequest(): boolean {
    const requested = this.pauseRequested;
    this.pauseRequested = false;
    return requested;
  }

  /** Une touche (ou un bouton tactile) a-t-elle été pressée depuis le dernier appel ? La pause de l'exe se ferme sur n'importe laquelle. */
  takeAnyKey(): boolean {
    const pressed = this.anyKey;
    this.anyKey = false;
    return pressed;
  }

  /** Entrées d'un tick (appuis brefs compris), puis oubli des appuis brefs. */
  sample(): PlayerInput {
    const h = this.held;
    const on = (action: Action): boolean => h.isHeld(action) || h.wasTapped(action);
    const tapped = (action: Action): boolean => h.wasTapped(action);
    const turn = strongest(this.pad.turn, this.touch.turn);
    const forward = strongest(this.pad.forward, this.touch.forward);
    const strafe = this.pad.strafe;
    const input: PlayerInput = {
      turnLeft: on("turnLeft"),
      turnRight: on("turnRight"),
      forward: on("forward"),
      back: on("back"),
      strafeLeft: on("strafeLeft"),
      strafeRight: on("strafeRight"),
      brake: on("brake"),
      firePrimary: on("firePrimary"),
      fireSpecial: tapped("fireSpecial"),
      weaponNext: tapped("weaponNext"),
      weaponPrev: tapped("weaponPrev"),
      weaponDirect: WEAPON_SLOTS.find((slot) => tapped(weaponAction(slot))) ?? null,
      pause: false,
    };
    if (turn !== 0 || forward !== 0 || strafe !== 0) input.axes = { turn, forward, strafe };
    h.endTick();
    return input;
  }

  /** Perte de focus, onglet masqué, pause : plus rien n'est tenu. */
  clear(): void {
    this.held.clear();
    this.pad = { turn: 0, forward: 0, strafe: 0 };
    this.touch = { turn: 0, forward: 0 };
    this.pauseRequested = false;
    this.anyKey = false;
  }
}

const defaultPads: PadGetter = () => (typeof navigator !== "undefined" ? navigator.getGamepads?.() : undefined) ?? [];

/** Première manette connectée de mappage standard (comme `HeldInput.pollGamepads`). */
function firstPad(getPads: PadGetter): PadLike | null {
  const pads = getPads();
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    if (p?.connected && (p.mapping === undefined || p.mapping === "" || p.mapping === "standard")) return p;
  }
  return null;
}
