import { OBJECT_COUNT } from "../data/exe";

/**
 * État d'une partie d'Astérix : la structure du joueur (`DS:64b3 + 25 × j`) et les globales de partie de
 * `docs/asterix/engine.md` §7. Données pures (JSON), sans rendu : c'est ce que la sauvegarde écrit.
 */

/** Types de case de `DS:1d81` (engine.md §9.2). */
export const SQUARE = {
  rest: 0,
  prison: 1,
  spy: 2,
  trap: 3,
  detritus: 4,
  potion: 5,
  game: 6,
  country: 7,
  merchant: 8,
  soothsayer: 9,
  surprise: 10,
} as const;

/** Personnages (`+0x00`) : seul Obélix a des règles à lui (il ne boit pas de potion). */
export const OBELIX = 1;

export const MAX_PLAYERS = 4;
export const MAX_GOURDS = 5;
export const MAX_SESTERCES = 99;

export interface Player {
  /** `+0x00` : 0 Astérix, 1 Obélix, 2 Bonemine, 3 Agecanonix, 4 Falbala, 5 Goudurix. */
  character: number;
  /** `+0x02` : niveau Réflexion, 0 facile, 1 moyen, 2 difficile. */
  reflexion: number;
  /** `+0x04` : niveau Action. */
  action: number;
  /** `+0x06` : position 0..53. */
  pos: number;
  /** `+0x08` : nombre d'objets acquis. */
  objectCount: number;
  /** `+0x0a` : drapeaux des objets, un par pays. */
  objects: boolean[];
  /** `+0x13` : sesterces, 0..99. */
  sesterces: number;
  /** `+0x15` : gourdes de potion, 0..5. */
  gourds: number;
  /** `+0x17` : en prison. */
  inPrison: boolean;
}

export function createPlayer(character: number, reflexion = 1, action = 1): Player {
  return {
    character,
    reflexion,
    action,
    pos: 0,
    objectCount: 0,
    objects: new Array<boolean>(OBJECT_COUNT).fill(false),
    sesterces: 0,
    // `1abf:13e5` : dotation de `3 − niveau Réflexion`.
    gourds: 3 - reflexion,
    inPrison: false,
  };
}

export interface GameState {
  /** `DS:64b3` : les joueurs en jeu (`DS:648f` = leur nombre), dans l'ordre d'inscription. */
  players: Player[];
  /** `DS:648d` : joueur courant. */
  current: number;
  /** `DS:6487` : numéro du tour de table, 1 au départ. */
  round: number;
  /** `DS:1f9d` : durée de la partie en secondes. */
  duration: number;
  /** `DS:1f9f` : nombre d'objets à rapporter. */
  objectsRequired: number;
  /** `DS:1fa1` : face courante du dé, conservée d'un tour à l'autre. */
  die: number;
  /** `DS:6491` : dernière valeur lue des secondes écoulées. */
  elapsedRead: number;
  /** `DS:6493` : rangée affichée en haut de l'écran de jeu, 0..17. */
  topRow: number;
  /** `DS:6489` : indice du parieur du devin, −1 sans pari ; `DS:648b` : nombre parié. */
  bettor: number;
  bet: number;
  /** `DS:64a5` : vainqueur. */
  winner: number;
  /** `DS:64a7` : un joueur vient d'abandonner (remis à faux à chaque tour). */
  abandoned: boolean;
  /** `DS:64a8` : fin demandée (FIN, abandon du dernier joueur). */
  quit: boolean;
  /** `DS:64a9` : victoire d'un joueur. */
  victory: boolean;
  /** `DS:64aa` : partie terminée (victoire ou temps écoulé). */
  over: boolean;
  /** `DS:64ab` : dernier tour de table. */
  lastRound: boolean;
  /** `DS:64ac` : vrai avant le premier tour de table. */
  beforeFirstRound: boolean;
  /** `DS:64ad` : partie lancée par REJOUER. */
  replay: boolean;
  /** `DS:6912` : présentation de début de partie à faire. */
  intro: boolean;
}

/** Configuration gardée pour REJOUER (`DS:6485`, `6479`, `646d`, `6461`, `645f`, `645d`). */
export interface SavedSetup {
  players: { character: number; reflexion: number; action: number }[];
  duration: number;
  objectsRequired: number;
}

/**
 * Mémoires que le programme ne remet jamais à zéro entre deux parties (engine.md §6.3) : elles vivent tant que la page
 * reste ouverte (décision D13) et ne vont pas dans la sauvegarde d'une partie.
 */
export interface Session {
  /** `DS:7592` : dernier tour joué par Détritus. */
  lastDetritus: number;
  /** `DS:6b56` : dernière introduction de l'espion. */
  lastSpyIntro: number;
  /** `DS:7182` : dernière question tirée, par `pays × 3 + niveau`. */
  lastQuestion: number[];
  /** `DS:2aa6` : variante d'annonce de chaque mini-jeu. */
  announceVariant: number[];
  /** `DS:1ff4` : dernière voix d'annonce du tour. */
  lastAnnounce: number;
  /** `DS:219a` : secondes écoulées lors du dernier commentaire de score. */
  lastComment: number;
  /** `DS:1a02` : aucune vraie partie n'a encore été lancée. */
  noGameYet: boolean;
  /** `DS:2198` : dernière rangée affichée par l'écran de jeu, −1 au départ. */
  shownRow: number;
  /** `DS:2a00` (M24) : dernier tirage `rnd() & 7` de la Loupe. */
  lastLoupeDraw: number;
  /** `DS:245a` (M25) : dernière image des Anachronismes. */
  lastAnachronism: number;
  /** `DS:6ad8` (M35) : dernier dessin des Coloriages tiré à chaque niveau Réflexion. */
  lastColouring: number[];
  /** `DS:1f9d`, `DS:1f9f` : derniers réglages (ceux de l'image au lancement). */
  duration: number;
  objectsRequired: number;
  saved: SavedSetup;
}

export function createSession(defaults: { duration: number; objectsRequired: number }): Session {
  return {
    lastDetritus: 0,
    lastSpyIntro: 0,
    lastQuestion: new Array<number>(27).fill(0),
    announceVariant: new Array<number>(15).fill(0),
    lastAnnounce: 0,
    lastComment: 0,
    noGameYet: true,
    shownRow: -1,
    lastLoupeDraw: 0,
    lastAnachronism: 0,
    lastColouring: [0, 0, 0],
    duration: defaults.duration,
    objectsRequired: defaults.objectsRequired,
    saved: { players: [], duration: defaults.duration, objectsRequired: defaults.objectsRequired },
  };
}
