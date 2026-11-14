/**
 * Numéros du moteur de *Beneath a Steel Sky* : variables de script, types de logique, bits d'état, compacts et scripts nommés, drapeaux
 * système, curseurs, géométrie de l'écran.
 *
 * Référence : ScummVM engines/sky/logic.h (`scriptVariableOffsets`), logic.cpp (`clickTable`, `forwardList*b`), compact.h (`CptIds`),
 * skydefs.h (`L_*`, `ST_*`, `SF_*`, `MOUSE_*`, identifiants de compacts et de scripts), debug.cpp (noms des logiques, des opcodes et
 * des mcodes), GPL v3 ou ultérieure. Les valeurs symboliques de skydefs.h (`(0x3000+0x13d)`…) sont évaluées ici ; elles ne changent pas
 * d'une version CD à l'autre (v0.0372 visée).
 */

/** Version du jeu (`SkyEngine::_systemVars->gameVersion`) : CD 1.2. */
export const GAME_VERSION = 372;

/** `NUM_SKY_SCRIPTVARS`. */
export const NUM_SCRIPT_VARS = 838;

/** Rangs des variables de script nommées par le moteur (`scriptVariableOffsets`). Un script les adresse en octets (`rang * 4`). */
export const Var = {
  RESULT: 0,
  SCREEN: 1,
  LOGIC_LIST_NO: 2,
  SAFE_LOGIC_LIST: 3,
  MOUSE_LIST_NO: 6,
  DRAW_LIST_NO: 8,
  CUR_ID: 12,
  MOUSE_STATUS: 13,
  MOUSE_STOP: 14,
  BUTTON: 15,
  SPECIAL_ITEM: 17,
  GET_OFF: 18,
  CURSOR_ID: 22,
  SAFEX: 25,
  SAFEY: 26,
  PLAYER_X: 27,
  PLAYER_Y: 28,
  PLAYER_MOOD: 29,
  PLAYER_SCREEN: 30,
  HIT_ID: 37,
  LAYER_0_ID: 41,
  LAYER_1_ID: 42,
  LAYER_2_ID: 43,
  LAYER_3_ID: 44,
  GRID_1_ID: 45,
  GRID_2_ID: 46,
  GRID_3_ID: 47,
  THE_CHOSEN_ONE: 51,
  TEXT1: 53,
  FIRST_ICON: 99,
  MENU_LENGTH: 100,
  SCROLL_OFFSET: 101,
  MENU: 102,
  OBJECT_HELD: 103,
  ICON_LIT: 104,
  LAMB_GREET: 109,
  RND: 115,
  CUR_SECTION: 143,
  JOEY_SECTION: 145,
  LAMB_SECTION: 146,
  KNOWS_PORT: 190,
  GOT_SPONSOR: 240,
  GOT_JAMMER: 258,
  CONSOLE_TYPE: 345,
  S15_FLOOR: 450,
  FOREMAN_FRIEND: 451,
  REICH_DOOR_FLAG: 470,
  CARD_STATUS: 479,
  CARD_FIX: 480,
  GUARDIAN_THERE: 640,
  FS_COMMAND: 643,
  ENTER_DIGITS: 644,
  LINC_DIGIT_0: 646,
  /** `LINC_DIGIT_6` vaut aussi 651 dans ScummVM (erreur de table connue, gardée). */
  LINC_DIGIT_5: 651,
  LINC_DIGIT_9: 655,
  DOOR_67_68_FLAG: 678,
  SC70_IRIS_FLAG: 693,
  DOOR_73_75_FLAG: 704,
  SC76_CABINET1_FLAG: 709,
  SC76_CABINET2_FLAG: 710,
  SC76_CABINET3_FLAG: 711,
  DOOR_77_78_FLAG: 719,
  SC80_EXIT_FLAG: 720,
  SC31_LIFT_FLAG: 793,
  SC32_LIFT_FLAG: 797,
  SC33_SHED_DOOR_FLAG: 798,
  BAND_PLAYING: 804,
  COLSTON_AT_TABLE: 805,
  SC36_NEXT_DEALER: 806,
  SC36_DOOR_FLAG: 807,
  SC37_DOOR_FLAG: 808,
  SC40_LOCKER_1_FLAG: 817,
  SC40_LOCKER_2_FLAG: 818,
  SC40_LOCKER_3_FLAG: 819,
  SC40_LOCKER_4_FLAG: 820,
  SC40_LOCKER_5_FLAG: 821,
} as const;

/** Rangs des cinq listes « en avant » recopiées par `initScriptVariables`. */
export const FORWARD_LIST_1 = 352;
export const FORWARD_LIST_2 = 656;
export const FORWARD_LIST_3 = 721;
export const FORWARD_LIST_4 = 663;
export const FORWARD_LIST_5 = 505;

/** `forwardList1b` (v0.0372 ; la liste de la v0.0288 n'est pas portée) : `JOBS_SPEECH`… `DEATH_SCRIPT`. */
export const FORWARD_LIST_1B: readonly number[] = [
  4265, 4258, 4257, 4267, 35, 4182, 4183, 4211, 4213, 44, 8457, 8300, 8461, 8462, 8458, 118, 8460, 8453, 8454, 8456, 8416, 8417, 8337, 8338, 8463, 47,
  48, 49, 50, 12601, 12530, 12531, 12532, 12602, 12603, 12604, 12471, 12472, 12477, 12605, 8464, 12606, 12500, 12607, 12542, 8313, 12587, 12588, 93,
  8246, 8346, 8347, 8358, 8311, 12586, 8312, 91, 0, 0, 56, 57, 92, 59,
];
/** `forwardList2b` : `STD_ON`… `MEGA_ACTION`. */
export const FORWARD_LIST_2B: readonly number[] = [9, 6, 5, 2, 36, 4, 38];
/** `forwardList3b` : `DANI_SPEECH`… `FOSTER_ENTER_COURT`. */
export const FORWARD_LIST_3B: readonly number[] = [
  16385, 16408, 16397, 16386, 16387, 16413, 16405, 16388, 64, 65, 66, 16412, 16398, 16396, 16392, 16389, 67, 68, 16390, 69, 16683,
];
/** `forwardList4b` : `WALTER_SPEECH`… `SC82_JOBS_SSS`. */
export const FORWARD_LIST_4B: readonly number[] = [20481, 20482, 20487, 20489, 20781, 20483, 20787, 20578, 20579, 20853, 20484, 75, 70, 71];
/** `forwardList5b` : `SET_UP_INFO_WINDOW`… `DISCONNECT_FOSTER`. */
export const FORWARD_LIST_5B: readonly number[] = [24585, 24669, 24673, 24674, 24671, 24672, 24591];

/** Types de logique (`L_*`, skydefs.h) ; 0 : aucune (`Logic::nop`). */
export const L = {
  NOP: 0,
  SCRIPT: 1,
  AR: 2,
  AR_ANIM: 3,
  AR_TURNING: 4,
  ALT: 5,
  MOD_ANIMATE: 6,
  TURNING: 7,
  CURSOR: 8,
  TALK: 9,
  LISTEN: 10,
  STOPPED: 11,
  CHOOSE: 12,
  FRAMES: 13,
  PAUSE: 14,
  WAIT_SYNC: 15,
  SIMPLE_MOD: 16,
} as const;

/** Noms des logiques du débogueur de ScummVM (`logic_table_names`, debug.cpp), repris dans les traces. */
export const LOGIC_NAMES: readonly string[] = [
  "return",
  "Logic::script",
  "Logic::auto_route",
  "Logic::ar_anim",
  "Logic::ar_turn",
  "Logic::alt",
  "Logic::anim",
  "Logic::turn",
  "Logic::cursor",
  "Logic::talk",
  "Logic::listen",
  "Logic::stopped",
  "Logic::choose",
  "Logic::frames",
  "Logic::pause",
  "Logic::wait_sync",
  "Logic::simple_anim",
];

/** Bits de `status` (`ST_*`). */
export const ST = {
  BACKGROUND: 1,
  FOREGROUND: 2,
  SORT: 4,
  RECREATE: 8,
  MOUSE: 16,
  COLLISION: 32,
  LOGIC: 64,
  GRID_PLOT: 128,
  AR_PRIORITY: 256,
} as const;
export const ST_COLLISION_BIT = 5;

/** Compacts nommés (`CptIds`, skydefs.h). */
export const Cpt = {
  JOEY: 1,
  FOSTER: 3,
  TEXT_1: 0x17,
  TEXT_11: 0x21,
  MENU_BAR: 0x2e,
  MOVE_LIST: 0xbd,
  TALK_TABLE_LIST: 0xbc,
  REICH_DOOR_20: 0x30ab,
  /** `ID_BLUE_FOSTER`. */
  BLUE_FOSTER: 3,
  ID_SC32_GARDENER: 16600,
  ID_DANIELLE: 16441,
} as const;
/** `FIRST_TEXT_COMPACT`. */
export const FIRST_TEXT_COMPACT = 23;

/** Scripts nommés (module << 12 | rang). */
export const Script = {
  TREVOR_SPEECH: 0x3000 + 0x13d,
  JOEY_OUT_OF_LIFT: 0x3000 + 0x121,
  MENU_SELECT: 0x0000 + 0xe,
  LINC_MENU_SELECT: 0x6000 + 0x2,
  DOC_MENU_SELECT: 0x6000 + 0x8,
  RESET_MOUSE: 0x0000 + 0x17,
} as const;

/** Objets (`IDO_*`). */
export const IDO_SHADES = 9;
export const IDO_GLASS = 77;
/** Base des images de l'œil de la section 91 (`S91`). */
export const S91 = 5824;

/** Premier module de scripts dans `sky.dsk` (`F_MODULE_0`) ; 16 modules au plus. */
export const F_MODULE_0 = 60400;
export const MODULE_COUNT = 16;

/** Géométrie (skydefs.h). */
export const TOP_LEFT_X = 128;
export const TOP_LEFT_Y = 136;
export const GAME_SCREEN_WIDTH = 320;
export const GAME_SCREEN_HEIGHT = 192;
export const FULL_SCREEN_WIDTH = 320;
export const FULL_SCREEN_HEIGHT = 200;
export const FIXED_TEXT_WIDTH = 128;

/** Programmes d'animation : enregistrements `S_*` (en octets) et commandes spéciales. */
export const S_COUNT = 0;
export const S_FRAME = 2;
export const S_AR_X = 4;
export const S_AR_Y = 6;
export const S_LENGTH = 8;
export const SEND_SYNC = 0xffff;
export const LF_START_FX = 0xfffe;

/** Directions (`UPY`…). */
export const Dir = { UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3, TALK: 4 } as const;

/** Drapeaux système (`SF_*`). */
export const SF = {
  SBLASTER: 1 << 7,
  FX_OFF: 1 << 11,
  MUS_OFF: 1 << 12,
  CHOOSING: 1 << 14,
  NO_SCROLL: 1 << 15,
  GAME_RESTORED: 1 << 17,
  PLAY_VOCS: 1 << 21,
  ALLOW_SPEECH: 1 << 23,
  ALLOW_TEXT: 1 << 24,
  MOUSE_LOCKED: 1 << 27,
} as const;

/** Curseurs (`MOUSE_*`). */
export const Cursor = { OBJECT: 0, NORMAL: 1, DISK: 2, DOWN: 3, RIGHT: 4, LEFT: 5, BLANK: 6, CROSS: 7, UP: 8 } as const;

/** `clickTable` (logic.cpp) : personnages dont la réplique se coupe d'un clic. */
export const CLICK_TABLE: readonly number[] = [
  3, 1, 4122, 16, 137, 8211, 8301, 136, 4148, 4100, 4101, 8544, 8205, 12546, 12407, 12429, 12381, 12442, 12430, 8324, 8309, 16516, 16601, 16599,
  16600, 16495, 16772, 16701, 16731, 16737, 16597, 16441, 16821, 16822, 16823, 16824, 20511, 20754, 20812, 20911, 20706, 20707, 21014, 21069,
  24767, 12289,
];

/** Fichiers chargés au démarrage (`SkyEngine::loadFixedItems`, version complète). */
export const FIXED_ITEMS: readonly number[] = [49, 50, 73, 262, 36, 263, 264, 265, 266, 267, 269, 271, 272];

/** Noms des opcodes (`opcodes`, debug.cpp) et nombre de mots d'opérandes (`opcode_par`). */
export const OPCODE_NAMES: readonly string[] = [
  "push_variable",
  "less_than",
  "push_number",
  "not_equal",
  "if_and",
  "skip_zero",
  "pop_var",
  "minus",
  "plus",
  "skip_always",
  "if_or",
  "call_mcode",
  "more_than",
  "script_exit",
  "switch",
  "push_offset",
  "pop_offset",
  "is_equal",
  "skip_nz",
  "script_exit",
  "restart_script",
];
export const OPCODE_PARAMS: readonly number[] = [1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 1, 1, 1, 0, 1, 0, 0];
