import type { FotaqAction } from "../engine/host";

/**
 * Ce qu'une touche du clavier du navigateur fait dans le jeu. Les touches sont celles de ScummVM pour *Flight of the Amazon Queen*
 * (`engines/queen/metaengine.cpp`, `initKeymaps`), version française : les verbes sont les lettres de `CommandKeys[FR]`
 * (`"ofdnepau"` : Ouvrir, Fermer, Déplacer, doNner, Examiner, Prendre, Adresser la parole, Utiliser), les cases de l'inventaire 1 à 4,
 * `,` et `.` font défiler l'inventaire, Échap passe une cinématique ou un dialogue, F1 et F5 ouvrent le journal (ici le menu du jeu).
 * Écarts : Espace est la pause (dans ScummVM, il passe un texte : c'est ici Entrée), la sauvegarde et le chargement rapides
 * (F11 et F12) sont F10 et F7 (F11 est le plein écran du navigateur) et ouvrent la liste des emplacements, F9 règle le volume ;
 * le mode rapide (Ctrl+F) n'existe pas (le moteur ne l'active que par la logique du jeu).
 */
export type KeyAction =
  /** Commande de l'hôte (fenêtres, pause) : le moteur ne la voit pas. */
  | { type: "host"; command: HostCommand }
  /** Action transmise au moteur. */
  | { type: "engine"; action: FotaqAction };

/** Commandes de l'hôte : sauvegarder (F10), charger (F7), le volume (F9), la pause (Espace). */
export type HostCommand = "save" | "load" | "volume" | "pause";

/** Ce que l'on lit d'un événement clavier. */
export interface KeyLike {
  key: string;
  /** Position physique de la touche (`KeyboardEvent.code`) : les chiffres et la ponctuation, que les claviers AZERTY déplacent. */
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

const HOST_KEYS: Readonly<Record<string, HostCommand>> = { F10: "save", F7: "load", F9: "volume", " ": "pause" };

/** Lettres des verbes (français), en minuscules. */
export const VERB_KEYS: Readonly<Record<string, FotaqAction>> = { o: "open", f: "close", d: "move", n: "give", e: "look", p: "pickUp", a: "talk", u: "use" };

const KEY_ACTIONS: Readonly<Record<string, FotaqAction>> = {
  Enter: "skipText",
  Escape: "skipCutaway",
  F1: "journal",
  F5: "journal",
  ",": "scrollUp",
  ".": "scrollDown",
};

/** Cases de l'inventaire : la rangée de chiffres (par position, donc aussi sur AZERTY) et le pavé numérique. */
const SLOT_CODES: Readonly<Record<string, FotaqAction>> = {
  Digit1: "inventory1",
  Digit2: "inventory2",
  Digit3: "inventory3",
  Digit4: "inventory4",
  Numpad1: "inventory1",
  Numpad2: "inventory2",
  Numpad3: "inventory3",
  Numpad4: "inventory4",
  Comma: "scrollUp",
  Period: "scrollDown",
};

/** Touches de modification ou de composition : jamais transmises. */
const IGNORED = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock", "NumLock", "ScrollLock", "Dead", "Unidentified", "Process", "Tab", "F11", "F12"]);

/**
 * Traduction d'une touche : commande de l'hôte, action du moteur, ou `null` si le navigateur la garde (Ctrl / Cmd + touche, Tab pour
 * naviguer au clavier, F11 et F12) ou si elle ne sert à rien dans le jeu. Espace est la pause, à tout moment.
 */
export function keyAction(event: KeyLike): KeyAction | null {
  if (event.ctrlKey || event.metaKey || IGNORED.has(event.key)) return null;
  // Alt + lettre est un raccourci du navigateur ou du système, pas un caractère du jeu.
  if (event.altKey && event.key.length === 1) return null;
  const command = HOST_KEYS[event.key];
  if (command) return { type: "host", command };
  const action = KEY_ACTIONS[event.key] ?? VERB_KEYS[event.key.toLowerCase()] ?? (event.code ? SLOT_CODES[event.code] : undefined);
  return action ? { type: "engine", action } : null;
}
