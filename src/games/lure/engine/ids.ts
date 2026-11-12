/**
 * Numéros du moteur : champs du script, états des personnages, actions de la pile, curseurs, gestionnaires de tick, hotspots nommés.
 *
 * Source (ScummVM, GPL v3+) : `luredefs.h`, `res_struct.h` (`FieldName`, `CharacterMode`, `CurrentAction`…), `room.h` (`CursorState`),
 * `game.h` (`GameState`), `hotspots.h` (`HotspotPrecheckResult`). Les noms de ScummVM sont gardés pour qu'on retrouve le code de
 * référence ; les numéros des données (ressources, verbes) sont dans `data/ids.ts`.
 */

/** Champs nommés de la table des valeurs (`FieldName`) ; la table en compte `NUM_VALUE_FIELDS`. */
export const Field = {
  ROOM_NUMBER: 0,
  CHARACTER_HOTSPOT_ID: 1,
  USE_HOTSPOT_ID: 2,
  ACTIVE_HOTSPOT_ID: 3,
  SEQUENCE_RESULT: 4,
  GENERAL: 5,
  GIVE_TALK_INDEX: 6,
  NEW_ROOM_NUMBER: 7,
  OLD_ROOM_NUMBER: 8,
  CELL_DOOR_STATE: 9,
  TORCH_HIDE: 10,
  PRISONER_DEAD: 15,
  BOTTLE_FILLED: 18,
  TALK_INDEX: 19,
  SACK_CUT: 20,
  ROOM_EXIT_ANIMATION: 76,
  AREA_FLAG: 82,
} as const;

export const NUM_VALUE_FIELDS = 90;

/** États d'un personnage (`CharacterMode`). */
export const CharacterMode = {
  NONE: 0,
  HESITATE: 1,
  IDLE: 2,
  PAUSED: 3,
  WAIT_FOR_PLAYER: 4,
  CONVERSING: 5,
  PLAYER_WAIT: 6,
  WAIT_FOR_INTERACT: 7,
  INTERACTING: 8,
  SPECIAL_PLAYER: 9,
} as const;

export const BlockedState = { NONE: 0, INITIAL: 1, FINAL: 2 } as const;

/** `VariantBool` : `coveredFlag` d'un hotspot (case de cheminement occupée). */
export const Covered = { INITIAL: 0, FALSE: 1, TRUE: 2 } as const;

/** Action en tête de la pile d'un personnage (`CurrentAction`). */
export const CurrentAction = {
  NO_ACTION: 0,
  START_WALKING: 1,
  DISPATCH_ACTION: 2,
  EXEC_HOTSPOT_SCRIPT: 3,
  PROCESSING_PATH: 4,
  WALKING: 5,
} as const;

/** `CursorState` de la pièce. */
export const CursorState = { NONE: 0, ACTION: 1, SEQUENCE: 2, TALKING: 3, BUMPED: 4 } as const;

/** Curseurs (`CursorType`), indices de la ressource 1. */
export const Cursor = {
  ARROW: 0,
  DISK: 1,
  TIME_START: 2,
  TIME_END: 9,
  CROSS: 10,
  UP_ARROW: 11,
  DOWN_ARROW: 12,
  LEFT_ARROW: 13,
  RIGHT_ARROW: 14,
  CAMERA: 15,
  TALK: 16,
  MENUBAR: 17,
  FIGHT_UPPER: 23,
  FIGHT_MIDDLE: 24,
  FIGHT_LOWER: 25,
} as const;

/** Drapeaux de l'état du jeu (`GameState`). */
export const GameState = {
  ERROR: 1,
  TICK: 2,
  TOCK: 4,
  PROT: 8,
  RESTART: 0x10,
  CAUGHT: 0x20,
  RESTORE: 0x40,
  FLOPPY: 0x80,
  RESTORE_RESTART: 0x50,
} as const;

/** Résultat de `actionPrecheck` (`HotspotPrecheckResult`). */
export const Precheck = { EXECUTE: 0, NOT_IN_ROOM: 1, FAILED: 2, WAIT: 3, EXCESS: 4 } as const;
export type PrecheckResult = (typeof Precheck)[keyof typeof Precheck];

/** Réponses de la barre de menus (`MENUITEM_*`). */
export const MenuItem = {
  NONE: 0,
  CREDITS: 1,
  RESTART_GAME: 2,
  SAVE_GAME: 3,
  RESTORE_GAME: 4,
  QUIT: 5,
  TEXT_SPEED: 6,
  SOUND: 7,
} as const;

/** Gestionnaires de tick nommés par ScummVM (`*_TICK_PROC*`) ; la table complète est `handlers/catalog.ts`. */
export const TickProc = {
  NULL: 1,
  STANDARD_CHARACTER: 2,
  PLAYER: 3,
  VOICE: 4,
  PUZZLED: 5,
  ROOM_EXIT: 6,
  FOLLOWER: 7,
  FOLLOWER_2: 8,
  JAILOR: 9,
  STANDARD_ANIM_2: 11,
  STANDARD_ANIM: 12,
  GOEWIN_SHOP: 27,
  TALK: 37,
  PLAYER_FIGHT: 39,
} as const;

/** Drapeaux de `HotspotData.flags` et `RoomData.flags`. */
export const HotspotFlag = { FOUND: 0x80, SKIP: 0x40, MENU_EXCLUSION: 0x20, ROOM_SPECIFIC: 0x10 } as const;

/** Hotspots nommés par ScummVM (`luredefs.h`). */
export const HotspotId = {
  NOONE: 0x3e7,
  PLAYER: 0x3e8,
  RATPOUCH: 0x3e9,
  SKORL: 0x3ea,
  BLACKSMITH: 0x3eb,
  GWEN: 0x3ec,
  MALLIN: 0x3ed,
  MONK1: 0x3ee,
  GOEWIN: 0x3ef,
  MONK2: 0x3f0,
  WAYNE: 0x3f1,
  CASTLE_SKORL: 0x3f3,
  FIRST_NONCHARACTER: 0x408,
  SACK: 0x40d,
  RACK_SERF: 0x411,
  PRISONER: 0x412,
  SID: 0x420,
  OIL_BURNER: 0x424,
  TRANSFORM: 0x425,
  NELLIE: 0x429,
  EWAN: 0x436,
  PIG: 0x43f,
  SKORL_FIGHTER: 0x444,
  START_EXIT: 0x2710,
  BOTTLE: 0x2710,
  CELL_DOOR: 0x2712,
  BRICKS: 0x2714,
  BOOK: 0x2723,
  START_NONVISUAL: 0x7530,
} as const;

/** Identifiants des hotspots créés par le moteur (bulle de parole, perplexité) : pas d'enregistrement de données. */
export const VOICE_HOTSPOT_ID = 0xffff;
export const PUZZLED_HOTSPOT_ID = 0xfffe;

/** Objets spéciaux du constructeur `Hotspot(character, objType)`. */
export const SpecialAnim = { VOICE: 1, PUZZLED: 2, EXCLAMATION: 3 } as const;

/** Indices (rang dans `0x3F0B`) d'animations nommées. */
export const AnimIndex = {
  PLAYER_FIGHT: 10,
  VOICE: 21,
  BLACKSMITH_HAMMERING: 22,
  EWAN: 23,
  EWAN_ALT: 24,
  PLAYER: 32,
  SELENA: 34,
  BLACKSMITH_DEFAULT: 35,
} as const;

/** Script de démarrage (`STARTUP_SCRIPT`). */
export const STARTUP_SCRIPT = 0x23fc;

export const CONVERSE_COUNTDOWN_SIZE = 40;
export const IDLE_COUNTDOWN_SIZE = 15;
export const MAX_TELL_COMMANDS = 8;
export const GENERAL_MAGIC_ID = 42;
/** Nombre d'actions au plus dans la pile d'un personnage (`CurrentActionStack::validateStack`). */
export const MAX_PENDING_ACTIONS = 20;

/** Pièces nommées. */
export const RoomNum = { VILLAGE_SHOP: 35, CAVE: 38, CELLAR: 42, DINING_HALL: 45 } as const;

/** Entrées d'emplois du temps nommées (`*_SUPPORT_ID`). */
export const SupportId = {
  RETURN: 0x400,
  EXIT_BLOCKED: 0x800,
  JUMP_ADDR_2: 0x1403,
  GOEWIN_CAVE: 0x1800,
  GOEWIN_STANDARD: 0x1c00,
} as const;

/** Géométrie de l'écran et des boîtes (`luredefs.h`, `surface.cpp`). */
export const FULL_SCREEN_WIDTH = 320;
export const FULL_SCREEN_HEIGHT = 200;
export const MENUBAR_Y_SIZE = 8;
export const FONT_WIDTH = 8;
export const FONT_HEIGHT = 8;
export const INFO_DIALOG_X = 69;
export const INFO_DIALOG_Y = 61;
export const INFO_DIALOG_WIDTH = 191;
export const TALK_DIALOG_WIDTH = 130;
export const TALK_DIALOG_Y = 33;
/** Marges du texte dans une boîte VGA (`Surface::textX`, `textY`). */
export const DIALOG_TEXT_X = 12;
export const DIALOG_TEXT_Y = 12;

/** Fin de liste et absence de valeur dans les tables. */
export const NONE_16 = 0xffff;
