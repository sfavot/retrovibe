/**
 * Textes du jeu tenus par l'exécutable (et non par les fichiers MSG) : verbes, prépositions, messages d'échec, menu système.
 *
 * Référence : ScummVM engines/cine/texte.cpp (`failureMessages_FR`, `defaultActionCommand_FR`, `commandPrepositionTable_FR`,
 * `systemMenu_FR`, `confirmMenu_FR`, `otherMessages_FR`), tables relevées par ScummVM dans `FWARS.EXE` (GPL v3 ou ultérieure).
 * Texte d'origine du jeu, conservé tel quel (fautes et espaces compris), en Unicode : la police l'attend en CP437 (`encodeCp437`).
 *
 * Écart volontaire : l'entrée « Lecteur de Svg. A: » du menu système, sans effet, est gardée dans la table (indices de ScummVM) mais
 * le menu du port la retire (D9) : voir `SYSTEM_MENU_ENTRIES`.
 */

/** Verbes (`defaultActionCommand`), index = `playerCommand`. */
export const VERBS = ["EXAMINER", "PRENDRE", "INVENTAIRE", "UTILISER", "ACTIONNER", "PARLER"] as const;

/** Préposition de chaque verbe (`commandPrepositionTable`) ; « sur » sert à UTILISER (`defaultCommandPreposition`). */
export const PREPOSITIONS = ["", "", "", "sur", "", "a"] as const;
export const DEFAULT_PREPOSITION = PREPOSITIONS[3];

/** Nombre d'objets attendus par verbe (`choiceResultTable`). */
export const CHOICE_RESULT = [1, 1, 1, 2, 1, 1, 1] as const;

/** Messages d'échec : 4 par verbe (`failureMessages_FR`). */
export const FAILURE_MESSAGES = [
  // EXAMINER
  "Je ne vois rien de special.",
  "Il n'y a rien d'intéressant.",
  "Cela présente peu d'intérêts.",
  "Vous ne trouvez rien.",
  // PRENDRE
  "Je ne peux pas prendre cela.",
  "Cela me semble difficile",
  "Je ne vois pas ce qu'il y a à prendre",
  "j'ai du mal à vous suivre.",
  // INVENTAIRE
  "C'est inutile",
  "Vous avez mieux à faire",
  "Allons, ne perdons pas de temps",
  "ça ne me semble pas être une bonne idée",
  // UTILISER
  "Je ne vois pas pourquoi je ferais cela.",
  "C'est absolument sans effets",
  "Cela n'amenerait à rien",
  "Essayez de trouver autre chose.",
  // ACTIONNER
  "Ca ne marche pas",
  "Supposons que vous essayez et n'en parlons plus.",
  "Rien n'y fait.",
  "Vous avez mieux à faire.",
  // PARLER
  "Vous lui parlez . Sans réponse.",
  "Plus d'actes et moins de Paroles !",
  "Je serais bien surpris si vous obteniez une réponse.",
  "Un mur de silence ...",
] as const;

/** Menu système d'origine (`systemMenu_FR`), indices de ScummVM. */
export const SYSTEM_MENU = ["Pause", "Nouvelle partie", "Quitter", "Lecteur de Svg. A:", "Charger une partie", "Sauver la partie"] as const;

/** Confirmation (`confirmMenu_FR`) : 0 = oui. */
export const CONFIRM_MENU = ["Ok , Vas-y ...", "Surtout Pas !"] as const;

/** `otherMessages_FR[2]` : affiché pendant la pause. */
export const PAUSE_MESSAGE = "PAUSE";
