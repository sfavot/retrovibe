import type { VoyageursAction } from "../engine/host";

/**
 * Ce qu'une touche du clavier du navigateur fait dans le jeu (keymap de ScummVM, `metaengine.cpp`) : F1 à F6 choisissent un verbe, F9 ouvre
 * le menu des verbes, F10 le menu système, Entrée est un clic gauche et Échap un clic droit (à la position du curseur, tant que la touche
 * est tenue). La marche au clavier de ScummVM (pavé numérique) n'est pas reprise : elle vise la position du héros (`input.ts`, `bgVar0` à 0),
 * donc sans effet hors des décors qui l'utilisent. Ctrl / Cmd + touche, Alt + lettre, Tab, F11 et F12 restent au navigateur.
 */
export type KeyAction =
  | { type: "action"; action: VoyageursAction }
  | { type: "button"; button: "left" | "right"; down: boolean };

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

function browserKeeps(event: KeyLike): boolean {
  if (event.ctrlKey || event.metaKey) return true;
  return event.altKey && event.key.length === 1;
}

/** Traduction des touches : verbes et menus (action du moteur), Entrée et Échap (boutons de la souris, tenus tant que la touche l'est). */
export function keyDown(event: KeyLike): KeyAction | null {
  if (browserKeeps(event)) return null;
  const action = VERB_KEYS[event.key];
  if (action) return { type: "action", action };
  if (event.key === "Enter" || event.code === "Numpad5") return { type: "button", button: "left", down: true };
  if (event.key === "Escape") return { type: "button", button: "right", down: true };
  return null;
}

/** Touche relâchée : `null` si elle n'avait aucun effet. */
export function keyUp(event: KeyLike): KeyAction | null {
  if (event.key === "Enter" || event.code === "Numpad5") return { type: "button", button: "left", down: false };
  if (event.key === "Escape") return { type: "button", button: "right", down: false };
  return null;
}
