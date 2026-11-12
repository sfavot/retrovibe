/**
 * Numéros nommés des combats (`fights.h`, `luredefs.h` de ScummVM) : adresses dans la ressource `0x3F16`, mouvements, hotspots.
 */

/** Adresses dans les données de combat (`FIGHT_TBL_1`, `FIGHT_PLAYER_MOVE_TABLE`, `FIGHT_PLAYER_INIT`, `FIGHT_PLAYER_DIES`). */
export const FightData = {
  TABLE_1: 0x8b8,
  PLAYER_MOVE_TABLE: 0xdaa,
  PLAYER_INIT: 0xdc8,
  PLAYER_DIES: 0xf46,
} as const;

/** Distance (en pixels, multiple de 8) à laquelle un coup porte (`FIGHT_DISTANCE`). */
export const FIGHT_DISTANCE = 32;

/** Rang des trois combattants dans la liste de `FighterRecord` (joueur, cochon, Skorl). */
export const FighterIndex = { PLAYER: 0, PIG: 1, SKORL: 2 } as const;

/** Hotspots des combats : armes (haches, épées) et objet donné au joueur par le cochon. */
export const FightHotspot = {
  PLAYER_WEAPON: 0x440,
  PIG_WEAPON: 0x441,
  SKORL_WEAPON: 0x446,
  SKORL_FIGHT_PLAYER_WEAPON: 0x445,
  AXE: 0x2738,
} as const;

/** Texte affiché quand le cochon est tué dans la pièce 6 (`Dialog::show(0xc9f)`). */
export const PIG_KILLED_TEXT = 0xc9f;
export const PIG_ROOM = 6;

/** Sons des combats (`Sound.addSound`). */
export const FightSound = { BLOCK: 42, PLAYER_HITS: 52, ENEMY_HITS: 37, PLAYER_DIES: 36 } as const;

/** Numéros de coup (`FighterRecord.fwmove_number`) : marche, coups hauts, moyens et bas, de la droite et de la gauche de la souris. */
export const FightMove = {
  RIGHT_BUTTON_WALK_LEFT: 5,
  RIGHT_TOP: 6,
  RIGHT_MIDDLE: 7,
  RIGHT_BOTTOM: 8,
  RIGHT_BUTTON_WALK_RIGHT: 9,
  WALK_LEFT: 10,
  LEFT_TOP: 11,
  LEFT_MIDDLE: 12,
  LEFT_BOTTOM: 13,
  WALK_RIGHT: 14,
} as const;

/**
 * Actions du clavier propres aux combats, nommées comme `kActionFight*` (lure.h) : les touches (flèches gauche et droite, pavé 7 4 1 9 6 3)
 * sont une affaire de l'hôte (`ui/keys.ts`).
 */
export const FIGHT_ACTION_MOVES: Readonly<Record<string, number>> = {
  fightMoveLeft: FightMove.WALK_LEFT,
  fightMoveRight: FightMove.WALK_RIGHT,
  fightCursorLeftTop: FightMove.LEFT_TOP,
  fightCursorLeftMiddle: FightMove.LEFT_MIDDLE,
  fightCursorLeftBottom: FightMove.LEFT_BOTTOM,
  fightCursorRightTop: FightMove.RIGHT_TOP,
  fightCursorRightMiddle: FightMove.RIGHT_MIDDLE,
  fightCursorRightBottom: FightMove.RIGHT_BOTTOM,
};
