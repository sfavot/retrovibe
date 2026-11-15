/**
 * Menu principal (`MAINMENU.ITF`, 422b70), écran de `ui/itf-window.ts`. Six modes en images (`MAINMENU.ANM`), Options, Quitter, Aide, et une bande de
 * texte (`MM_TEXT`) : 4233a3 cherche le contrôle sous la souris et le texte de `DESCRIPT.RES` d'identifiant `contrôle + 100`
 * (seuls les six modes en ont un : 16110 à 16115) ; 423473 l'écrit (police `SYS12.PFT`, couleur 15, drapeaux 0x302), ou rien.
 *
 * Ce que fait chaque bouton (422e31 : le choix ferme le menu, puis 422e31(choix + 10000) lance le mode) :
 * - Jeu (16010) : mode Jeu sur le puzzle en cours (42cbad(−1)), puis la fiche `PUZZDISP` (4230e5 → 425d20) ;
 * - Labo (16011) : mode Labo (423038) ;
 * - Duel (16012), Inscription (16014), Exercice avec le professeur (16015) : deux joueurs, inscription des joueurs, travaux dirigés
 *   (mode 6) ; non portés, grisés, « non disponible » comme la barre d'outils ;
 * - Manuel on-line (16013) : le manuel (4169c8(0), `TIMHELP.EXE`) ; le port ouvre l'aide du site, comme le livre de la barre ;
 * - Aide (16008, « ? ») : 4169c8(10) ouvre la rubrique 10 du même manuel Windows. Le port ouvre à la place l'aide du professeur
 *   (`HELP.ITF`, comme le « ? » de la barre, `MainMenuHelp`) par-dessus le menu, qui reste ouvert : son « ? » passe le menu en mode
 *   aide, et l'élément désigné est expliqué par le texte de `HELP.RES` du contrôle (le fichier a ceux des boutons du menu, 16001 à
 *   16018) ;
 * - Options (16018) : fenêtre des préférences (42aa60), puis retour au menu ;
 * - Quitter (16016) : « Désirez-vous quitter? » (31113, Oui / Non, 422f00), toujours posée ; Oui : accueil du site, ou jeu relancé
 *   sur la page de dev.
 * Entrée : Jeu (450d44, défaut 16010) ; Échap : Quitter (annulation 16016).
 */
import type { Itf } from "../data/itf";
import type { RenderAssets } from "../render/assets";
import type { FrameSound } from "../render/front";
import { ITF_DEFAULT_FONT, drawTextBox } from "../render/itf-draw";
import type { Surface } from "../render/surface";
import { copy } from "../copy";
import type { ItfScreen, ItfWindow, ItfWindowOptions } from "./itf-window";

export const MAIN_MENU = {
  play: 16010,
  lab: 16011,
  duel: 16012,
  manual: 16013,
  signIn: 16014,
  tutorial: 16015,
  quit: 16016,
  text: 16017,
  options: 16018,
  help: 16008,
} as const;

export type MainMenuAction = "play" | "lab" | "help" | "options" | "quit" | "unavailable";

const ACTIONS: Readonly<Record<number, MainMenuAction>> = {
  [MAIN_MENU.play]: "play",
  [MAIN_MENU.lab]: "lab",
  [MAIN_MENU.duel]: "unavailable",
  [MAIN_MENU.manual]: "help",
  [MAIN_MENU.signIn]: "unavailable",
  [MAIN_MENU.tutorial]: "unavailable",
  [MAIN_MENU.quit]: "quit",
  [MAIN_MENU.options]: "options",
  [MAIN_MENU.help]: "help",
};

/** Modes non portés (grisés). */
export const MAIN_MENU_GREYED: readonly number[] = [MAIN_MENU.duel, MAIN_MENU.signIn, MAIN_MENU.tutorial];

/** Modes animés au survol. */
const MODES: readonly number[] = [MAIN_MENU.play, MAIN_MENU.lab, MAIN_MENU.duel, MAIN_MENU.manual, MAIN_MENU.signIn, MAIN_MENU.tutorial];

/** Texte de `DESCRIPT.RES` d'un bouton du menu : identifiant du contrôle + 100 (423410). */
export const MAIN_MENU_TEXT_OFFSET = 100;
/** 423473 : drapeaux du texte (retour à la ligne, bloc centré, centré en hauteur), couleur logique 15. */
const TEXT_FLAGS = 0x302;
const TEXT_COLOR = 15;
/** « Désirez-vous quitter? » (`INTRFACE.RES`, 422f00). */
export const QUIT_TEXT = 31113;

export function mainMenuAction(id: number): MainMenuAction | undefined {
  return ACTIONS[id];
}

/**
 * Quitter (422f00) : la question 31113 (Oui / Non) est toujours posée. Oui : `leave` (accueil du site, ou jeu relancé sur la page
 * de dev : `leaveGame`) ; Non : `stay` (retour au menu).
 */
export function quitMainMenu(ask: (text: number, yes: () => void, no: () => void) => void, leave: () => void, stay: () => void): void {
  ask(QUIT_TEXT, leave, stay);
}

/** Aide du professeur ouverte depuis le menu (« ? ») et mode aide du menu (`ItfWindowOptions.helpMode`). */
export interface MainMenuHelp {
  open(): void;
  picking(): boolean;
  pick(ids: number[]): void;
  cancel(): void;
  /** Texte annoncé pendant le mode aide. */
  prompt: string;
}

export interface MainMenuTexts {
  title: string;
  /** Texte de `DESCRIPT.RES` par identifiant. */
  describe(id: number): string | undefined;
}

export class MainMenuScreen implements ItfScreen<MainMenuAction> {
  readonly options: Omit<ItfWindowOptions, "choose" | "onClose">;

  constructor(
    assets: RenderAssets,
    readonly itf: Itf,
    private readonly strings: MainMenuTexts,
    onSound?: (sound: FrameSound) => void,
    private readonly help?: MainMenuHelp,
  ) {
    // Noms du calque : le texte du mode (contrôle + 100) ; les autres boutons gardent leur infobulle.
    const labels: Record<number, string> = {};
    for (const id of MODES) {
      const text = strings.describe(id + MAIN_MENU_TEXT_OFFSET);
      if (text) labels[id] = text;
    }
    this.options = {
      title: strings.title,
      state: { disabled: MAIN_MENU_GREYED },
      defaultId: MAIN_MENU.play,
      // 450d44 : Échap choisit Quitter (drapeau 0x20), qui pose la question 31113.
      cancelId: MAIN_MENU.quit,
      greyedActive: true,
      labels,
      hoverAnimate: { ids: MODES, ...(onSound ? { sound: onSound } : {}) },
      status: (win) => (help?.picking() ? help.prompt : this.bandText(win)),
      ...(help ? { helpMode: { active: () => help.picking(), pick: (ids: number[]) => help.pick(ids), cancel: () => help.cancel() } } : {}),
      decorate: (surface, win) => this.drawBand(surface, win, assets),
    };
  }

  action(id: number): MainMenuAction | undefined {
    if (id === MAIN_MENU.help && this.help) {
      this.help.open();
      return undefined;
    }
    return mainMenuAction(id);
  }

  /**
   * Texte de la bande `MM_TEXT` (4233a3) : le texte `DESCRIPT.RES` d'identifiant « contrôle + 100 » du bouton actif (survolé, sinon
   * celui qui a le focus), suivi de « (non disponible) » s'il est grisé. Seuls les six modes en ont un (16110 à 16115) : pour Aide,
   * Options et Quitter, ou hors des boutons, la bande est vide (423473 ne dessine rien quand 4233a3 ne trouve pas de texte).
   */
  bandText(win: Pick<ItfWindow, "active" | "greyed">): string {
    const id = win.active();
    const text = id === null ? undefined : this.strings.describe(id + MAIN_MENU_TEXT_OFFSET);
    if (id === null || !text) return "";
    return win.greyed(id) ? copy.toolbarUnavailable(text) : text;
  }

  private drawBand(surface: Surface, win: ItfWindow, assets: RenderAssets): void {
    const r = win.rect(MAIN_MENU.text);
    const font = assets.font(ITF_DEFAULT_FONT);
    const text = this.bandText(win);
    if (!r || !font || !text) return;
    drawTextBox(surface, font, text, { x: r.x, y: r.y + 1, width: r.width, height: r.height }, { mode: 0, color: TEXT_COLOR, flags: TEXT_FLAGS, font: ITF_DEFAULT_FONT });
  }
}
