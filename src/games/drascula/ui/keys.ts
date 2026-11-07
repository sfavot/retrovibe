/** Ce qu'une touche du clavier du navigateur fait dans le jeu. */
export type KeyAction =
  /** Commande de l'hôte (fenêtres, sous-titres, pause) : le moteur ne la voit pas. */
  | { type: "host"; command: HostCommand }
  /** Touche transmise au moteur, nommée comme `KeyboardEvent.key`. */
  | { type: "engine"; key: string };

/** Commandes de l'hôte : `kActionSaveGame` (F10), `kActionLoadGame` (F7), le volume (F9), les sous-titres (T), la pause (Espace). */
export type HostCommand = "save" | "load" | "volume" | "subtitles" | "pause";

/** Ce que l'on lit d'un événement clavier. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

const HOST_KEYS: Readonly<Record<string, HostCommand>> = { F10: "save", F7: "load", F9: "volume", t: "subtitles", T: "subtitles", " ": "pause" };

/** Touches de modification ou de composition : jamais transmises. */
const IGNORED = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock", "NumLock", "ScrollLock", "Dead", "Unidentified", "Process", "Tab", "F11", "F12"]);

/**
 * Traduction d'une touche : commande de l'hôte, touche du moteur, ou `null` si le navigateur la garde (Ctrl / Cmd + touche, Tab pour
 * naviguer au clavier, F11 et F12). Espace est la pause, à tout moment.
 */
export function keyAction(event: KeyLike): KeyAction | null {
  if (event.ctrlKey || event.metaKey || IGNORED.has(event.key)) return null;
  // Alt + lettre est un raccourci du navigateur ou du système, pas un caractère du jeu.
  if (event.altKey && event.key.length === 1) return null;
  const command = HOST_KEYS[event.key];
  if (command) return { type: "host", command };
  return { type: "engine", key: event.key };
}
