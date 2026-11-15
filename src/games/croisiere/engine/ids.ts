/**
 * Constantes nommées du moteur de Croisière pour un cadavre (nombres magiques de ScummVM `engines/cruise/`, GPL v3+).
 *
 * Références : `cruise_main.h` (boutons, types d'objets), `script.h` (types de scripts), `object.h` (classes), `vars.h` (tailles),
 * `stack.h` (`SIZE_STACK`), `cruise.h` (`GAME_FRAME_DELAY_1/2`), `function.cpp` / `cruise_main.cpp` (valeurs de gel).
 */

/** Type d'un processus (`scriptTypeEnum`) : procédure ou script de relation objet/verbe. */
export const ScriptType = { PROC: 20, REL: 30 } as const;

/** Valeurs conventionnelles de `freeze` d'un script (engine.md § 2). 0 = actif. */
export const Freeze = {
  active: 0,
  /** Parent gelé par un enfant (`Op_FreezeParent`). */
  parent: 9997,
  /** Attente de la fin d'une auto-animation (`Op_AutoCell` avec `type != 0`). */
  autoCell: 9996,
  /** Attente de la fin de la marche automatique du narrateur. */
  autoTrack: 9998,
  /** Attente d'un clic (`Op_UserWait`). */
  userWait: 9999,
} as const;

/** Types de cellules et de ressources (`cruise_main.h`, `OBJ_TYPE_*`). */
export const ObjType = {
  LINE: 0,
  MASK: 1,
  BGMASK: 2,
  VIRTUAL: 3,
  SPRITE: 4,
  MESSAGE: 5,
  SOUND: 6,
  FONT: 7,
  POLY: 8,
  EXIT: 9,
} as const;

/** Classes d'objets (`eClass`). */
export const ObjClass = { MULTIPLE: 0, VARIABLE: 1, UNIQUE: 2, THEME: 3 } as const;

/** Bits de bouton (`CRS_MB_*`). Le bouton du milieu sert aussi pour Échap. */
export const MouseButton = { LEFT: 1, RIGHT: 2, MIDDLE: 4, BOTH: 3 } as const;

/** Taille de la table des overlays (`overlayTable[90]`) ; l'index 0 n'est jamais utilisé. */
export const OVERLAY_TABLE_SIZE = 90;
/** Nombre de variables globales (`globalVars[2000]`). */
export const GLOBAL_VAR_COUNT = 2000;
/** Taille de la pile des scripts (`SIZE_STACK`). */
export const STACK_SIZE = 0x200;
/** Nombre d'entrées de la base de fichiers (`NUM_FILE_ENTRIES`). */
export const NUM_FILE_ENTRIES = 257;
/** Nombre de plans de fond (`NBSCREENS`). */
export const NBSCREENS = 8;

/** Cadence de la boucle : 50 ms pendant l'intro, 100 ms dès que le menu joueur est autorisé (`GAME_FRAME_DELAY_1/2`). */
export const GAME_FRAME_DELAY_1 = 50;
export const GAME_FRAME_DELAY_2 = 100;
/** Pas de l'attente active de `mainLoop` (`delayMillis(10)`). */
export const LOOP_DELAY_MS = 10;

/** Codes de retour des opcodes et de `executeScripts`. */
export const ScriptError = {
  /** Lien non résolu (type & 7 == 0). */
  unresolved: -10,
  /** Overlay non chargé. */
  notLoaded: -7,
  /** Données absentes. */
  noData: -4,
  /** Type de script inconnu. */
  badType: -6,
  /** Fonction native 0 ou hors table. */
  badNative: -21,
  /** Fichier introuvable (`loadOverlay`, `loadFileSub1`). */
  fileNotFound: -18,
  /** Objet introuvable (`getObjectDataFromOverlay`). */
  noObject: -11,
} as const;
