/** Numéros de `defs.h` (ScummVM) et du jeu utilisés par le groupe 2 : pièces, états, zones. */

export const Room = {
  /** Devant le camp de la Flöda (`ROOM_FLODA_OUTSIDE`). */
  Outside: 22,
  /** La cuisine (`ROOM_FLODA_KITCHEN`). */
  Kitchen: 26,
  /** Le bureau de Klunk (`ROOM_FLODA_KLUNK`). */
  Klunk: 30,
  /** Le couloir d'Henri (`ROOM_FLODA_HENRY`). */
  Henry: 32,
  /** La réception (`ROOM_FLODA_FRONTDESK`). */
  FrontDesk: 103,
} as const;

/** `VAR_BYPASS_FLODA_RECEPTIONIST` : 0 la secrétaire arrête Joe, 1 elle l'a arrêté une fois, puis la zone reste fermée. */
export const BYPASS_FLODA_RECEPTIONIST = 35;
/** `VAR_GUARDS_TURNED_ON` : les gardes de la prison sont allumés (mouvement 25, `C63C`). */
export const GUARDS_TURNED_ON = 85;
/** `VAR_AZURA_IN_LOVE` : Azura est amoureuse de Joe (mouvement 19, `C41A`). */
export const AZURA_IN_LOVE = 167;

/** Zone de la réception qui rend Joe à la secrétaire (zone éteinte 3) et zone du mannequin (7, mouvement 23). */
export const RECEPTIONIST_AREA = 3;
export const MANNEQUIN_AREA = 7;
