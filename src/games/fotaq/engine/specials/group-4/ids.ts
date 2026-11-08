/** Numéros de `defs.h` (ScummVM) et du jeu utilisés par le groupe 4 : pièces, objets, états, bobs, cinématiques. */

export const Room = {
  /** Le hall, au rez-de-chaussée de l'hôtel (`ROOM_HOTEL_LOBBY`). */
  HotelLobby: 73,
  /** Le couloir de l'hôtel (`ROOM_HOTEL_DOWNSTAIRS`). */
  HotelDownstairs: 71,
  /** La course de voiture (`ROOM_CAR_CHASE`). */
  CarChase: 74,
} as const;

/** L'huile versée sur la voiture de Rico (objet 594 de `QUEEN.JAS`, son bob est éteint à la fin de la course : mouvement 8). */
export const OIL_OBJECT = 594;
/** Le bob des tirs (`BOB_FX` de `BamScene`). */
export const GUN_SHOTS_BOB = 7;

/** Ligne de la table de la voiture où l'huile doit tomber (`asmWaitForCarPosition`). */
export const OIL_CAR_INDEX = 60;

/** Réplique de Joe devant l'escalier de l'hôtel (zone éteinte de la pièce 71, `makeJoeSpeak(21)`). */
export const HOTEL_DOWNSTAIRS_SPEECH = 21;

/** Cinématiques des gardes du hall selon `GameVar.HotelEscapeState` (état 93). */
export const HOTEL_ESCAPE_CUTAWAYS = ["C73A.CUT", "C73B.CUT", "C73C.CUT"] as const;
