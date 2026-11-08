/** Numéros de `defs.h` (ScummVM) et du jeu utilisés par le groupe 5 : pièces, objets, états, bobs, banques. */

export const Room = {
  /** Le combat final dans la Vallée (`ROOM_FINAL_FIGHT`). */
  FinalFight: 69,
} as const;

/** État sans nom dans ScummVM, posé à 1 quand le combat démarre (`asmStartFightAnimation`, `gameState(148, 1)`). */
export const FIGHT_STARTED = 148;
/** Plus d'Ironstein dans la pièce (`asmMakeFrankGrowing`, `gameState(157, 1)`). */
export const NO_MORE_IRONSTEIN = 157;

/**
 * Objets de la pièce 69 dont `asmMakeFrankGrowing` et `asmMakeRobotGrowing` allument ou éteignent le nom (négatif : éteint).
 * Commentaires de ScummVM.
 */
export const FightObject = {
  /** « Dinoray » : le pistolet à rayon dino. */
  Dinoray: 521,
  /** Objet « TMPD » (éteint). */
  Tmpd: 522,
  /** Objet de Sparky (éteint). */
  Sparky: 523,
  /** Objet d'Azura (éteint quand le robot grandit). */
  Azura: 524,
  /** Les gardes de la Flöda (éteints). */
  FlodaGuards: 525,
  /** Objet de Frank (allumé quand Frank grandit, éteint quand le robot grandit). */
  Frank: 526,
} as const;

/** Bobs de la scène : le grandissement de Frank ou du robot (5), le robot du mouvement 13 (6), le dirigeable (7), l'écran de fin (20), l'avion et l'éclair du mouvement 28 (5, 20, 6), Azura et Joe du baiser (5, 6). */
export const Bob = {
  Grower: 5,
  Robot: 6,
  Blimp: 7,
  Ending: 20,
  Plane: 5,
  Fire: 6,
  Lightning: 20,
  Azura: 5,
  Joe: 6,
} as const;

/** Emplacement de la banque des objets de la pièce, source des `unpack` (`ROOM_BANK_SLOT`) et image où Frank ou le robot est posé (la première image hors de Joe). */
export const ROOM_BANK = 15;
export const GROWER_FRAME = 38;
