/**
 * Barre d'outils du haut (`WTOOLBAR.ITF`), sans DOM : boutons montrés selon le mode, bouton du mode enfoncé, et ce que fait un clic
 * (confirmation d'origine comprise).
 *
 * TIMWIN.EXE : 418b78 cache ou montre les boutons selon le mode (`[0x477988]` : 0 Jeu, 1 Labo, 2 deux joueurs, 6 visite guidée,
 * 8 Labo en essai) puis enfonce le bouton du mode passé par l'appelant (4197c7) ; 418ded aiguille les clics (identifiants 35001 à
 * 35022). Le port a les mêmes cinq modes : Jeu (un puzzle ouvert, du jeu ou maison), Labo, l'essai du Labo, deux joueurs et la visite.
 *
 * - Toujours montrés : les six modes de gauche, musique, valeurs globales, balayette, aide, drapeau.
 * - Jeu : disquette et indices ; cadenas, essai du Labo (`TB_TEST`), professeur de la visite et fin de tour cachés ; l'ampoule
 *   « Montrer la solution » (x = 540) seulement si le puzzle a déjà été résolu (42d210), sinon l'emplacement reste vide.
 * - Labo : disquette, indices, cadenas et levier d'essai montrés ; ampoule, visite et fin de tour cachées.
 * - Essai (mode 8, 418ca4) : les boutons du Labo, levier d'essai enfoncé (418d91).
 * - Deux joueurs (mode 2, 418cc4) : comme en Jeu, avec « Terminer le Tour » (`TB_END_TURN`, x = 522) ; pas d'ampoule ; chat et Tim
 *   (`TB_GOTO_H2H`) enfoncés.
 * - Visite guidée (mode 6, 418c34) : la barre du Labo sans disquette, main, cadenas ni levier d'essai ; à leur place, x = 540, le
 *   portrait du professeur (`TB_WALKTHROUGH`, état 17) ; chaussure (`TB_GOTO_TUTORIAL`) enfoncée (4189bc(35013)).
 *
 * Le jeu ne grise jamais un bouton (il les cache) ; tous les boutons montrés sont portés.
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
  "TB_WALKTHROUGH",
  "TB_END_TURN",
  "TB_FLAG",
] as const;

export type ToolbarName = (typeof TOOLBAR_NAMES)[number];

/** Ce que la barre doit savoir de l'écran. */
export interface ToolbarContext {
  /** Labo (sinon Jeu : un puzzle ouvert). */
  lab: boolean;
  /** Essai du puzzle maison (mode 8) : la barre du Labo, levier d'essai enfoncé. */
  test?: boolean;
  /** Mode à deux joueurs (mode 2). */
  duel?: boolean;
  /** Visite guidée du Labo (mode 6) : `lab` est vrai aussi. */
  walkthrough?: boolean;
  /** Le puzzle ouvert a déjà été résolu (`Progress`) : l'ampoule apparaît. */
  solved: boolean;
  /** La machine est en marche (drapeau enfoncé). */
  running: boolean;
}

/** Bouton montré : enfoncé (mode courant, drapeau en marche), grisé (aucun : tous sont portés). */
export interface ToolbarButtonState {
  name: ToolbarName;
  pressed: boolean;
  disabled: boolean;
}

/** Boutons cachés pendant la visite guidée (418c34). */
const HIDDEN_IN_WALKTHROUGH: ReadonlySet<ToolbarName> = new Set(["TB_LOCKED", "TB_HINT", "TB_TEST", "TB_DISK"]);

/** Boutons montrés (418b78), de gauche à droite. Le manuel (`TB_GOTO_TOUR`, `TIMHELP.EXE` hors jeu) ouvre l'aide. */
export function toolbarStates(ctx: ToolbarContext): ToolbarButtonState[] {
  const walk = ctx.walkthrough === true;
  const workshop = ctx.lab || ctx.test === true || walk;
  const duel = !workshop && ctx.duel === true;
  const mode: ToolbarName = walk ? "TB_GOTO_TUTORIAL" : workshop ? "TB_GOTO_WORK" : duel ? "TB_GOTO_H2H" : "TB_GOTO_PUZ";
  const out: ToolbarButtonState[] = [];
  for (const name of TOOLBAR_NAMES) {
    if (!workshop && (name === "TB_LOCKED" || name === "TB_TEST")) continue;
    if (walk && HIDDEN_IN_WALKTHROUGH.has(name)) continue;
    if (name === "TB_WALKTHROUGH" && !walk) continue;
    if (name === "TB_SOLUTION" && (workshop || duel || !ctx.solved)) continue;
    if (name === "TB_END_TURN" && !duel) continue;
    out.push({
      name,
      pressed: name === mode || (name === "TB_FLAG" && ctx.running) || (name === "TB_TEST" && ctx.test === true),
      disabled: false,
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
  /** 0x79a7 : première entrée en essai (41913b, `[0x481004]`, une fois par partie). */
  testIntro: 31143,
  /** 0x7aa7 : chat et Tim depuis le Jeu ou le Labo (41960c). */
  openDuel: 31399,
  /** 0x7aa8 : chaussure, hors de la visite (419766). */
  openWalkthrough: 31400,
  /** 0x7aa9 : feuille et stylo (4196ca). */
  openSignIn: 31401,
} as const;

export type ToolbarAction =
  | "none"
  | "play"
  | "lab"
  | "machines"
  | "chooser"
  | "options"
  | "globals"
  | "clear"
  | "help"
  | "hints"
  | "hintEditor"
  | "lock"
  | "test"
  | "solution"
  | "duel"
  | "signIn"
  | "walkthrough"
  | "professor"
  | "endTurn"
  | "run";

export interface ToolbarDecision {
  action: ToolbarAction;
  /** Confirmation à demander d'abord : identifiant de `INTRFACE.RES` (Oui / Non). */
  confirm?: number;
  /** Mode 8 : l'essai se termine d'abord (43252d(fichier, 1), le Labo revient tel qu'avant l'essai). */
  endTest?: boolean;
}

/**
 * Clic sur un bouton (418ded). `fieldEmpty` : l'aire du Labo n'a aucune pièce (la balayette n'a rien à effacer).
 *
 * - Puzzle : rien en Jeu (419466 renfonce le bouton) ; depuis le Labo ou les deux joueurs, 31397 puis le Jeu. Le jeu montre 31134 à la place
 *   quand le Labo a été modifié (`[0x477950]`), parce qu'il le perd ; le port garde la machine du Labo (D11), donc 31397.
 * - Clé : rien au Labo ; depuis le Jeu ou les deux joueurs, 31398 puis le Labo.
 * - Chat et Tim (4195bd) : rien en mode 2 ; ailleurs, 31399 puis la fenêtre des deux joueurs (`HEDTOHED`, par le mode 7 : 422a24).
 * - Terminer le Tour (418e70) : l'échéance du tour est maintenant (le tour passe à la prochaine passe de 4330d0).
 * - Balayette : en Jeu, l'aire est remise sans question (43252d) ; au Labo, 31134 si l'aire n'est pas vide (419405).
 * - Ampoule : 31125 puis la solution du concepteur (43252d avec le mode 9).
 * - Disquette : en Jeu, le choix du puzzle (418f2c : `DOSBOX` en chargement seulement) ; au Labo, les machines (42289c demande
 *   charger ou enregistrer).
 * - Main : en Jeu, les indices (4192ee) ; au Labo, l'éditeur d'indices (4192dc → 41f3dc).
 * - Cadenas (41927c → 420810) : la fenêtre `HTLOCK`. Levier d'essai (41908a) : le Labo passe en essai (mode 8), ou en revient.
 * - Essai (mode 8) : musique, disquette, main, globe, balayette, cadenas et levier terminent d'abord l'essai (418e7f, 418ed1,
 *   41928e, 41930e, 419360, 41923c, 41909b) ; la main s'arrête là (419297 : pas de fenêtre). Aide et drapeau gardent l'essai.
 * - Feuille et stylo (419683) : 31401 puis l'inscription (mode 5), qui mène au menu principal ; chaussure (419712) : rien dans la
 *   visite, ailleurs 31400 puis la visite (mode 6).
 * - Visite guidée : la machine de la visite n'est pas gardée ; Puzzle, clé, chat et Tim, feuille et stylo demandent 31134 si l'aire
 *   n'est pas vide (`[0x477950]` en mode 6 : 41948e, 419538, 4195e5, 41969e), sinon leur question ; le portrait du professeur
 *   (41922f → 41d8e8(0)) rouvre la fenêtre de la visite.
 */
export function toolbarDecision(name: string, ctx: ToolbarContext & { fieldEmpty: boolean }): ToolbarDecision {
  const state = toolbarStates(ctx).find((b) => b.name === name);
  if (!state) return { action: "none" };
  if (ctx.test) return testDecision(state.name, ctx);
  if (ctx.walkthrough) return walkthroughDecision(state.name, ctx);
  switch (state.name) {
    case "TB_GOTO_PUZ":
      return ctx.lab || ctx.duel ? { action: "play", confirm: TOOLBAR_TEXT.openPlay } : { action: "none" };
    case "TB_GOTO_WORK":
      return ctx.lab ? { action: "none" } : { action: "lab", confirm: TOOLBAR_TEXT.openLab };
    case "TB_GOTO_H2H":
      return ctx.duel && !ctx.lab ? { action: "none" } : { action: "duel", confirm: TOOLBAR_TEXT.openDuel };
    case "TB_GOTO_SIGNIN":
      return { action: "signIn", confirm: TOOLBAR_TEXT.openSignIn };
    case "TB_GOTO_TUTORIAL":
      return { action: "walkthrough", confirm: TOOLBAR_TEXT.openWalkthrough };
    case "TB_END_TURN":
      return { action: "endTurn" };
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
      return { action: ctx.lab ? "hintEditor" : "hints" };
    case "TB_LOCKED":
      return ctx.running ? { action: "none" } : { action: "lock" };
    case "TB_TEST":
      return ctx.running ? { action: "none" } : { action: "test" };
    case "TB_SOLUTION":
      return ctx.running ? { action: "none" } : { action: "solution", confirm: TOOLBAR_TEXT.showSolution };
    case "TB_FLAG":
      return { action: "run" };
    default:
      return { action: "none" };
  }
}

/** Mode 6 : quitter la visite perd sa machine (31134 si l'aire n'est pas vide) ; sinon comme au Labo. */
function walkthroughDecision(name: ToolbarName, ctx: ToolbarContext & { fieldEmpty: boolean }): ToolbarDecision {
  const leave = (action: ToolbarAction, confirm: number): ToolbarDecision => ({ action, confirm: ctx.fieldEmpty ? confirm : TOOLBAR_TEXT.clearLab });
  switch (name) {
    case "TB_GOTO_PUZ":
      return leave("play", TOOLBAR_TEXT.openPlay);
    case "TB_GOTO_WORK":
      return leave("lab", TOOLBAR_TEXT.openLab);
    case "TB_GOTO_H2H":
      return leave("duel", TOOLBAR_TEXT.openDuel);
    case "TB_GOTO_SIGNIN":
      return leave("signIn", TOOLBAR_TEXT.openSignIn);
    case "TB_GOTO_TUTORIAL":
      return { action: "none" };
    case "TB_WALKTHROUGH":
      return { action: "professor" };
    default:
      return toolbarDecision(name, { ...ctx, walkthrough: false });
  }
}

/** Mode 8 : chaque bouton qui touche à la machine termine d'abord l'essai (`endTest`), puis agit comme au Labo. */
function testDecision(name: ToolbarName, ctx: ToolbarContext & { fieldEmpty: boolean }): ToolbarDecision {
  if (ctx.running && name !== "TB_FLAG" && name !== "TB_HELP" && name !== "TB_GOTO_TOUR") return { action: "none" };
  switch (name) {
    case "TB_HELP":
    case "TB_GOTO_TOUR":
      return { action: "help" };
    case "TB_FLAG":
      return { action: "run" };
    case "TB_TEST":
    case "TB_HINT":
    case "TB_GOTO_WORK":
      return { action: "none", endTest: true };
    default: {
      const lab = toolbarDecision(name, { ...ctx, lab: true, test: false });
      return { ...lab, endTest: true };
    }
  }
}
