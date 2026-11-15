import type { VoyageursAction } from "../engine/host";

/**
 * Ce qu'une touche du clavier du navigateur fait dans le jeu (keymap de ScummVM, `CineMetaEngine::initKeymaps`) : F1 à F6 choisissent un
 * verbe, F9 ouvre le menu des verbes, F10 le menu système, Entrée et 5 du pavé numérique sont un clic gauche, Échap un clic droit (à la
 * position du curseur, tant que la touche est tenue). Flèches haut et bas : ligne précédente ou suivante du menu ouvert (`MENUUP` /
 * `MENUDOWN`, comme la molette ; sans effet hors d'un menu). Les flèches gauche et droite n'ont aucune action dans ScummVM.
 *
 * Pavé numérique 1 à 4 et 6 à 9 (`MOVEUP`… : `moveUsingKeyboard`) : ScummVM ne fait pas marcher le héros. `executePlayerInput` (FW) ne lit
 * pas le sens de la touche : `menuVar` restant à 0, `var_5E` égale `bgVar0` et la cible de marche (globales 249 / 250) est remise sur le
 * héros lui-même, d'après son sens de marche en cours (globales 253 / 251) ; à l'arrêt elle ne change pas. La touche arrête donc le héros
 * qui marche, et ne fait rien sinon ; elle doit être encore tenue au tick suivant, comme dans ScummVM (le relâchement remet tout à 0).
 * Ctrl / Cmd + touche, Alt + lettre, Tab, F11 et F12 restent au navigateur.
 */
export type KeyAction =
  | { type: "action"; action: VoyageursAction }
  | { type: "button"; button: "left" | "right"; down: boolean }
  | { type: "walk"; dx: number; dy: number };

/** Ce que l'on lit d'un événement clavier. */
export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

const VERB_KEYS: Readonly<Record<string, VoyageursAction>> = {
  F1: "examine",
  F2: "take",
  F3: "inventory",
  F4: "use",
  F5: "activate",
  F6: "speak",
  F9: "actionMenu",
  F10: "systemMenu",
};

/** Pavé numérique (`event.code`, verrouillage numérique ou non) -> sens de `moveUsingKeyboard` : `dx` > 0 droite, `dy` > 0 haut. */
const WALK_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  Numpad8: [0, 1],
  Numpad2: [0, -1],
  Numpad4: [-1, 0],
  Numpad6: [1, 0],
  Numpad7: [-1, 1],
  Numpad9: [1, 1],
  Numpad1: [-1, -1],
  Numpad3: [1, -1],
};

/** Flèches haut et bas : `MENUUP` / `MENUDOWN`. */
const MENU_KEYS: Readonly<Record<string, VoyageursAction>> = {
  ArrowUp: "menuUp",
  ArrowDown: "menuDown",
};

function browserKeeps(event: KeyLike): boolean {
  if (event.ctrlKey || event.metaKey) return true;
  return event.altKey && event.key.length === 1;
}

/**
 * Traduction des touches : verbes, menus et flèches haut / bas (action du moteur), Entrée et Échap (boutons de la souris, tenus tant que la
 * touche l'est), pavé numérique (marche au clavier, tenue tant que la touche l'est).
 */
export function keyDown(event: KeyLike): KeyAction | null {
  if (browserKeeps(event)) return null;
  const walk = WALK_KEYS[event.code];
  if (walk) return { type: "walk", dx: walk[0], dy: walk[1] };
  const action = VERB_KEYS[event.key] ?? MENU_KEYS[event.key];
  if (action) return { type: "action", action };
  if (event.key === "Enter" || event.code === "Numpad5") return { type: "button", button: "left", down: true };
  if (event.key === "Escape") return { type: "button", button: "right", down: true };
  return null;
}

/** Touche relâchée : `null` si elle n'avait aucun effet. */
export function keyUp(event: KeyLike): KeyAction | null {
  // Relâcher n'importe quelle touche de marche arrête la marche au clavier (`EVENT_CUSTOM_ENGINE_ACTION_END` : `moveUsingKeyboard(0, 0)`).
  if (WALK_KEYS[event.code]) return { type: "walk", dx: 0, dy: 0 };
  if (event.key === "Enter" || event.code === "Numpad5") return { type: "button", button: "left", down: false };
  if (event.key === "Escape") return { type: "button", button: "right", down: false };
  return null;
}
