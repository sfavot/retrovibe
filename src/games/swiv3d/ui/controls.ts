/**
 * Commandes de SWIV 3D : touches, souris, manette et commandes tactiles, ramenées à un `PlayerInput` par tick de simulation.
 *
 * Le profil de contrôleur du pilote (`screens/controllers.ts`, menus « Configuration du contrôleur ») décide, comme l'original au
 * chargement du niveau (élément `300`) : les 11 touches (codes de balayage traduits en `KeyboardEvent.code`, donc par position
 * physique, identiques en QWERTY et en AZERTY ; boutons de souris ; boutons de manette), les axes liés et « Attacher au centre ».
 * Sans profil (page de dev, tests), ce sont les touches par défaut du clavier.
 *
 * Ajouts du port : des alias de confort sur les touches que le profil n'utilise pas : `KeyW`/`KeyA`/`KeyS`/`KeyD` (ZQSD en AZERTY)
 * pour avancer et tourner, `KeyQ`/`KeyE` pour le déplacement latéral, `ShiftLeft` pour « Strafe On » (Ctrl + W ferme l'onglet du
 * navigateur), `KeyX` pour le tir spécial et les crochets pour changer d'arme sur un clavier sans Page préc. / Page suiv. ; au clavier et
 * à la souris, la manette standard garde un mappage d'office (§5.6) : stick gauche = tourner (X) et avancer (Y), stick droit X = latéral,
 * A/RT = tir, B/X = spécial, LT = « Strafe On », LB/RB = arme précédente / suivante, croix = secours. Start = pause dans tous les cas.
 * Les axes de ce mappage sont ramenés aux valeurs d'origine (±128) avec une zone morte de 0,2 (celle d'origine, 0,39, est jugée trop
 * large).
 *
 * Type manette (3) : boutons 1 à 8 du profil = boutons 0 à 7 de la Gamepad API (A, B, X, Y, LB, RB, LT, RT en mappage standard), axes X,
 * Y, Z = axes 0, 1 (haut positif) et 2 (stick droit) liés aux mouvements par le profil ; « Attacher au centre » = zone morte de ±50 sur
 * ±128 (`005b043c == 0`), sinon la zone morte de 0,2 du port tient lieu du calibrage de l'original. Type souris (2) : l'axe est une
 * vitesse, `clamp(déplacement × 256 / ms, ±190)` en pixels de la grille 320 × 240 (`gm_poll_events`), lu sous verrouillage du pointeur ;
 * la molette change d'arme.
 */
import { HeldInput, type HeldBinding, type PadGetter, type PadLike } from "../../../ui/held-input";
import type { TouchSink } from "../../../ui/touch-controls";
import type { PlayerInput } from "../engine/input";
import { KEY_SLOTS, MOUSE_SCAN, codeOfScan, padButtonOfScan, type ControllerProfile } from "../screens/controllers";

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
/** « Attacher au centre » : zone morte de ±50 sur ±128 (`player.md` §5.4). */
export const CLIP_DEAD_ZONE = 50;
/** Butée de l'axe de la souris (`0xbe`). */
export const MOUSE_AXIS_MAX = 190;

/** Pseudo-codes de touche des boutons de souris (`0x90` gauche, `0x91` droit, `0x92` milieu) pour `HeldInput`. */
const mouseKey = (scan: number): string => `Mouse${scan - MOUSE_SCAN}`;
const MOUSE_BUTTON_KEYS: Readonly<Record<number, string>> = { 0: mouseKey(MOUSE_SCAN), 2: mouseKey(MOUSE_SCAN + 1), 1: mouseKey(MOUSE_SCAN + 2) };

/** Axe de manette `[-1, 1]` -> valeur d'origine (±128), avec la zone morte de ±50 de « Attacher au centre ». */
export function clipAxis(value: number): number {
  const v = Math.max(-AXIS_FULL, Math.min(AXIS_FULL, Math.round(value * AXIS_FULL)));
  return Math.abs(v) <= CLIP_DEAD_ZONE ? 0 : v;
}

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

/**
 * Liaisons d'un profil : chaque action reçoit la touche, le bouton de souris ou le bouton de manette de son code ; les alias de confort de
 * `DEFAULT_KEYS` s'ajoutent sur les touches que le profil n'utilise pas. Les chiffres (armes) restent fixes, comme dans l'original.
 */
function profileBindings(profile: ControllerProfile): { keys: Record<Action, string[]>; buttons: Record<Action, number[]> } {
  const keys = {} as Record<Action, string[]>;
  const buttons = {} as Record<Action, number[]>;
  for (const action of Object.keys(DEFAULT_KEYS) as Action[]) {
    keys[action] = [];
    buttons[action] = [];
  }
  const used = new Set<string>();
  KEY_SLOTS.forEach((action, i) => {
    const scan = profile.keys[i]!;
    const code = scan >= MOUSE_SCAN && scan < MOUSE_SCAN + 3 ? mouseKey(scan) : codeOfScan(scan);
    const button = padButtonOfScan(scan);
    if (code) {
      keys[action].push(code);
      used.add(code);
    }
    if (button !== undefined) buttons[action].push(button);
  });
  for (const action of Object.keys(DEFAULT_KEYS) as Action[]) {
    for (const code of DEFAULT_KEYS[action]) {
      // Touche d'origine de l'action : seulement si le profil la garde (elle y est déjà) ; alias : seulement sur une touche libre.
      const original = (KEY_SLOT_DEFAULTS as Partial<Record<Action, string>>)[action] === code;
      if (!original && !used.has(code)) keys[action].push(code);
    }
  }
  if (profile.type !== 3) for (const [action, list] of Object.entries(PAD_BUTTONS)) buttons[action as Action].push(...list);
  return { keys, buttons };
}

/** Touche d'origine du clavier de chaque action du profil (`DEFAULT_KEYS[action][0]`) : remplacée par le profil, jamais en alias. */
const KEY_SLOT_DEFAULTS = Object.fromEntries(KEY_SLOTS.map((action) => [action, DEFAULT_KEYS[action][0]!])) as Record<(typeof KEY_SLOTS)[number], string>;

export class Controls {
  private held: HeldInput<Action>;
  /** Touches liées (pour `preventDefault` sur les répétitions automatiques). */
  private bound: ReadonlySet<string> = new Set();
  /** Profil du pilote (`null` : touches par défaut, manette standard). */
  private profile: ControllerProfile | null = null;
  /** Touches de pause : `Pause`, et `P` tant que le profil ne s'en sert pas. */
  private pauseKeys: readonly string[] = PAUSE_KEYS;
  /** Axes de la manette et du manche tactile, valeurs d'origine (±128). */
  private pad = { turn: 0, forward: 0, strafe: 0 };
  private touch = { turn: 0, forward: 0 };
  /** Souris (type 2) : déplacement accumulé depuis la dernière lecture (pixels de la grille 320 × 240), axes calculés, molette. */
  private mouseDelta = { x: 0, y: 0 };
  private mouse = { turn: 0, forward: 0, strafe: 0 };
  private lastPoll: number | null = null;
  private wheel = 0;
  private pauseRequested = false;
  /** Une touche ou un bouton tactile a été pressé (n'importe laquelle : ferme la pause). */
  private anyKey = false;
  private padStart = false;

  constructor(keys: Readonly<Record<Action, readonly string[]>> = DEFAULT_KEYS) {
    const buttons = Object.fromEntries((Object.keys(keys) as Action[]).map((action) => [action, [...(PAD_BUTTONS[action] ?? [])]]));
    this.held = this.bind(keys, buttons as Record<Action, number[]>);
    this.bound = new Set(Object.values(keys).flat());
  }

  private bind(keys: Readonly<Record<Action, readonly string[]>>, buttons: Readonly<Record<Action, readonly number[]>>): HeldInput<Action> {
    const bindings = {} as Record<Action, HeldBinding>;
    for (const action of Object.keys(keys) as Action[]) bindings[action] = { keys: [...keys[action]], buttons: [...buttons[action]] };
    this.bound = new Set(Object.values(keys).flat());
    this.pauseKeys = PAUSE_KEYS.filter((code) => !this.bound.has(code));
    return new HeldInput<Action>(bindings);
  }

  /** Recopie le profil du pilote dans les commandes (élément `300` du script : `004841a4`, `00484188..90`, `005b043c`, touches). */
  configure(profile: ControllerProfile | null): void {
    this.profile = profile;
    if (profile) {
      const { keys, buttons } = profileBindings(profile);
      this.held = this.bind(keys, buttons);
    } else {
      const buttons = Object.fromEntries((Object.keys(DEFAULT_KEYS) as Action[]).map((action) => [action, PAD_BUTTONS[action] ?? []]));
      this.held = this.bind(DEFAULT_KEYS, buttons as Record<Action, number[]>);
    }
    this.clear();
  }

  /** Le profil est-il celui de la souris ? (L'application verrouille alors le pointeur sur le canvas pendant le niveau.) */
  get usesMouse(): boolean {
    return this.profile?.type === 2;
  }

  /** Touche enfoncée ; `true` si elle est liée (l'appelant fait alors `preventDefault`). La répétition automatique est ignorée : l'exe efface la touche après usage. */
  keyDown(event: KeyLike): boolean {
    if (event.metaKey) return false;
    if (!event.repeat) this.anyKey = true;
    if (this.pauseKeys.includes(event.code)) {
      if (!event.repeat) this.pauseRequested = true;
      return true;
    }
    if (event.repeat) return this.bound.has(event.code);
    return this.held.keyDown(event.code);
  }

  keyUp(event: KeyLike): boolean {
    if (this.pauseKeys.includes(event.code)) return true;
    return this.held.keyUp(event.code);
  }

  /** Bouton de souris (`MouseEvent.button`) : touches `0x90..0x92` de l'original, liables à n'importe quelle action. */
  mouseButton(button: number, down: boolean): boolean {
    const code = MOUSE_BUTTON_KEYS[button];
    if (!code) return false;
    if (down) {
      this.anyKey = true;
      return this.held.keyDown(code);
    }
    return this.held.keyUp(code);
  }

  /** Déplacement de la souris verrouillée, en pixels de la grille 320 × 240 de l'original. */
  mouseMove(dx: number, dy: number): void {
    this.mouseDelta.x += dx;
    this.mouseDelta.y += dy;
  }

  /** Molette, en crans (`WM_MOUSEWHEEL` / 120) : vers soi (positif) = arme suivante, vers l'avant = précédente. */
  mouseWheel(notches: number): void {
    this.wheel += notches;
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

  /**
   * Une fois par image avant les ticks : lit la première manette standard (boutons, axes, Start) et la souris. `now` (ms) mesure
   * l'intervalle de la vitesse de la souris (`performance.now()` par défaut).
   */
  poll(getPads?: PadGetter, now: number = typeof performance !== "undefined" ? performance.now() : Date.now()): void {
    this.pollMouse(now);
    this.held.pollGamepads(getPads);
    const pad = firstStandardPad(getPads ?? defaultPads);
    if (!pad) {
      this.pad = { turn: 0, forward: 0, strafe: 0 };
      this.padStart = false;
      return;
    }
    const profile = this.profile;
    if (profile?.type === 3) {
      // Axes X, Y (haut positif, `Y = 128 − …`), Z liés aux mouvements par le profil.
      const raw = [pad.axes[0] ?? 0, -(pad.axes[1] ?? 0), pad.axes[2] ?? 0];
      const value = (axis: number): number => (axis === 0 ? 0 : profile.clip === 0 ? clipAxis(raw[axis - 1]!) : shapeAxis(raw[axis - 1]!));
      this.pad = { turn: value(profile.axes[0]), forward: value(profile.axes[1]), strafe: value(profile.axes[2]) };
    } else {
      this.pad = {
        turn: shapeAxis(pad.axes[0] ?? 0),
        forward: shapeAxis(-(pad.axes[1] ?? 0)),
        strafe: shapeAxis(pad.axes[2] ?? 0),
      };
    }
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

  /** Vitesse de la souris (type 2) : `clamp(px × 256 / ms, ±190)`, X vers la droite, Y vers le haut ; intervalle de 1 à 1499 ms. */
  private pollMouse(now: number): void {
    const last = this.lastPoll;
    this.lastPoll = now;
    const profile = this.profile;
    const { x, y } = this.mouseDelta;
    this.mouseDelta = { x: 0, y: 0 };
    if (profile?.type !== 2 || last === null || now - last >= 1500) {
      this.mouse = { turn: 0, forward: 0, strafe: 0 };
      return;
    }
    const dt = Math.max(1, now - last);
    const speed = (px: number): number => Math.max(-MOUSE_AXIS_MAX, Math.min(MOUSE_AXIS_MAX, Math.trunc((px * 256) / dt)));
    const raw = [speed(x), speed(-y), 0];
    const value = (axis: number): number => (axis === 0 ? 0 : raw[axis - 1]!);
    this.mouse = { turn: value(profile.axes[0]), forward: value(profile.axes[1]), strafe: value(profile.axes[2]) };
  }

  /** Entrées d'un tick (appuis brefs compris), puis oubli des appuis brefs. */
  sample(): PlayerInput {
    const h = this.held;
    const on = (action: Action): boolean => h.isHeld(action) || h.wasTapped(action);
    const tapped = (action: Action): boolean => h.wasTapped(action);
    const turn = strongest(strongest(this.pad.turn, this.touch.turn), this.mouse.turn);
    const forward = strongest(strongest(this.pad.forward, this.touch.forward), this.mouse.forward);
    const strafe = strongest(this.pad.strafe, this.mouse.strafe);
    // Molette (`004841b8`) : un cran par tick, comme l'original qui retire 120 à chaque passage.
    const wheelNext = this.wheel >= 1;
    const wheelPrev = this.wheel <= -1;
    if (wheelNext) this.wheel -= 1;
    else if (wheelPrev) this.wheel += 1;
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
      weaponNext: tapped("weaponNext") || wheelNext,
      weaponPrev: tapped("weaponPrev") || wheelPrev,
      weaponDirect: WEAPON_SLOTS.find((slot) => tapped(weaponAction(slot))) ?? null,
      pause: false,
    };
    if (turn !== 0 || forward !== 0 || strafe !== 0) input.axes = { turn, forward, strafe };
    h.endTick();
    return input;
  }

  /**
   * Derrière l'écran de fin : `gm_menu_run` vide la table des touches (`gm_clear_keys`) à chaque image, avant les ticks du monde ; seules
   * la manette et la souris, relues par `gm_poll_events`, restent vues par le pilote. Relâche donc clavier, boutons de souris et commandes
   * tactiles (le manche compris), garde la manette, le déplacement de la souris et la molette (`004841b8`, non remise à 0).
   */
  releaseKeys(): void {
    this.held.clearKeys();
    this.touch = { turn: 0, forward: 0 };
    this.pauseRequested = false;
    this.anyKey = false;
  }

  /** Perte de focus, onglet masqué, pause : plus rien n'est tenu. */
  clear(): void {
    this.held.clear();
    this.pad = { turn: 0, forward: 0, strafe: 0 };
    this.touch = { turn: 0, forward: 0 };
    this.mouse = { turn: 0, forward: 0, strafe: 0 };
    this.mouseDelta = { x: 0, y: 0 };
    this.wheel = 0;
    this.pauseRequested = false;
    this.anyKey = false;
  }
}

const defaultPads: PadGetter = () => (typeof navigator !== "undefined" ? navigator.getGamepads?.() : undefined) ?? [];

/** Première manette connectée de mappage standard (comme `HeldInput.pollGamepads`). */
export function firstStandardPad(getPads: PadGetter = defaultPads): PadLike | null {
  const pads = getPads();
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    if (p?.connected && (p.mapping === undefined || p.mapping === "" || p.mapping === "standard")) return p;
  }
  return null;
}
