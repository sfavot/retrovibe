import type { CroisiereAction } from "../engine/host";

/**
 * Ce qu'une touche du clavier du navigateur fait dans le jeu. Les actions du moteur sont celles de ScummVM (`metaengine.cpp`) : Échap
 * (`escape`, tenue tant que la touche l'est : le bouton du milieu, que les scripts de l'introduction lisent), Espace (`endUserWaiting` :
 * fait disparaître le texte affiché), F10 (`playerMenu` : menu joueur), I (`inventory`), + et − (vitesse du jeu).
 *
 * Écarts (plan.md D4) : P passe par la pause du site (la pause du jeu, « Pause » écrit à l'écran, n'est pas utilisée), F1 ouvre le menu
 * du site. X (quitter sans confirmation) et F (mode rapide, de débogage) ne sont pas repris. Ctrl / Cmd + touche, Alt + lettre, Tab, F11
 * et F12 restent au navigateur ; les autres touches ne font rien.
 */
export type KeyAction =
  /** Commande de l'hôte : le moteur ne la voit pas. */
  | { type: "host"; command: HostCommand }
  /** Action transmise au moteur. */
  | { type: "engine"; action: CroisiereAction };

/** Commandes de l'hôte : le menu du site (F1), la pause du site (P). */
export type HostCommand = "menu" | "pause";

/** Ce que l'on lit d'un événement clavier. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

const HOST_KEYS: Readonly<Record<string, HostCommand>> = { F1: "menu", p: "pause", P: "pause" };

const ENGINE_KEYS: Readonly<Record<string, CroisiereAction>> = {
  Escape: "escape",
  " ": "endUserWaiting",
  F10: "playerMenu",
  i: "inventory",
  I: "inventory",
  "+": "increaseGameSpeed",
  "-": "decreaseGameSpeed",
};

/** Vrai si le navigateur garde la touche (raccourci du navigateur ou du système). */
function browserKeeps(event: KeyLike): boolean {
  return event.ctrlKey || event.metaKey || (event.altKey && event.key.length === 1);
}

/** Traduction d'une touche : commande de l'hôte, action du moteur, ou `null` (touche laissée au navigateur ou sans effet). */
export function keyAction(event: KeyLike): KeyAction | null {
  if (browserKeeps(event)) return null;
  const command = HOST_KEYS[event.key];
  if (command) return { type: "host", command };
  const action = ENGINE_KEYS[event.key];
  return action ? { type: "engine", action } : null;
}
