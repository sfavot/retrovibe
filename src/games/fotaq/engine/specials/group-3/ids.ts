/** Numéros de `defs.h` (ScummVM) et du jeu utilisés par le groupe 3 : pièces, états, réponses de Joe, cinématiques. */

export const Room = {
  /** Les zombies (`ROOM_TEMPLE_ZOMBIES`, `T9`). */
  Zombies: 50,
  /** Le serpent (`ROOM_TEMPLE_SNAKE`, `T12`). */
  Snake: 53,
  /** Les rayons du lézard (`ROOM_TEMPLE_LIZARD_LASER`, `T14`). */
  LizardLaser: 55,
  /** Le labyrinthe, cinquième pièce (`ROOM_TEMPLE_MAZE_5`, `T26`). */
  Maze5: 100,
  /** Le labyrinthe, sixième pièce (`ROOM_TEMPLE_MAZE_6`, `T27`). */
  Maze6: 101,
} as const;

/** `VAR_BYPASS_ZOMBIES` : 0 les zombies n'ont pas encore parlé à Joe, 1 ils lui ont déjà parlé (`GameVar.BypassZombies`). */
export const BYPASS_ZOMBIES = 21;
/** État 187 : le levier de la pièce 100 est tiré (le passage de la pièce 101 est ouvert). */
export const LEVER_PULLED = 187;

/** Zones éteintes qui déclenchent une réaction. */
export const ZOMBIES_AREA = 6;
export const MAZE5_AREA = 7;
export const MAZE6_AREA = 5;

/** Cinématiques lancées par les zones éteintes. */
export const Cut = {
  ZombiesFirst: "C50D.CUT",
  ZombiesAgain: "C50H.CUT",
  Snake: "C53B.CUT",
  Maze6: "C101B.CUT",
} as const;

/** Réponses de Joe (`makeJoeSpeak`). */
export const JoeSays = {
  /** Pièce 55, rayons mortels. */
  LizardLaser: 19,
  /** Pièce 100, zone 7. */
  Maze5: 17,
  /** Description d'objet 226 (`makeJoeSpeak(226, true)`) : Joe se plaint du puzzle de la pièce 102 après quatre erreurs. */
  PuzzleHint: 226,
} as const;

/** Le puzzle de la pièce 102 se plaint à la quatrième tentative (`asmAttemptPuzzle`). */
export const PUZZLE_ATTEMPTS = 4;

/** Ordonnée minimale/maximale du défilement (`Display::horizontalScroll`) et abscisse de Joe au centre de l'écran. */
export const SCROLL_MAX = 320;
export const SCREEN_HALF = 160;
/** Pas des panoramiques 20 et 24. */
export const PAN_STEP = 16;
