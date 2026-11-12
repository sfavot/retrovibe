import type { LureAction } from "../engine/host";

/**
 * Ce qu'une touche du clavier du navigateur fait dans le jeu. Les actions du moteur sont celles de la carte de touches de ScummVM
 * pour *Lure of the Temptress*, version française (`engines/lure/metaengine.cpp`, `initKeymaps`) : F5 sauvegarder, F7 restituer, F9
 * recommencer (avec la confirmation du jeu), Échap (fermer un menu, passer l'introduction, demander à quitter) ; dans un menu
 * surgissant (verbes, choix des dialogues) flèche haut ou pavé 8 pour monter, flèche bas ou pavé 2 pour descendre, pavé 3 pour valider ;
 * O et N pour « Vous êtes sûr (o/n) ? » (Y n'est pas associée en français) ; pendant un combat flèches gauche et droite pour avancer et
 * reculer, pavé 7, 4, 1 puis 9, 6, 3 pour les six coups (tenues jusqu'au relâchement, `keyReleaseAction`).
 *
 * Écarts et ajouts du site : Entrée valide aussi dans un menu (les claviers sans pavé numérique n'ont pas de pavé 3) ; le pavé 3 sert
 * aux combats et aux menus (`orElse` : l'hôte choisit selon qu'un combat est en cours) ; sauvegarder, restituer et recommencer ouvrent les
 * fenêtres communes ou la confirmation du jeu ; F1 ouvre le menu du site (sauvegarde, chargement, volume, pause, aide, écran titre),
 * F10 règle le volume (F9 est « recommencer » dans le jeu : le volume du site passe en F10) et Espace met en pause.
 * Le pavé numérique se lit par position (`code`) : il marche avec ou sans verrouillage numérique.
 */
export type KeyAction =
  /** Commande de l'hôte (fenêtres, pause) : le moteur ne la voit pas. */
  | { type: "host"; command: HostCommand }
  /** Action transmise au moteur ; `orElse` : l'action à envoyer à la place si `action` n'a pas de sens (pavé 3 : coup de combat ou validation). */
  | { type: "engine"; action: LureAction; orElse?: LureAction };

/** Commandes de l'hôte : le menu du site (F1), le volume (F10), la pause (Espace). */
export type HostCommand = "menu" | "volume" | "pause";

/** Ce que l'on lit d'un événement clavier. */
export interface KeyLike {
  key: string;
  /** Position physique de la touche (`KeyboardEvent.code`) : le pavé numérique, que le verrouillage numérique change en flèches. */
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

const HOST_KEYS: Readonly<Record<string, HostCommand>> = { F1: "menu", F10: "volume", " ": "pause" };

const KEY_ACTIONS: Readonly<Record<string, LureAction>> = {
  Escape: "escape",
  F5: "saveGame",
  F7: "restoreGame",
  F9: "restartGame",
  ArrowUp: "indexPrevious",
  ArrowDown: "indexNext",
  Enter: "indexSelect",
  ArrowLeft: "fightMoveLeft",
  ArrowRight: "fightMoveRight",
  o: "yes",
  n: "no",
};

/** Pavé numérique des combats : 7, 4, 1 (haut, milieu, bas) puis 9, 6, 3, par position. */
const FIGHT_CODES: Readonly<Record<string, LureAction>> = {
  Numpad7: "fightCursorLeftTop",
  Numpad4: "fightCursorLeftMiddle",
  Numpad1: "fightCursorLeftBottom",
  Numpad9: "fightCursorRightTop",
  Numpad6: "fightCursorRightMiddle",
  Numpad3: "fightCursorRightBottom",
};

/** Pavé numérique des menus : 8 monte, 2 descend (le 3 valide, voir `FIGHT_CODES`). */
const INDEX_CODES: Readonly<Record<string, LureAction>> = { Numpad8: "indexPrevious", Numpad2: "indexNext" };

/** Touches de modification ou de composition : jamais transmises. */
const IGNORED = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock", "NumLock", "ScrollLock", "Dead", "Unidentified", "Process", "Tab", "F11", "F12"]);

/** Vrai si le navigateur garde la touche (raccourci du navigateur ou du système, navigation au clavier, plein écran). */
function browserKeeps(event: KeyLike): boolean {
  if (event.ctrlKey || event.metaKey || IGNORED.has(event.key)) return true;
  // Alt + lettre est un raccourci du navigateur ou du système, pas un caractère du jeu.
  return event.altKey && event.key.length === 1;
}

/** Action du moteur d'une touche (hors commandes de l'hôte) : le pavé numérique par position, le reste par le nom de la touche. */
function engineAction(event: KeyLike): LureAction | undefined {
  const fromCode = event.code ? (INDEX_CODES[event.code] ?? FIGHT_CODES[event.code]) : undefined;
  if (fromCode) return fromCode;
  // Un pavé numérique sans verrouillage donne `ArrowLeft`… avec le code `Numpad4` : le code l'a déjà pris ci-dessus.
  return KEY_ACTIONS[event.key] ?? KEY_ACTIONS[event.key.toLowerCase()];
}

/**
 * Traduction d'une touche : commande de l'hôte, action du moteur, ou `null` si le navigateur la garde (Ctrl / Cmd + touche, Tab pour
 * naviguer au clavier, F11 et F12) ou si elle ne sert à rien dans le jeu.
 */
export function keyAction(event: KeyLike): KeyAction | null {
  if (browserKeeps(event)) return null;
  const command = HOST_KEYS[event.key];
  if (command) return { type: "host", command };
  const action = engineAction(event);
  if (!action) return null;
  return event.code === "Numpad3" ? { type: "engine", action, orElse: "indexSelect" } : { type: "engine", action };
}

/**
 * Action de combat dont la touche vient d'être relâchée (`EVENT_CUSTOM_ENGINE_ACTION_END`), ou `null`. Le moteur tient ces actions
 * enfoncées jusqu'à là : sans le relâchement, le combattant marcherait sans fin.
 */
export function keyReleaseAction(event: KeyLike): LureAction | null {
  // Les modificateurs ne comptent pas ici : une touche tenue doit être relâchée même si Ctrl a été pressé entre-temps.
  const action = engineAction(event);
  return action?.startsWith("fight") ? action : null;
}
