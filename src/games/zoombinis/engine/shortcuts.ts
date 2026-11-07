/**
 * Raccourcis clavier généraux de Zoombinis (`1198:05b3`, `docs/zoombinis/engine.md` §7.2, `docs/zoombinis/screens.md` §5.2) : touches non
 * consommées par l'écran (gestionnaire « après » du moteur). Les actions de menu (nouvelle partie, charger, enregistrer) ne sont actives que
 * sur les écrans 1 à 18 ; les bascules d'options affichent leur message de `STRL` 2023 (`1168:2117` : plaque au bas de l'écran pendant 90 ticks).
 *
 * Touches (la lettre tapée compte, pas la touche physique : clavier AZERTY compris) :
 *  - `Ctrl+N` nouvelle partie ; `Ctrl+C` / `Ctrl+L` charger ; `Ctrl+S` enregistrer ; `Ctrl+Q` quitter ;
 *  - `Ctrl+V` / `Ctrl+B` musique (`DS:a43b`, messages « musique activée / désactivée »), `Ctrl+Y` voix et effets (`DS:a43a`, « sonores … ») : le code, pas les libellés
 *    du menu (« Dialogues & effets (ctrl v) », « Musique de fond (ctrl y) ») ;
 *  - `Ctrl+T` transitions, `Ctrl+J` souris aimantée (sans effet dans le navigateur), `Ctrl+U` auto-aimantation, `Ctrl+G` « moins d'action », `Ctrl+H` curseur ;
 *  - `Ctrl+I` « À propos » (`1198:0213`) ; `/` et `?` ouvrent le menu.
 * `Ctrl+D`, `Ctrl+E` et `Ctrl+F` (changement de langue, `11a0:4346`) et le mode de test caché sont sans objet. `Ctrl+R` (enregistrer dans l'original, aussi) reste au navigateur.
 *
 * Écart : l'original affiche « curseur masqué / affiché » d'après `DS:a43d`, dont la seule lecture (`1168:58c7`, `10f8:6cdf`) masque le pointeur
 * **pendant le transport d'une pièce** ; le curseur n'est donc pas masqué partout et aucun type de curseur « caché » n'est ajouté. L'option `hideCursorWhileCarrying`
 * a le sens de `DS:a43d` (voir `docs/zoombinis/engine-ts.md`).
 */
import type { KeyEvent } from "../../../engine/mohawk/input";
import type { ZoombinisContext } from "./context";
import { DIALOG, letterOf, type OptionKey } from "./dialog";
import type { ZoombinisEngine } from "./engine";
import { defineService } from "./scene";

/** Message de `STRL` 2023 (indice 1-based) et plaque (`1168:2117`, type 1 ou 2) de chaque bascule, d'après la nouvelle valeur de l'option. */
const OPTION_MESSAGES: Readonly<Record<OptionKey, { type: 0 | 1 | 2; message: (value: boolean) => number }>> = {
  music: { type: 2, message: (on) => (on ? 1 : 2) },
  effects: { type: 2, message: (on) => (on ? 3 : 4) },
  lessAction: { type: 2, message: (less) => (less ? 5 : 6) },
  hideCursorWhileCarrying: { type: 1, message: (hide) => (hide ? 7 : 8) },
  magneticMouse: { type: 2, message: (on) => (on ? 9 : 10) },
  transitionsOff: { type: 2, message: (off) => (off ? 12 : 11) },
  autoMagnet: { type: 2, message: (on) => (on ? 13 : 14) },
};

/** Lettre (avec Ctrl) → option basculée. */
const OPTION_KEYS: Readonly<Record<string, OptionKey>> = {
  v: "music",
  b: "music",
  y: "effects",
  t: "transitionsOff",
  j: "magneticMouse",
  u: "autoMagnet",
  g: "lessAction",
  h: "hideCursorWhileCarrying",
};

/** Lettres des raccourcis `Ctrl+lettre` du jeu (options, menu, `1198:05b3`) et `Ctrl+W` des mascottes du choix (`1128:05dc`). */
const CTRL_LETTERS = new Set([...Object.keys(OPTION_KEYS), "n", "c", "l", "s", "q", "i", "w"]);

/**
 * Vrai si `Ctrl+touche` est un raccourci du jeu : l'hôte du navigateur empêche alors l'action par défaut quand il le peut
 * (`Ctrl+N`, `Ctrl+T` et `Ctrl+W` restent au navigateur sous Windows et Linux, qui ne les cède pas).
 */
export function isShortcutCtrlKey(event: { key: string }): boolean {
  return event.key.length === 1 && CTRL_LETTERS.has(event.key.toLowerCase());
}

export class Shortcuts {
  /** Traite une touche non consommée ; vrai si c'est un raccourci. */
  handle(ctx: ZoombinisContext, event: KeyEvent): boolean {
    const dialogs = ctx.services.get(DIALOG);
    if (!event.ctrl && !event.alt && (event.key === "/" || event.key === "?")) {
      dialogs.openMenu(ctx);
      return true;
    }
    if (!event.ctrl || event.alt) return false;
    const letter = letterOf(event);
    if (letter === null) return false;
    const option = OPTION_KEYS[letter];
    if (option) {
      const value = dialogs.toggleOption(ctx, option);
      const { message, type } = OPTION_MESSAGES[option];
      dialogs.showMessage(ctx, message(value), type);
      return true;
    }
    switch (letter) {
      case "n":
        dialogs.newGame(ctx);
        return true;
      case "c":
      case "l":
        dialogs.openLoad(ctx);
        return true;
      case "s":
        dialogs.openSave(ctx);
        return true;
      case "q":
        dialogs.quit(ctx);
        return true;
      case "i":
        dialogs.openAbout(ctx);
        return true;
      default:
        return false;
    }
  }
}

export const SHORTCUTS = defineService<Shortcuts>("zoombinis.shortcuts");

/**
 * Ajoute le gestionnaire de touches « après l'écran » (après `installDialog`, qui prend les touches pendant qu'une boîte est ouverte). Sans effet si déjà installé.
 * Le moteur commun ne permet pas d'empêcher l'action par défaut du navigateur : c'est l'hôte (`ui/mohawk/browser-host.ts`, `gameOwnsKey`) qui décide.
 */
export function installShortcuts(engine: ZoombinisEngine): Shortcuts {
  const existing = engine.services.tryGet(SHORTCUTS);
  if (existing) return existing;
  const shortcuts = new Shortcuts();
  engine.services.provide(SHORTCUTS, shortcuts);
  engine.addKeyHandler("after", (event, ctx) => shortcuts.handle(ctx, event));
  return shortcuts;
}
