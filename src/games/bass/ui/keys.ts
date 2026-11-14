import type { BassAction } from "../engine/host";

/**
 * Ce qu'une touche du clavier du navigateur fait dans le jeu. Les actions du moteur sont celles de ScummVM (`metaengine.cpp`) : Échap
 * (`skip` : passe l'introduction, ferme le panneau), point (`skipLine` : passe la réplique), P (`pause`), F5 (`panel` : panneau de
 * contrôle, appelé « Options » dans le jeu d'origine). Toute autre touche est transmise comme `key` : elle reprend le jeu en pause
 * (`_keyPressed`) et le moteur l'ignore sinon.
 *
 * Ajouts du site : F1 ouvre le menu du site (sauvegarde, chargement, volume, pause, aide, écran titre) et F10 règle le volume de la
 * musique ; Ctrl / Cmd + touche, Alt + lettre, Tab, F11 et F12 restent au navigateur.
 */
export type KeyAction =
  /** Commande de l'hôte (fenêtres) : le moteur ne la voit pas. */
  | { type: "host"; command: HostCommand }
  /** Action transmise au moteur. */
  | { type: "engine"; action: BassAction };

/** Commandes de l'hôte : le menu du site (F1), le volume (F10). */
export type HostCommand = "menu" | "volume";

/** Ce que l'on lit d'un événement clavier. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

const HOST_KEYS: Readonly<Record<string, HostCommand>> = { F1: "menu", F10: "volume" };

const ENGINE_KEYS: Readonly<Record<string, BassAction>> = { Escape: "skip", ".": "skipLine", p: "pause", P: "pause", F5: "panel" };

/** Touches de modification ou de composition : jamais transmises (elles ne reprennent pas non plus la pause). */
const IGNORED = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock", "NumLock", "ScrollLock", "Dead", "Unidentified", "Process", "Tab", "F11", "F12"]);

/** Vrai si le navigateur garde la touche (raccourci du navigateur ou du système, navigation au clavier, plein écran). */
function browserKeeps(event: KeyLike): boolean {
  if (event.ctrlKey || event.metaKey || IGNORED.has(event.key)) return true;
  // Alt + lettre est un raccourci du navigateur ou du système, pas un caractère du jeu.
  return event.altKey && event.key.length === 1;
}

/** Traduction d'une touche : commande de l'hôte, action du moteur, ou `null` si le navigateur la garde. */
export function keyAction(event: KeyLike): KeyAction | null {
  if (browserKeeps(event)) return null;
  const command = HOST_KEYS[event.key];
  if (command) return { type: "host", command };
  return { type: "engine", action: ENGINE_KEYS[event.key] ?? "key" };
}
