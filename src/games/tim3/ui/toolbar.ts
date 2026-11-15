/**
 * Barre d'outils du haut (`WTOOLBAR.ITF`), sans DOM : boutons montrés selon le mode, bouton du mode enfoncé, boutons non
 * portés grisés, et ce que fait un clic (confirmation d'origine comprise).
 *
 * TIMWIN.EXE : 418b78 cache ou montre les boutons selon le mode (`[0x477988]` : 0 Jeu, 1 Labo, 8 Labo en essai) puis enfonce
 * le bouton du mode passé par l'appelant (4197c7) ; 418ded aiguille les clics (identifiants 35001 à 35022). Le port n'a que
 * deux modes : Jeu (un puzzle ouvert) et Labo.
 *
 * - Toujours montrés : les six modes de gauche, musique, valeurs globales, balayette, aide, drapeau.
 * - Jeu : disquette et indices ; cadenas, essai du Labo (`TB_TEST`), visite et fin de tour cachés ; l'ampoule
 *   « Montrer la solution » (x = 540) seulement si le puzzle a déjà été résolu (42d210), sinon l'emplacement reste vide.
 * - Labo : disquette, indices, cadenas et levier d'essai montrés ; ampoule, visite et fin de tour cachées.
 *
 * Le jeu ne grise jamais un bouton (il les cache) : les boutons montrés mais non portés sont grisés par le port.
 */

/** Boutons que le port peut montrer, de gauche à droite ; `TB_TEST` (Labo) et `TB_SOLUTION` (Jeu) partagent x = 540. */
export const TOOLBAR_NAMES = [
  "TB_GOTO_PUZ",
  "TB_GOTO_WORK",
  "TB_GOTO_H2H",
  "TB_GOTO_TOUR",
  "TB_GOTO_SIGNIN",
  "TB_GOTO_TUTORIAL",
  "TB_DISK",
  "TB_MUSIC",
  "TB_GLOBAL",
  "TB_SWEEP",
  "TB_HELP",
  "TB_HINT",
  "TB_LOCKED",
  "TB_TEST",
  "TB_SOLUTION",
  "TB_FLAG",
] as const;

export type ToolbarName = (typeof TOOLBAR_NAMES)[number];

/** Ce que la barre doit savoir de l'écran. */
export interface ToolbarContext {
  /** Labo (sinon Jeu : un puzzle ouvert). */
  lab: boolean;
  /** Le puzzle ouvert a déjà été résolu (`Progress`) : l'ampoule apparaît. */
  solved: boolean;
  /** La machine est en marche (drapeau enfoncé). */
  running: boolean;
}

/** Bouton montré : enfoncé (mode courant, drapeau en marche), grisé (non porté). */
export interface ToolbarButtonState {
  name: ToolbarName;
  pressed: boolean;
  disabled: boolean;
}

/** Modes montrés mais non portés : deux joueurs, visite guidée, inscription. Le manuel (`TIMHELP.EXE`, hors jeu) ouvre l'aide du site. */
const UNPORTED: ReadonlySet<ToolbarName> = new Set(["TB_GOTO_H2H", "TB_GOTO_SIGNIN", "TB_GOTO_TUTORIAL"]);
/** Labo : cadenas (verrouiller les pièces), levier d'essai (mode 8) et indices (éditeur d'indices 41f3dc) non portés. */
const LAB_UNPORTED: ReadonlySet<ToolbarName> = new Set(["TB_LOCKED", "TB_TEST", "TB_HINT"]);

/** Boutons montrés (418b78), de gauche à droite. */
export function toolbarStates(ctx: ToolbarContext): ToolbarButtonState[] {
  const mode: ToolbarName = ctx.lab ? "TB_GOTO_WORK" : "TB_GOTO_PUZ";
  const out: ToolbarButtonState[] = [];
  for (const name of TOOLBAR_NAMES) {
    if (!ctx.lab && (name === "TB_LOCKED" || name === "TB_TEST")) continue;
    if (name === "TB_SOLUTION" && (ctx.lab || !ctx.solved)) continue;
    out.push({
      name,
      pressed: name === mode || (name === "TB_FLAG" && ctx.running),
      disabled: UNPORTED.has(name) || (ctx.lab && LAB_UNPORTED.has(name)),
    });
  }
  return out;
}

/** Identifiants de `INTRFACE.RES` des confirmations de la barre (418ded). */
export const TOOLBAR_TEXT = {
  /** 0x7aa5 : Puzzle depuis le Labo. */
  openPlay: 31397,
  /** 0x7aa6 : clé depuis le Jeu. */
  openLab: 31398,
  /** 0x7995 : ampoule. */
  showSolution: 31125,
  /** 0x799e : balayette au Labo quand l'aire n'est pas vide (et Puzzle / clé quand le Labo a été modifié). */
  clearLab: 31134,
} as const;

export type ToolbarAction = "none" | "unavailable" | "play" | "lab" | "machines" | "chooser" | "options" | "globals" | "clear" | "help" | "hints" | "solution" | "run";

export interface ToolbarDecision {
  action: ToolbarAction;
  /** Confirmation à demander d'abord : identifiant de `INTRFACE.RES` (Oui / Non). */
  confirm?: number;
}

/**
 * Clic sur un bouton (418ded). `fieldEmpty` : l'aire du Labo n'a aucune pièce (la balayette n'a rien à effacer).
 *
 * - Puzzle : rien en Jeu (419466 renfonce le bouton) ; depuis le Labo, 31397 puis le Jeu. Le jeu montre 31134 à la place
 *   quand le Labo a été modifié (`[0x477950]`), parce qu'il le perd ; le port garde la machine du Labo (D11), donc 31397.
 * - Clé : rien au Labo ; depuis le Jeu, 31398 puis le Labo.
 * - Balayette : en Jeu, l'aire est remise sans question (43252d) ; au Labo, 31134 si l'aire n'est pas vide (419405).
 * - Ampoule : 31125 puis la solution du concepteur (43252d avec le mode 9).
 * - Disquette : en Jeu, le choix du puzzle (418f2c : `DOSBOX` en chargement seulement) ; au Labo, les machines (42289c demande
 *   charger ou enregistrer).
 */
export function toolbarDecision(name: string, ctx: ToolbarContext & { fieldEmpty: boolean }): ToolbarDecision {
  const state = toolbarStates(ctx).find((b) => b.name === name);
  if (!state) return { action: "none" };
  if (state.disabled) return { action: "unavailable" };
  switch (state.name) {
    case "TB_GOTO_PUZ":
      return ctx.lab ? { action: "play", confirm: TOOLBAR_TEXT.openPlay } : { action: "none" };
    case "TB_GOTO_WORK":
      return ctx.lab ? { action: "none" } : { action: "lab", confirm: TOOLBAR_TEXT.openLab };
    case "TB_DISK":
      return { action: ctx.lab ? "machines" : "chooser" };
    case "TB_MUSIC":
      return { action: "options" };
    case "TB_GLOBAL":
      return { action: "globals" };
    case "TB_SWEEP":
      if (ctx.running) return { action: "none" };
      return ctx.lab && !ctx.fieldEmpty ? { action: "clear", confirm: TOOLBAR_TEXT.clearLab } : { action: "clear" };
    case "TB_HELP":
    case "TB_GOTO_TOUR":
      return { action: "help" };
    case "TB_HINT":
      return { action: "hints" };
    case "TB_SOLUTION":
      return ctx.running ? { action: "none" } : { action: "solution", confirm: TOOLBAR_TEXT.showSolution };
    case "TB_FLAG":
      return { action: "run" };
    default:
      return { action: "unavailable" };
  }
}
