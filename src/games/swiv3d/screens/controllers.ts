/**
 * Profil de contrôleur d'un pilote (fiche `(0x14, pilote, 2)` de `swiv.cfg`, docs/swiv3d/screens.md §4.4 et player.md §5) : type,
 * 11 touches en codes de balayage PC (jeu 1, `+0x80` pour les touches étendues : c'est l'indice de la table `00490010` et le numéro du
 * nom de touche de la table 1000 de `GLOBAL.BD`), trois octets d'axe et « Attacher au centre ».
 *
 * Le port garde les codes de balayage de l'original (sauvegarde, noms de touches) et les traduit en `KeyboardEvent.code` (position
 * physique, donc identique en AZERTY et en QWERTY), en boutons de souris et en boutons de manette (Gamepad API) au moment de jouer.
 */

/** Types de contrôleur portés (`+0x0c`) : 1 clavier, 2 souris, 3 manette de jeu. Gravis (4), DirectInput (5) et Creative (6) : sans objet. */
export type ControllerType = 1 | 2 | 3;
export const CONTROLLER_TYPES: readonly ControllerType[] = [1, 2, 3];

/**
 * Les 11 touches du profil, dans l'ordre des champs `+0x10`..`+0x38` (et `+0xb8`..`+0xe0` du joueur) : tourner ← →, avancer ↑ ↓,
 * latéral ← →, arme principale, arme spéciale, sélection ↑ ↓, « Strafe On / Freiner ».
 */
export const KEY_SLOTS = [
  "turnLeft",
  "turnRight",
  "forward",
  "back",
  "strafeLeft",
  "strafeRight",
  "firePrimary",
  "fireSpecial",
  "weaponNext",
  "weaponPrev",
  "brake",
] as const;
export type KeySlot = (typeof KEY_SLOTS)[number];

/** Ligne du menu des liens (`3/21`..`3/32`, id de retour = id de chaîne) -> rang de la touche dans le profil (`00418454`). */
export const KEY_ROWS: Readonly<Record<number, number>> = { 21: 0, 22: 1, 24: 2, 25: 3, 26: 4, 27: 5, 29: 6, 30: 7, 31: 8, 32: 9, 28: 10 };

/** Mouvements liables à un axe (octets `+0x3c` tourner, `+0x3d` avancer, `+0x3e` latéral) ; 0 = aucun axe, 1 = X, 2 = Y, 3 = Z. */
export type Motion = 0 | 1 | 2;

export interface ControllerProfile {
  type: ControllerType;
  /** 11 codes de balayage, ordre `KEY_SLOTS`. */
  keys: number[];
  /** Axe lié à chaque mouvement (tourner, avancer, latéral) : 0 aucun, 1 X, 2 Y, 3 Z. */
  axes: [number, number, number];
  /** « Attacher au centre » (`+0x3f`) : 0 = zone morte de ±50 sur ±128 (« Oui »), 1 = aucune (« Non »). */
  clip: 0 | 1;
}

/** Codes de balayage des boutons de souris (gauche, droit, milieu) et du premier bouton de manette (boutons 1 à 8 : `0x93..0x9a`). */
export const MOUSE_SCAN = 0x90;
export const PAD_SCAN = 0x93;
export const PAD_SCAN_BUTTONS = 8;

/**
 * Touches par défaut posées au changement de type (`gm_menu_controller_type` `004171b4`) : flèches, virgule / point, Espace, M,
 * Page préc. / suiv., Ctrl gauche ; la souris tire avec ses boutons et tourne avec l'axe X ; la manette tire avec ses boutons 1 et 2,
 * freine avec le 3, tourne (X) et avance (Y) par axes et choisit l'arme avec les flèches haut / bas.
 */
export function defaultProfile(type: ControllerType): ControllerProfile {
  switch (type) {
    case 1:
      return { type, keys: [0xcb, 0xcd, 0xc8, 0xd0, 0x33, 0x34, 0x39, 0x32, 0xc9, 0xd1, 0x1d], axes: [1, 2, 0], clip: 1 };
    case 2:
      return { type, keys: [0xcb, 0xcd, 0xc8, 0xd0, 0xcb, 0xcd, 0x90, 0x91, 0xc9, 0xd1, 0x1d], axes: [1, 0, 0], clip: 1 };
    case 3:
      return { type, keys: [0xcb, 0xcd, 0xc8, 0xd0, 0xcb, 0xcd, 0x93, 0x94, 0xc8, 0xd0, 0x95], axes: [1, 2, 0], clip: 1 };
  }
}

/** Nombre d'axes du type (`gm_menu_axis_bindings` `0041797c`) : souris 2 (X, Y), manette 3 (X, Y, Z), clavier aucun. */
export function axisCount(type: ControllerType): number {
  return type === 2 ? 2 : type === 3 ? 3 : 0;
}

/** Les axes ne servent qu'aux types autres que le clavier (`T > 1`), comme la ligne « Liens du contrôleur » du menu. */
export const usesAxes = (type: ControllerType): boolean => type > 1;

/** À l'ouverture du menu des axes : un axe que le type n'a pas est ramené à 0 (`0041797c`). */
export function clampAxes(profile: ControllerProfile): void {
  const max = axisCount(profile.type);
  profile.axes = profile.axes.map((a) => (a > max ? 0 : a)) as [number, number, number];
}

/** Choisir un mouvement dans le menu des axes : axe suivant, retour à « Clavier » (0) après le dernier axe du type. */
export function cycleAxis(profile: ControllerProfile, motion: Motion): void {
  const next = profile.axes[motion]! + 1;
  profile.axes[motion] = next > axisCount(profile.type) ? 0 : next;
}

/** Une ligne de touches du menu n'est montrée que si le mouvement n'est pas lié à un axe (`00418454`). */
export function motionOnKeys(profile: ControllerProfile, motion: Motion): boolean {
  return !usesAxes(profile.type) || profile.axes[motion] === 0;
}

/**
 * Codes de balayage PC (jeu 1) -> `KeyboardEvent.code`. Les touches étendues ont `0x80` en plus (`WM_KEYDOWN` : bit 24 de `lParam`).
 * `0x45` est Pause (la touche de pause du jeu), `0xc5` Verr. num. ; Alt Gr (`0xb8`) n'arrive jamais au jeu (`gm_wndproc` l'ignore).
 */
const SCAN_TO_CODE: Readonly<Record<number, string>> = {
  0x01: "Escape",
  0x02: "Digit1",
  0x03: "Digit2",
  0x04: "Digit3",
  0x05: "Digit4",
  0x06: "Digit5",
  0x07: "Digit6",
  0x08: "Digit7",
  0x09: "Digit8",
  0x0a: "Digit9",
  0x0b: "Digit0",
  0x0c: "Minus",
  0x0d: "Equal",
  0x0e: "Backspace",
  0x0f: "Tab",
  0x10: "KeyQ",
  0x11: "KeyW",
  0x12: "KeyE",
  0x13: "KeyR",
  0x14: "KeyT",
  0x15: "KeyY",
  0x16: "KeyU",
  0x17: "KeyI",
  0x18: "KeyO",
  0x19: "KeyP",
  0x1a: "BracketLeft",
  0x1b: "BracketRight",
  0x1c: "Enter",
  0x1d: "ControlLeft",
  0x1e: "KeyA",
  0x1f: "KeyS",
  0x20: "KeyD",
  0x21: "KeyF",
  0x22: "KeyG",
  0x23: "KeyH",
  0x24: "KeyJ",
  0x25: "KeyK",
  0x26: "KeyL",
  0x27: "Semicolon",
  0x28: "Quote",
  0x29: "Backquote",
  0x2a: "ShiftLeft",
  0x2b: "Backslash",
  0x2c: "KeyZ",
  0x2d: "KeyX",
  0x2e: "KeyC",
  0x2f: "KeyV",
  0x30: "KeyB",
  0x31: "KeyN",
  0x32: "KeyM",
  0x33: "Comma",
  0x34: "Period",
  0x35: "Slash",
  0x36: "ShiftRight",
  0x37: "NumpadMultiply",
  0x38: "AltLeft",
  0x39: "Space",
  0x3a: "CapsLock",
  0x3b: "F1",
  0x3c: "F2",
  0x3d: "F3",
  0x3e: "F4",
  0x3f: "F5",
  0x40: "F6",
  0x41: "F7",
  0x42: "F8",
  0x43: "F9",
  0x44: "F10",
  0x45: "Pause",
  0x46: "ScrollLock",
  0x47: "Numpad7",
  0x48: "Numpad8",
  0x49: "Numpad9",
  0x4a: "NumpadSubtract",
  0x4b: "Numpad4",
  0x4c: "Numpad5",
  0x4d: "Numpad6",
  0x4e: "NumpadAdd",
  0x4f: "Numpad1",
  0x50: "Numpad2",
  0x51: "Numpad3",
  0x52: "Numpad0",
  0x53: "NumpadDecimal",
  0x56: "IntlBackslash",
  0x57: "F11",
  0x58: "F12",
  0x9c: "NumpadEnter",
  0x9d: "ControlRight",
  0xb5: "NumpadDivide",
  0xc5: "NumLock",
  0xc7: "Home",
  0xc8: "ArrowUp",
  0xc9: "PageUp",
  0xcb: "ArrowLeft",
  0xcd: "ArrowRight",
  0xcf: "End",
  0xd0: "ArrowDown",
  0xd1: "PageDown",
  0xd2: "Insert",
  0xd3: "Delete",
};

const CODE_TO_SCAN: ReadonlyMap<string, number> = new Map(Object.entries(SCAN_TO_CODE).map(([scan, code]) => [code, Number(scan)]));

/** Code de balayage d'une touche du navigateur, ou `undefined` si l'original n'en a pas (touches Windows, Alt Gr…). */
export const scanOfCode = (code: string): number | undefined => CODE_TO_SCAN.get(code);

/** `KeyboardEvent.code` d'un code de balayage clavier, ou `undefined` (souris, manette, code inconnu). */
export const codeOfScan = (scan: number): string | undefined => SCAN_TO_CODE[scan];

/** Bouton de souris du navigateur (`MouseEvent.button` : 0 gauche, 1 milieu, 2 droit) -> code de l'original (`0x90` gauche, `0x91` droit, `0x92` milieu). */
export function scanOfMouseButton(button: number): number | undefined {
  return button === 0 ? MOUSE_SCAN : button === 2 ? MOUSE_SCAN + 1 : button === 1 ? MOUSE_SCAN + 2 : undefined;
}

/** Bouton de manette d'un code (`0x93..0x9a` -> 0..7, indices de la Gamepad API), ou `undefined`. */
export function padButtonOfScan(scan: number): number | undefined {
  return scan >= PAD_SCAN && scan < PAD_SCAN + PAD_SCAN_BUTTONS ? scan - PAD_SCAN : undefined;
}

const isScan = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v < 256;

/** Profil relu de la sauvegarde ; `null` (type 0, « non configuré ») s'il est absent ou illisible. */
export function parseProfile(raw: unknown): ControllerProfile | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const type = o.type;
  if (type !== 1 && type !== 2 && type !== 3) return null;
  const base = defaultProfile(type);
  const keys = Array.isArray(o.keys) ? o.keys : [];
  const axes = Array.isArray(o.axes) ? o.axes : [];
  return {
    type,
    keys: base.keys.map((fallback, i) => (isScan(keys[i]) ? keys[i] : fallback)),
    // Comme dans la fiche, un axe au-delà du type est gardé : le menu des axes le ramène à 0 en s'ouvrant.
    axes: base.axes.map((fallback, i) => {
      const a = axes[i];
      return typeof a === "number" && Number.isInteger(a) && a >= 0 && a <= 3 ? a : fallback;
    }) as [number, number, number],
    clip: o.clip === 0 ? 0 : 1,
  };
}
