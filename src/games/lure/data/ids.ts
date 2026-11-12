/**
 * Numéros du jeu : identifiants de ressources, verbes, actions des personnages, curseurs, identifiants de personnages.
 *
 * Source : `luredefs.h` (engines/lure, ScummVM, GPL v3+) ; les noms de ScummVM sont gardés en anglais, repris tels quels pour qu'on retrouve
 * le code de référence.
 */

/** Ressources de `lure.dat` (`0x3Fxx`). */
export const ResId = {
  gamePalette: 0x3f01,
  altPalette: 0x3f02,
  dialogFrame: 0x3f03,
  talkDialogFrame: 0x3f04,
  roomData: 0x3f05,
  npcSchedules: 0x3f06,
  hotspotData: 0x3f07,
  hotspotOverrides: 0x3f08,
  roomExits: 0x3f09,
  roomExitJoins: 0x3f0a,
  animData: 0x3f0b,
  scriptData: 0x3f0c,
  script2Data: 0x3f0d,
  hotspotScriptList: 0x3f0e,
  messagesList: 0x3f0f,
  actionList: 0x3f10,
  talkHeader: 0x3f11,
  talkData: 0x3f12,
  roomPaths: 0x3f13,
  exitCoordinates: 0x3f14,
  exitHotspotIds: 0x3f15,
  fightData: 0x3f16,
  stringList: 0x3f17,
  soundDesc: 0x3f18,
  stringDecoder: 0x3f19,
  audioInitIcon: 0x3f1a,
} as const;

/** Ressources des disques. */
export const DiskResId = {
  cursors: 1,
  /** Police alternative de même taille que `font` (920 octets), jamais lue par ScummVM. */
  fontAlt: 3,
  font: 4,
  /** Barre de menus (image compressée, 320 x 8). */
  menu: 5,
  names: 9,
  strings: 0x10,
  strings2: 0x11,
  strings3: 0x12,
  /** Sons : Roland (SysEx `0x0B`, principale `0x0C`, introduction `0x30`, fin `0xFF10`) et AdLib (`0x0D`, `0x31`, `0xFF11`). */
  rolandMainSysex: 0x0b,
  rolandMainSound: 0x0c,
  adlibMainSound: 0x0d,
  rolandIntroSound: 0x30,
  adlibIntroSound: 0x31,
  rolandEndgameSound: 0xff10,
  adlibEndgameSound: 0xff11,
  /** Palettes et animations plein écran. */
  skorlCatchPalette: 0x4060,
  skorlCatchAnim: 0x4061,
  chutePalette: 0x404c,
  chuteAnim: 0x404d,
  chute2Anim: 0x404f,
  chute3Anim: 0x4051,
  barrelPalette: 0xe9f0,
  barrelAnim: 0xe9f1,
  endgamePalette: 0xff00,
  endgameAnim: 0xff01,
  /** Protection de copie (non portée, D2), générique, écran de redémarrage. */
  copyProtection: 0x4139,
  credits: 0x7800,
  restart: 0x7900,
  /** Palette de l'introduction (collection de sous-palettes de 64 couleurs). */
  introPalettes: 0x32,
} as const;

/** Verbes (`Action`) : l'indice de `0x3F17` est `action - 1`. */
export const Action = {
  NONE: 0,
  GET: 1,
  PUSH: 3,
  PULL: 4,
  OPERATE: 5,
  OPEN: 6,
  CLOSE: 7,
  LOCK: 8,
  UNLOCK: 9,
  USE: 10,
  GIVE: 11,
  TALK_TO: 12,
  TELL: 13,
  BUY: 14,
  LOOK: 15,
  LOOK_AT: 16,
  LOOK_THROUGH: 17,
  ASK: 18,
  DRINK: 20,
  STATUS: 21,
  GO_TO: 22,
  RETURN: 23,
  BRIBE: 24,
  EXAMINE: 25,
  /** Actions de personnages non joueurs (emplois du temps, `0x3F06`). */
  NPC_SET_ROOM_AND_OFFSET: 28,
  NPC_TALK_TO_PLAYER: 29,
  NPC_EXEC_SCRIPT: 30,
  NPC_RESET_PAUSED_LIST: 31,
  NPC_SET_RAND_DEST: 32,
  NPC_WALKING_CHECK: 33,
  NPC_SET_SUPPORT_OFFSET: 34,
  NPC_SUPPORT_OFFSET_COND: 35,
  NPC_DISPATCH_ACTION: 36,
  NPC_TALK_NPC_TO_NPC: 37,
  NPC_PAUSE: 38,
  NPC_START_TALKING: 39,
  NPC_JUMP_ADDRESS: 40,
} as const;

/** Nombre de paramètres de chaque action d'emploi du temps (`actionNumParams`, res_struct.cpp), indexé par numéro d'action. */
export const SCHEDULE_ACTION_PARAMS: readonly number[] = [
  0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 1, 1, 2, 0, 1, 0, 1, 1, 1, 1, 0, 0, 2, 1, 1, 0, 0, 1, 1, 2, 2, 5, 2, 2, 1,
];

/** Directions (`Direction`). */
export const Direction = { UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3, NONE: 4 } as const;

/** Curseurs de la ressource 1 (`CursorType`) : 26 images de 16 x 16. */
export const CURSOR_WIDTH = 16;
export const CURSOR_HEIGHT = 16;
export const CURSOR_SIZE = CURSOR_WIDTH * CURSOR_HEIGHT;

/** Identifiants de personnages (hotspots `0x3E7` et suivants). */
export const NOONE_ID = 0x3e7;
export const PLAYER_ID = 0x3e8;
export const RATPOUCH_ID = 0x3e9;
export const SKORL_ID = 0x3ea;
export const FIRST_NONCHARACTER_ID = 0x408;

/** Indices de `0x3F17` (`StringEnum`). */
export const UiString = {
  CREDITS: 25,
  RESTART_GAME: 26,
  SAVE_GAME: 27,
  RESTORE_GAME: 28,
  QUIT: 29,
  FAST_TEXT: 30,
  SLOW_TEXT: 31,
  SOUND_ON: 32,
  SOUND_OFF: 33,
  ACTION_NOTHING: 34,
  FOR: 35,
  TO: 36,
  ON: 37,
  AND_THEN: 38,
  FINISH: 39,
  CONFIRM_YN: 40,
  YOU_ARE_CARRYING: 41,
  INV_NOTHING: 42,
  YOU_HAVE: 43,
  GROAT: 44,
  GROATS: 45,
  /** Premier article ; l'article `n` (1 à 10) est à `ARTICLE_LIST + n - 1`. */
  ARTICLE_LIST: 46,
} as const;
