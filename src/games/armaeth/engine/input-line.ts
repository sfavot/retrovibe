/**
 * Ligne de saisie des commandes d'*Armaeth* : automate `1e22:02c2` et ouverture `1023:0016`
 * (`docs/armaeth/parser.md` § 2.2 et § 2.3). Machine d'états pure : aucune horloge, aucun dessin (le clignotement
 * du curseur `_` et la boîte appartiennent à l'interface).
 *
 * Il n'y a ni curseur déplaçable ni insertion au milieu : on ajoute à la fin, on efface le dernier caractère
 * ou toute la ligne ; `cursor` vaut donc toujours la longueur du texte.
 */

/** Longueur maximale de la ligne (`DGROUP:4eb2`). */
export const INPUT_LINE_MAX = 40;

/** Touches reconnues par l'automate (état 6) ; tout autre événement clavier est ignoré. */
export type InputKey =
  | { type: "char"; char: string }
  | { type: "enter" }
  | { type: "escape" }
  | { type: "backspace" }
  /** `Inser` : rappel de la dernière phrase validée. */
  | { type: "insert" }
  /** `Suppr` : efface toute la ligne. */
  | { type: "delete" };

export interface InputLineState {
  /** Boîte de saisie ouverte. */
  open: boolean;
  /** Texte en cours (`DGROUP:4e0c`). */
  text: string;
  /** Position du curseur : toujours la fin du texte. */
  cursor: number;
  /** Dernière phrase validée (`DGROUP:4e5e`), brute (ni minuscules ni accents retirés). */
  history: string;
  /** Phrase transmise à l'analyse, en attente de `finishSubmit` (état 5) : les touches sont ignorées. */
  awaiting: boolean;
}

/** Ce que l'interface doit faire après une touche. */
export type InputEffect =
  | { type: "none" }
  /** Ligne pleine : bip (`3574:0072`, caractère 7). */
  | { type: "bell" }
  /** Phrase validée, à passer à `parseCommand` puis à `finishSubmit`. */
  | { type: "submit"; text: string }
  /** `Échap` : la boîte se ferme sans rien exécuter. */
  | { type: "cancel" };

export interface InputStep {
  state: InputLineState;
  effect: InputEffect;
}

export function createInputLine(): InputLineState {
  return { open: false, text: "", cursor: 0, history: "", awaiting: false };
}

/**
 * Le caractère tapé hors saisie ouvre-t-il la ligne ? Espace, `Entrée`, `Retour arrière`, `Tab` et `Échap` sont
 * ignorés ; `+ = - _` règlent le mouvement vertical du héros (`1023:0016`). Tout autre caractère ouvre la ligne et
 * en est le premier.
 */
export function opensInputLine(char: string): boolean {
  return char.length > 0 && !" \r\b\t\x1b+=-_".includes(char);
}

/** Ouverture par un caractère (`1e22:0008`, `DX = 2`) : la ligne repart vide et reçoit ce caractère. */
export function openInputLine(state: InputLineState, firstChar: string): InputLineState {
  return { ...state, open: true, awaiting: false, ...lineOf(firstChar) };
}

/** Ouverture par `Inser` (`DX = 4`) : la dernière phrase validée est remise dans la ligne. */
export function recallInputLine(state: InputLineState): InputLineState {
  return { ...state, open: true, awaiting: false, ...lineOf(state.history) };
}

function lineOf(text: string): { text: string; cursor: number } {
  const clipped = text.slice(0, INPUT_LINE_MAX);
  return { text: clipped, cursor: clipped.length };
}

/** Une touche à l'état 6 (ligne ouverte, en attente). */
export function handleInputKey(state: InputLineState, key: InputKey): InputStep {
  if (!state.open || state.awaiting) return { state, effect: { type: "none" } };
  switch (key.type) {
    case "char":
      // État 2 : ajoute si la ligne n'est pas pleine, sinon bip.
      if (state.text.length >= INPUT_LINE_MAX) return { state, effect: { type: "bell" } };
      return { state: { ...state, ...lineOf(state.text + key.char) }, effect: { type: "none" } };
    case "backspace":
      return { state: { ...state, ...lineOf(state.text.slice(0, -1)) }, effect: { type: "none" } };
    case "delete":
      return { state: { ...state, ...lineOf("") }, effect: { type: "none" } };
    case "insert":
      return { state: { ...state, ...lineOf(state.history) }, effect: { type: "none" } };
    case "escape":
      return { state: { ...state, open: false }, effect: { type: "cancel" } };
    case "enter":
      // État 5 : `strcpy(4e5e, 4e0c)` même pour une ligne vide (l'historique est alors écrasé par du vide).
      return {
        state: { ...state, history: state.text, awaiting: true },
        effect: { type: "submit", text: state.text },
      };
  }
}

/**
 * Fin de l'état 5, selon le retour de `gm_parse_command` : phrase prise en compte (`done`), la boîte se ferme (état 7) ;
 * sinon (phrase vide, mot inconnu, trois groupes nominaux : voir `needsRetry` de `parser.ts`) la phrase est remise
 * dans la ligne pour correction (état 4).
 */
export function finishSubmit(state: InputLineState, done: boolean): InputLineState {
  if (done) return { ...state, open: false, awaiting: false };
  return { ...state, open: true, awaiting: false, ...lineOf(state.history) };
}
